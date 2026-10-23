import { useEffect, useMemo, useState } from "react";
import {
  createKit,
  loseCapability,
  type RecoveryKit,
  verifyKit,
} from "../../../packages/domain/src/recovery-kit";
import {
  discoverWallets,
  LaceWalletConnector,
  type WalletConnectionState,
} from "../../../packages/midnight-client/src";
import { useMiloAuth } from "./auth-client";
import {
  applyCheckpoint,
  assessCheckpoint,
  assessPrepareReserve,
  beginReserveOperation,
  confirmObservedReserve,
  type PrepareReserveInput,
  prepareBuyerReserve,
  reserveRunStatus,
} from "./buyer-reserve-runtime";
import {
  emitRecoveryKitChanged,
  forgetKit,
  readKit,
  subscribeKitChanges,
  writeKit,
} from "./recovery-runtime";

const NETWORK = "preprod";

type RecoveryKitOpRow = {
  op: string;
  disposition: "ui-wired" | "justified";
  detail: string;
};

type Action = {
  label: string;
  run: () => void;
  disabled: boolean;
  className?: string;
};

export const RECOVERY_KIT_OPS: RecoveryKitOpRow[] = [
  {
    op: "beginOperation",
    disposition: "ui-wired",
    detail:
      "UI-wired: Begin reserve operation records a real submission identity.",
  },
  {
    op: "resumeOperation",
    disposition: "justified",
    detail:
      "Not wired in this browser UI; no browser order.compact call path can safely retry.",
  },
  {
    op: "confirmOperation",
    disposition: "ui-wired",
    detail:
      "UI-wired: Confirm from observation fails closed without a real chain observation.",
  },
  {
    op: "abandonOperation",
    disposition: "justified",
    detail:
      "Not wired in this browser UI; abandon cannot cancel a possibly submitted transaction.",
  },
  {
    op: "loseCapability",
    disposition: "ui-wired",
    detail: "UI-wired: Mark capability lost leaves a read-only LOST kit.",
  },
  {
    op: "restoreKit",
    disposition: "justified",
    detail:
      "Not wired in this browser UI; no backup-import flow is wired (gated UX).",
  },
  {
    op: "adoptBackup",
    disposition: "justified",
    detail:
      "Not wired in this browser UI; same-scope backup adoption is domain-tested only (gated UX).",
  },
];

const unavailableSteps = [
  {
    step: "Merchant accepts and submits the delivery",
    detail: "No browser order.compact call path for accept/submit.",
  },
  {
    step: "Buyer approves or opens a dispute",
    detail: "No browser order.compact call path for approve/dispute.",
  },
  {
    step: "Capture or void the payment",
    detail: "Stripe capture and void are not browser-reachable.",
  },
];

const scopeOf = (kit: RecoveryKit) => ({
  actorId: kit.actorId,
  network: kit.network,
  orderNonce: kit.orderNonce,
});

function contextStatus(kit: RecoveryKit | null): string {
  if (!kit)
    return "No local recovery context is stored for this actor and order nonce.";
  if (kit.stage === "LOST")
    return "Capability reported lost. This order is read-only; signing in again cannot recreate the capability.";
  if (kit.stage === "CHECKPOINTED")
    return `Local recovery context bound to ${kit.address}.`;
  if (kit.stage === "VERIFIED")
    return "Local recovery context verified. Checkpoint the canonical address from a confirmed deployment observation to continue.";
  return "Local recovery context created on this device. Verify it before any payment hold.";
}

function TextField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="text"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

