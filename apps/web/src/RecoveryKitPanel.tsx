import { usePrivy } from "@privy-io/react-auth";
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
  forgetKit,
  RECOVERY_KIT_CHANGED,
  readKit,
  writeKit,
} from "./recovery-runtime";

/**
 * The one order console's real, client-local recovery surface. It consumes the
 * pure recovery-kit state machine (packages/domain/src/recovery-kit.ts) through
 * native browser storage and real Privy identity. The buyer reserve path is
 * wired through midnight-client's fail-closed `prepareReserveCall` and the
 * recovery-kit operations (`checkpointAddress` / `beginOperation` /
 * `confirmOperation`): every missing prerequisite is an explicit blocked
 * reason, and nothing here claims a reserve succeeded without a real signed
 * transaction and a matching observation.
 */
const NETWORK = "preprod";

/**
 * SUPERSEDED (P3 A0-2 tree loss): packages/domain/src/recovery-kit.ts and
 * packages/midnight-client/src are GONE from this tree (BASELINE-P3). The
 * imports below and domain-tested claims are historical; this panel cannot
 * build until those sources are restored. Unavailable-list details also
 * predate the loss of convex/ (files/http transport sources absent, not merely
 * unwired).
 *
 * Recovery-kit domain operations that were implemented and unit-tested in
 * packages/domain/src/recovery-kit.ts but intentionally have NO browser UI
 * path in this build. Each is marked unused rather than simulated: the matching
 * chain/circuit or backup-import surface is absent. `beginOperation` /
 * `confirmOperation` are live only for the `reserve` operation; `deploy`,
 * `submit` and `approve` remain unused here for the same reason.
 */
export const UNUSED_RECOVERY_KIT_OPS: { op: string; detail: string }[] = [
  {
    op: "resumeOperation",
    detail:
      "Unused in this browser UI. A pending operation is displayed for reconciliation, but resume is not offered because no browser order.compact call path can safely retry a submission.",
  },
  {
    op: "abandonOperation",
    detail:
      "Unused in this browser UI. Abandon cannot cancel a possibly submitted transaction; the kit surfaces requiresReconciliation instead of a one-click abandon that might imply cancellation.",
  },
  {
    op: "restoreKit",
    detail:
      "Unused in this browser UI. No backup-import flow is wired; a lost capability stays read-only until an explicit restore path exists.",
  },
  {
    op: "adoptBackup",
    detail:
      "Unused in this browser UI. Same-scope backup adoption is domain-tested only; this panel never rolls kit state from an imported file.",
  },
  {
    op: "beginOperation(deploy|submit|approve)",
    detail:
      "Unused. Only `reserve` is wired through midnight-client prepareReserveCall. Deploy is the A1 ingest observation path (server-side); submit/approve are order.compact circuits with no browser call path.",
  },
];

/** Lifecycle steps still without a browser path; each names the missing piece. */
const unavailableSteps: { step: string; detail: string }[] = [
  {
    step: "Merchant accepts and submits the delivery",
    detail:
      "Requires a checkpointed recovery context and the immutable submit circuit. Blocked: no browser order.compact call path for accept/submit, and no private delivery-file storage in this build (SUPERSEDED P3 A0-2: convex/ files and http transport sources are gone from this tree, not merely unwired).",
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

export function RecoveryKitPanel() {
  const { authenticated, user } = usePrivy();
  const actorId = user?.id;
  const [nonce, setNonce] = useState("");
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
    // A projected checkpoint from OrderRecordPanel writes the same localStorage
    // key; reload so this panel never shows a stale stage/address.
    const reload = () => {
      setKit(readKit({ actorId, network: NETWORK, orderNonce }));
    };
    window.addEventListener(RECOVERY_KIT_CHANGED, reload);
    return () => window.removeEventListener(RECOVERY_KIT_CHANGED, reload);
  }, [authenticated, actorId, nonce]);

  function persist(next: RecoveryKit) {
    setKit(next);
    setNotice(
      writeKit(scopeOf(next), next)
        ? "Recovery context saved in this browser’s local storage."
        : "This browser refused local storage. The context is shown but not persisted.",
    );
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
            <button
              className="button"
              type="button"
              disabled={!bound || kit !== null}
              onClick={prepare}
            >
              Prepare local context
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={kit?.stage !== "EXPORTED"}
              onClick={verify}
            >
              Verify context
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={!kit || kit.stage === "LOST"}
              onClick={lose}
            >
              Mark capability lost
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={!kit}
              onClick={forget}
            >
              Forget local context
            </button>
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
      <h4>Recovery-kit operations marked unused</h4>
      <p>
        These domain operations exist in the pure recovery-kit state machine and
        are unit-tested there. This browser surface deliberately does not call
        them; they are listed so nothing is silently dead or faked:
      </p>
      <dl className="detail-grid">
        {UNUSED_RECOVERY_KIT_OPS.map(({ op, detail }) => (
          <div key={op}>
            <dt>
              <code>{op}</code>
            </dt>
            <dd>Unused — {detail}</dd>
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
 * `prepareReserveCall`. Fail closed on every missing prerequisite. The prepare
 * action produces a descriptor only — never a signature and never a completed
 * reserve. `beginOperation` runs only when a real submission identity exists.
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
  const [candidates] = useState(() =>
    typeof window === "undefined" ? [] : discoverWallets(window.midnight),
  );
  const [selected, setSelected] = useState(0);
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
    // Actor-local private state is not collected in this panel (secrets never
    // enter form fields). The gate reports the missing state until a local
    // private-state store is wired.
    privateState: null,
    providers,
    expectedRevision: 0n,
  };
  const prepareGate = assessPrepareReserve(prepareInput);

  function connect() {
    void connector.connect(candidates[selected]);
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
    // No observation source is wired in this build: confirm always fails
    // closed rather than inventing a chain result.
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
                onChange={(event) => setSelected(Number(event.target.value))}
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
      <label className="field">
        Operation identity (from a real submission)
        <input
          type="text"
          autoComplete="off"
          value={operationIdentity}
          onChange={(event) => setOperationIdentity(event.target.value)}
          disabled={kit?.stage !== "CHECKPOINTED"}
        />
      </label>
      <label className="field">
        Expected revision
        <input
          type="text"
          autoComplete="off"
          value={operationRevision}
          onChange={(event) => setOperationRevision(event.target.value)}
          disabled={kit?.stage !== "CHECKPOINTED"}
        />
      </label>
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
  switch (state.status) {
    case "connected":
      return `Connected to PREPROD as ${state.account.unshieldedAddress}. No transaction has been signed.`;
    case "connecting":
      return "Approve the PREPROD connection in Midnight Lace. No signature is requested.";
    case "error":
      return state.message;
    default:
      return "Not connected. Midnight Lace API v4 is required in this browser.";
  }
}
