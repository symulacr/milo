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

/**
 * Client-local recovery surface over the pure recovery-kit state machine.
 * Nothing here claims a reserve succeeded without a real signed transaction
 * and a matching observation.
 */
const NETWORK = "preprod";

/** The seven recovery-kit ops: UI-wired on this panel or justified in writing. */
type RecoveryKitOpRow = {
  op: string;
  disposition: "ui-wired" | "justified";
  detail: string;
};

export const RECOVERY_KIT_OPS: RecoveryKitOpRow[] = [
  {
    op: "beginOperation",
    disposition: "ui-wired",
    detail:
      "UI-wired for the reserve operation via the in-flight tracker (Begin reserve operation), which records a real submission identity and leaves the kit unusable. deploy|submit|approve stay justified: only reserve is wired through midnight-client prepareReserveCall; deploy is the A1 ingest observation path (server-side); submit/approve are order.compact circuits with no browser call path.",
  },
  {
    op: "resumeOperation",
    disposition: "justified",
    detail:
      "Not wired in this browser UI. A pending operation is displayed for reconciliation, but resume is not offered because no browser order.compact call path can safely retry a submission. resumeOperation itself only re-reads the retained identity and never marks the order usable.",
  },
  {
    op: "confirmOperation",
    disposition: "ui-wired",
    detail:
      "UI-wired for reserve via Confirm from observation, which fails closed without a real chain observation and never invents a transition. deploy|submit|approve confirmation stay justified for the same missing call paths as beginOperation. A deploy confirmation alone never yields a usable order.",
  },
  {
    op: "abandonOperation",
    disposition: "justified",
    detail:
      "Not wired in this browser UI. Abandon cannot cancel a possibly submitted transaction; the kit surfaces requiresReconciliation instead of a one-click abandon that might imply cancellation. Domain-tested: abandon never yields a usable order.",
  },
  {
    op: "loseCapability",
    disposition: "ui-wired",
    detail:
      "UI-wired as the Mark capability lost control. The resulting LOST kit is read-only; signing in again cannot recreate the capability, and the panel never claims an email reset is a substitute.",
  },
  {
    op: "restoreKit",
    disposition: "justified",
    detail:
      "Not wired in this browser UI. No backup-import flow is wired (gated UX per blueprint recovery kit); a lost capability stays read-only until an explicit restore path exists. Domain-tested: restore never re-grants a usable order by itself.",
  },
  {
    op: "adoptBackup",
    disposition: "justified",
    detail:
      "Not wired in this browser UI. Same-scope backup adoption is domain-tested only (gated UX); this panel never rolls kit state from an imported file. A stale backup that would roll back newer active state is refused in the domain layer.",
  },
];

/** Lifecycle steps still without a browser path; each names the missing piece. */
const unavailableSteps: { step: string; detail: string }[] = [
  {
    step: "Merchant accepts and submits the delivery",
    detail:
      "Requires a checkpointed recovery context and the immutable submit circuit. Blocked: no browser order.compact call path for accept/submit. Private delivery-file storage exists on the Convex surface (convex/files.ts) but is not wired through this browser panel.",
  },
  {
    step: "Buyer approves or opens a dispute",
    detail:
      "The chain-backed order record (phase + checkpoint address) is readable from the Convex projection on the authenticated surface. Still blocked: approve/dispute are order.compact circuits with no browser call path.",
  },
  {
    step: "Capture or void the payment",
    detail:
      "Blocked: Stripe capture, void and webhook ingress are not browser-reachable. Only read-only observation of an existing Stripe test payment is available below.",
  },
];

const scopeOf = (kit: RecoveryKit) => ({
  actorId: kit.actorId,
  network: kit.network,
  orderNonce: kit.orderNonce,
});

/** One-line state of the stored kit for the current scope. */
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