export function RecoveryKitPanel({
  defaultOrderNonce,
}: {
  defaultOrderNonce?: string;
} = {}) {
  const { data: session } = useMiloAuth().useSession();
  const authenticated = Boolean(session?.user);
  const actorId = session?.user?.id;
  const [nonce, setNonce] = useState(defaultOrderNonce ?? "");
  const [kit, setKit] = useState<RecoveryKit | null>(null);
  const [notice, setNotice] = useState("");
  const bound = authenticated && !!actorId && nonce.trim().length > 0;

  useEffect(() => {
    const orderNonce = nonce.trim();
    if (!authenticated || !actorId || !orderNonce) {
      setKit(null);
      return;
    }
    setNotice("");
    setKit(readKit({ actorId, network: NETWORK, orderNonce }));
    return subscribeKitChanges(() => {
      setKit(readKit({ actorId, network: NETWORK, orderNonce }));
    });
  }, [authenticated, actorId, nonce]);

  function persist(next: RecoveryKit) {
    setKit(next);
    const saved = writeKit(scopeOf(next), next);
    setNotice(
      saved
        ? "Recovery context saved in this browser’s local storage."
        : "This browser refused local storage. The context is shown but not persisted.",
    );
    if (saved) emitRecoveryKitChanged();
  }
  function prepare() {
    const orderNonce = nonce.trim();
    if (!authenticated || !actorId || !orderNonce) return;
    try {
      persist(createKit({ actorId, network: NETWORK, orderNonce }));
    } catch {
      setNotice(
        "The recovery context could not be created for this actor and order nonce.",
      );
    }
  }
  function verify() {
    if (!kit) return;
    try {
      persist(verifyKit(kit, scopeOf(kit)));
    } catch {
      setNotice("This recovery context is not awaiting verification.");
    }
  }
  function lose() {
    if (!kit) return;
    try {
      persist(loseCapability(kit));
    } catch {
      setNotice("This recovery context cannot be marked lost.");
    }
  }
  function forget() {
    if (!kit) return;
    forgetKit(scopeOf(kit));
    setKit(null);
    setNotice("Local recovery context discarded from this browser.");
    emitRecoveryKitChanged();
  }

  return (
    <>
      <h3>Order recovery context</h3>
      {!authenticated ? (
        <p role="status">
          Sign in above to bind the order actor. The recovery context is scoped
          to that identity and to one order nonce.
        </p>
      ) : (
        <>
          <p role="status">
            Actor {actorId}. Network {NETWORK.toUpperCase()}.
          </p>
          <TextField label="Order nonce" value={nonce} onChange={setNonce} />
          <p role="status">{contextStatus(kit)}</p>
          {notice && <p role="status">{notice}</p>}
          <div className="connection-actions">
            {(
              [
                {
                  label: "Prepare local context",
                  run: prepare,
                  disabled: !bound || kit !== null,
                  className: "button",
                },
                {
                  label: "Verify context",
                  run: verify,
                  disabled: kit?.stage !== "EXPORTED",
                },
                {
                  label: "Mark capability lost",
                  run: lose,
                  disabled: !kit || kit.stage === "LOST",
                },
                { label: "Forget local context", run: forget, disabled: !kit },
              ] as Action[]
            ).map(
              ({ label, run, disabled, className = "button secondary" }) => (
                <button
                  key={label}
                  type="button"
                  className={className}
                  disabled={disabled}
                  onClick={run}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          {kit?.requiresReconciliation && (
            <p role="alert">
              A prior operation was interrupted or a capability was lost.
              Reconcile the retained identity before any retry.
            </p>
          )}
          <CheckpointSection kit={kit} onCheckpoint={persist} />
          <BuyerReserveSection kit={kit} onBegin={persist} />
        </>
      )}
      <h3>Order lifecycle</h3>
      <dl className="detail-grid">
        {unavailableSteps.map(({ step, detail }) => (
          <div key={step}>
            <dt>{step}</dt>
            <dd>Unavailable — {detail}</dd>
          </div>
        ))}
      </dl>
      <h4>Recovery-kit operations: wired or justified</h4>
      <dl className="detail-grid">
        {RECOVERY_KIT_OPS.map(({ op, disposition, detail }) => (
          <div key={op}>
            <dt>
              <code>{op}</code>
            </dt>
            <dd>
              {disposition === "ui-wired"
                ? `UI-wired — ${detail}`
                : `Justified (not wired) — ${detail}`}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function CheckpointSection({
  kit,
  onCheckpoint,
}: {
  kit: RecoveryKit | null;
  onCheckpoint: (next: RecoveryKit) => void;
}) {
  const [observedAddress, setObservedAddress] = useState("");
  const assessment = assessCheckpoint(kit, observedAddress.trim() || null);
  if (!kit || kit.stage === "EXPORTED" || kit.stage === "LOST") return null;
  function checkpoint() {
    if (!kit) return;
    const result = applyCheckpoint(kit, observedAddress.trim() || null);
    if (result.ok) onCheckpoint(result.kit);
  }
  return (
    <section aria-labelledby="checkpoint-title">
      <h4 id="checkpoint-title">Checkpoint canonical address</h4>
      <p>An order nonce is never accepted as an address.</p>
      <TextField
        label="Observed canonical address"
        value={observedAddress}
        onChange={setObservedAddress}
        disabled={kit.stage !== "VERIFIED"}
      />
      <p role="status">
        {assessment.ready
          ? "Ready to checkpoint the supplied observed address."
          : assessment.message}
      </p>
      <div className="connection-actions">
        <button
          className="button"
          type="button"
          disabled={!assessment.ready}
          onClick={checkpoint}
        >
          Checkpoint address
        </button>
      </div>
    </section>
  );
}

export function BuyerReserveSection({
  kit,
  onBegin,
}: {
  kit: RecoveryKit | null;
  onBegin: (next: RecoveryKit) => void;
}) {
  const [wallet, setWallet] = useState<WalletConnectionState>({
    status: "disconnected",
  });
  const [walletNotice, setWalletNotice] = useState(
    "Not connected. Midnight Lace API v4 is required in this browser.",
  );
  const [candidates, setCandidates] = useState(() =>
    typeof window === "undefined" ? [] : discoverWallets(window.midnight),
  );
  const [selectedRdns, setSelectedRdns] = useState(
    () => candidates[0]?.rdns ?? "",
  );
  const selected = Math.max(
    0,
    candidates.findIndex((w) => w.rdns === selectedRdns),
  );
  useEffect(() => {
    const refresh = () => setCandidates(discoverWallets(window.midnight));
    const events = ["milo:midnight-registry", "focus"] as const;
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, []);
  const connector = useMemo(
    () =>
      new LaceWalletConnector((state) => {
        setWallet(state);
        setWalletNotice(walletMessage(state));
      }),
    [],
  );
  const [prepareNotice, setPrepareNotice] = useState("");
  const [operationIdentity, setOperationIdentity] = useState("");
  const [operationRevision, setOperationRevision] = useState("0");
  const providers = useMemo(() => ({}), []);
  const prepareInput: PrepareReserveInput = {
    kit,
    wallet,
    privateState: null,
    providers,
    expectedRevision: 0n,
  };
  const prepareGate = assessPrepareReserve(prepareInput);

  function connect() {
    const fresh = discoverWallets(window.midnight);
    setCandidates(fresh);
    void connector.connect(
      fresh.find((w) => w.rdns === selectedRdns) ?? fresh[selected] ?? fresh[0],
    );
  }
  function forget() {
    connector.disconnect();
    setWalletNotice(
      "Connection forgotten in Milo. Revoke site permission in Lace to remove the extension’s authorization.",
    );
  }
  function runPrepare() {
    setPrepareNotice(prepareBuyerReserve(prepareInput).message);
  }
  function runBegin() {
    if (!kit) return;
    const revision = Number(operationRevision);
    const result = beginReserveOperation(
      kit,
      operationIdentity.trim(),
      Number.isSafeInteger(revision) ? revision : Number.NaN,
    );
    setPrepareNotice(result.message);
    if (result.ok) onBegin(result.kit);
  }
  function runConfirm() {
    if (!kit) return;
    setPrepareNotice(confirmObservedReserve(kit, null).message);
  }

  return (
    <section aria-labelledby="buyer-reserve-title">
      <h4 id="buyer-reserve-title">Buyer reserve</h4>
      <p className="micro muted">{reserveRunStatus()}</p>
      <h5>Midnight Lace wallet</h5>
      <p role="status">{walletNotice}</p>
      {wallet.status === "connected" ? (
        <div className="connection-actions">
          <button className="button secondary" type="button" onClick={forget}>
            Forget connection
          </button>
        </div>
      ) : (
        <div className="connection-actions">
          {candidates.length > 1 && (
            <label className="field">
              Wallet to connect
              <select
                value={selected}
                onChange={(event) =>
                  setSelectedRdns(
                    candidates[Number(event.target.value)]?.rdns ?? "",
                  )
                }
              >
                {candidates.map((entry, index) => (
                  <option key={entry.rdns || index} value={index}>
                    {entry.name || `Wallet ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button"
            type="button"
            disabled={wallet.status === "connecting"}
            onClick={connect}
          >
            {candidates.length > 0
              ? `Connect ${candidates[selected]?.name || "the selected wallet"}`
              : "Connect a Midnight wallet"}
          </button>
        </div>
      )}
      <h5>Prepare reserve</h5>
      <p role="status">
        {prepareGate.ready
          ? "Prerequisites present. Prepare returns a descriptor only."
          : prepareGate.message}
      </p>
      <div className="connection-actions">
        <button
          className="button"
          type="button"
          disabled={!prepareGate.ready}
          onClick={runPrepare}
        >
          Prepare reserve call
        </button>
      </div>
      <h5>Track in-flight reserve</h5>
      <p>Use a real submission identity; this panel never invents one.</p>
      <TextField
        label="Operation identity (from a real submission)"
        value={operationIdentity}
        onChange={setOperationIdentity}
        disabled={kit?.stage !== "CHECKPOINTED"}
      />
      <TextField
        label="Expected revision"
        value={operationRevision}
        onChange={setOperationRevision}
        disabled={kit?.stage !== "CHECKPOINTED"}
      />
      <div className="connection-actions">
        <button
          className="button secondary"
          type="button"
          disabled={
            kit?.stage !== "CHECKPOINTED" ||
            kit.pending !== null ||
            operationIdentity.trim().length === 0
          }
          onClick={runBegin}
        >
          Begin reserve operation
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={kit?.pending?.operation !== "reserve"}
          onClick={runConfirm}
        >
          Confirm from observation
        </button>
      </div>
      {prepareNotice && <p role="status">{prepareNotice}</p>}
    </section>
  );
}

function walletMessage(state: WalletConnectionState): string {
  if (state.status === "connected")
    return `Connected to PREPROD as ${state.account.unshieldedAddress}. No transaction has been signed.`;
  if (state.status === "connecting")
    return "Approve the PREPROD connection in Midnight Lace. No signature is requested.";
  if (state.status === "error") return state.message;
  return "Not connected. Midnight Lace API v4 is required in this browser.";
}