export function RecoveryKitPanel({
  defaultOrderNonce,
}: {
  defaultOrderNonce?: string;
} = {}) {
  const { data: session } = useMiloAuth().useSession();
  const authenticated = Boolean(session?.user);
  const user = session?.user;
  const actorId = user?.id;
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
    // Another panel or tab may write the same key; never show a stale stage.
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
    // Only on a real write: listeners re-read storage, so an unsaved kit
    // would be replaced by the stale (or absent) stored one.
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
      <p>
        The browser persists only this order’s non-secret recovery context —
        actor, network, order nonce and status — in local storage, before any
        submission. No capability, witness, seed or file is ever stored here,
        and nothing on this device is treated as authorisation.
      </p>
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
          <label className="field">
            Order nonce
            <input
              type="text"
              autoComplete="off"
              value={nonce}
              onChange={(event) => setNonce(event.target.value)}
            />
          </label>
          <p role="status">{contextStatus(kit)}</p>
          {notice && <p role="status">{notice}</p>}
          <div className="connection-actions">
            {[
              {
                label: "Prepare local context",
                onClick: prepare,
                disabled: !bound || kit !== null,
                className: "button",
              },
              {
                label: "Verify context",
                onClick: verify,
                disabled: kit?.stage !== "EXPORTED",
                className: "button secondary",
              },
              {
                label: "Mark capability lost",
                onClick: lose,
                disabled: !kit || kit.stage === "LOST",
                className: "button secondary",
              },
              {
                label: "Forget local context",
                onClick: forget,
                disabled: !kit,
                className: "button secondary",
              },
            ].map(({ label, ...action }) => (
              <button key={label} type="button" {...action}>
                {label}
              </button>
            ))}
          </div>
          {kit?.requiresReconciliation && (
            <p role="alert">
              A prior operation was interrupted or a capability was lost.
              Reconcile the retained identity before any retry; an abort cannot
              cancel a possibly submitted transaction.
            </p>
          )}
          <CheckpointSection kit={kit} onCheckpoint={persist} />
          <BuyerReserveSection kit={kit} onBegin={persist} />
        </>
      )}
      <h3>Order lifecycle</h3>
      <p>
        The buyer reserve path above is real scaffolding: it prepares a
        fail-closed descriptor through the Midnight client and tracks operations
        through the recovery kit. Remaining steps still have no browser path and
        name what is missing rather than being simulated:
      </p>
      <dl className="detail-grid">
        {unavailableSteps.map(({ step, detail }) => (
          <div key={step}>
            <dt>{step}</dt>
            <dd>Unavailable — {detail}</dd>
          </div>
        ))}
      </dl>
      <h4>Recovery-kit operations: wired or justified</h4>
      <p>
        Every recovery-kit operation in the pure state machine is either called
        from this browser surface or listed here with a written justification.
        Nothing is silently dead or simulated:
      </p>
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

/**
 * Checkpoint the canonical address from a confirmed deployment observation.
 * The address is supplied from a real observation; Milo never invents one.
 */
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
      <p>
        Bind the deployed contract address from a confirmed deployment
        observation. The address is not created here — supply the one a real
        observation produced. An order nonce is never accepted as an address.
      </p>
      <label className="field">
        Observed canonical address
        <input
          type="text"
          autoComplete="off"
          value={observedAddress}
          onChange={(event) => setObservedAddress(event.target.value)}
          disabled={kit.stage !== "VERIFIED"}
        />
      </label>
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

/**
 * Buyer reserve scaffolding: Lace wallet connection plus midnight-client
 * `prepareReserveCall`. Fail closed on every missing prerequisite; prepare
 * returns a descriptor only, never a signature or a completed reserve.
 */
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
  // Selection is keyed by CAIP-372 `rdns`, not list position: a wallet that
  // arrives after mount must not silently steal or lose the user's choice.
  const [selectedRdns, setSelectedRdns] = useState(
    () => candidates[0]?.rdns ?? "",
  );
  const selected = Math.max(
    0,
    candidates.findIndex((w) => w.rdns === selectedRdns),
  );
  // A wallet injected after mount (extension or SDK boot) is connectable
  // without a reload: discovery re-runs on the registry ping and on focus.
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

  // Providers are not assembled in this build; the gate names the missing slots.
  const providers = useMemo(() => ({}), []);
  const prepareInput: PrepareReserveInput = {
    kit,
    wallet,
    // Secrets never enter form fields; the gate reports the missing state.
    privateState: null,
    providers,
    expectedRevision: 0n,
  };
  const prepareGate = assessPrepareReserve(prepareInput);

  function connect() {
    // Re-discover at click time so a wallet injected after mount connects on
    // the first click instead of requiring a page reload.
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
    const result = prepareBuyerReserve(prepareInput);
    setPrepareNotice(result.message);
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
    // No observation source is wired in this build: confirm fails closed.
    const result = confirmObservedReserve(kit, null);
    setPrepareNotice(result.message);
  }

  return (
    <section aria-labelledby="buyer-reserve-title">
      <h4 id="buyer-reserve-title">Buyer reserve</h4>
      <p>
        Prepare the buyer `reserve` circuit call through the Midnight client.
        Preparation validates wallet, network, checkpointed address and provider
        slots and returns a descriptor only. No signature is requested here, and
        no reserve is claimed complete without a real signed transaction and a
        matching observation.
      </p>
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
          ? "Prerequisites present. Prepare will call the Midnight client and return a descriptor only."
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
      <p>
        `beginOperation` records a real submission attempt and leaves the kit
        unusable until a matching observation confirms it. Use it only with a
        transaction identity from an actual submission; this panel never invents
        one.
      </p>
      {[
        {
          label: "Operation identity (from a real submission)",
          value: operationIdentity,
          onChange: setOperationIdentity,
        },
        {
          label: "Expected revision",
          value: operationRevision,
          onChange: setOperationRevision,
        },
      ].map(({ label, value, onChange }) => (
        <label className="field" key={label}>
          {label}
          <input
            type="text"
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={kit?.stage !== "CHECKPOINTED"}
          />
        </label>
      ))}
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
