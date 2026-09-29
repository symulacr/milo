/**
 * Browser buyer-reserve and checkpoint flow logic for the order console.
 *
 * This module is the fail-closed gate in front of midnight-client's
 * `prepareReserveCall` and the pure recovery-kit state machine. Every missing
 * prerequisite is an explicit blocked reason — never a simulated success. A
 * prepared reserve is a descriptor only: no proof, no signature, no submission,
 * and `confirmOperation` runs only on a real observed transition.
 */

import {
  beginOperation,
  checkpointAddress,
  confirmOperation,
  type RecoveryKit,
} from "../../../packages/domain/src/recovery-kit";
import {
  type BuyerPrivateState,
  type MidnightProviderSlots,
  type PreparedReserveCall,
  prepareReserveCall,
  SUPPORTED_MIDNIGHT_NETWORK,
  WALLET_SIGNED_RESERVE_RUNTIME,
  type WalletConnectionState,
} from "../../../packages/midnight-client/src";

/** Resonance of midnight-client's honesty flag. */
export const RESERVE_SUBMIT_PATH: "UNKNOWN" = WALLET_SIGNED_RESERVE_RUNTIME;

// ---------------------------------------------------------------------------
// Checkpoint (bind an observed canonical address onto a verified kit)
// ---------------------------------------------------------------------------

export type CheckpointBlockedReason =
  | "kit-missing"
  | "kit-not-verified"
  | "kit-already-checkpointed"
  | "kit-lost"
  | "deployment-not-observable"
  | "address-missing"
  | "address-is-order-nonce";

export type CheckpointAssessment =
  | { readonly ready: true; readonly address: string }
  | {
      readonly ready: false;
      readonly reason: CheckpointBlockedReason;
      readonly message: string;
    };

const CHECKPOINT_COPY: Record<CheckpointBlockedReason, string> = {
  "kit-missing":
    "Create and verify the local recovery context before checkpointing an address.",
  "kit-not-verified":
    "Verify the local recovery context before checkpointing an address.",
  "kit-already-checkpointed":
    "This recovery context is already bound to a canonical address.",
  "kit-lost":
    "Capability reported lost. Checkpointing is unavailable; this order is read-only.",
  "deployment-not-observable":
    "No confirmed deployment is observable for this order. Provide the canonical address from a real observed deployment; Milo will not invent one.",
  "address-missing":
    "An observed canonical address is required. An empty address cannot be checkpointed.",
  "address-is-order-nonce":
    "An order nonce is not a canonical address. Supply the deployed contract address from a confirmed observation.",
};

/**
 * Fail-closed readiness check for checkpointing. Callers must pass a real
 * observed address (from a confirmed deployment); a missing observation is a
 * blocked reason, not a prompt to fabricate one.
 */
export function assessCheckpoint(
  kit: RecoveryKit | null | undefined,
  observedAddress: string | null | undefined,
): CheckpointAssessment {
  if (!kit) {
    return {
      ready: false,
      reason: "kit-missing",
      message: CHECKPOINT_COPY["kit-missing"],
    };
  }
  if (kit.stage === "LOST") {
    return {
      ready: false,
      reason: "kit-lost",
      message: CHECKPOINT_COPY["kit-lost"],
    };
  }
  if (kit.stage === "CHECKPOINTED") {
    return {
      ready: false,
      reason: "kit-already-checkpointed",
      message: CHECKPOINT_COPY["kit-already-checkpointed"],
    };
  }
  if (kit.stage !== "VERIFIED") {
    return {
      ready: false,
      reason: "kit-not-verified",
      message: CHECKPOINT_COPY["kit-not-verified"],
    };
  }
  const address = (observedAddress ?? "").trim();
  if (address.length === 0) {
    // Distinguish "no observation at all" from "typed empty": both block,
    // but the copy names the missing observation first when nothing was supplied.
    return {
      ready: false,
      reason:
        observedAddress === null || observedAddress === undefined
          ? "deployment-not-observable"
          : "address-missing",
      message:
        observedAddress === null || observedAddress === undefined
          ? CHECKPOINT_COPY["deployment-not-observable"]
          : CHECKPOINT_COPY["address-missing"],
    };
  }
  if (address === kit.orderNonce) {
    return {
      ready: false,
      reason: "address-is-order-nonce",
      message: CHECKPOINT_COPY["address-is-order-nonce"],
    };
  }
  return { ready: true, address };
}

export type CheckpointResult =
  | { readonly ok: true; readonly kit: RecoveryKit; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: CheckpointBlockedReason | "checkpoint-failed";
      readonly message: string;
    };

/**
 * Bind an observed canonical address onto a verified kit via
 * `checkpointAddress`. Never advances a kit without a real address; domain
 * validation remains the authority for nonce and stage checks.
 */
export function applyCheckpoint(
  kit: RecoveryKit | null | undefined,
  observedAddress: string | null | undefined,
): CheckpointResult {
  const assessment = assessCheckpoint(kit, observedAddress);
  if (!assessment.ready) {
    return {
      ok: false,
      reason: assessment.reason,
      message: assessment.message,
    };
  }
  try {
    const next = checkpointAddress(kit as RecoveryKit, assessment.address);
    return {
      ok: true,
      kit: next,
      message: `Local recovery context bound to ${assessment.address}. The address came from the supplied observation; no chain result was invented.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "checkpoint-failed",
      message:
        error instanceof Error
          ? error.message
          : "The canonical address could not be checkpointed.",
    };
  }
}

// ---------------------------------------------------------------------------
// Prepare reserve (midnight-client descriptor; no signature, no submission)
// ---------------------------------------------------------------------------

export type PrepareReserveBlockedReason =
  | "kit-missing"
  | "kit-not-checkpointed"
  | "kit-lost"
  | "wallet-missing"
  | "wallet-not-connected"
  | "network-wrong"
  | "contract-address-missing"
  | "private-state-missing"
  | "providers-incomplete"
  | "submit-path-unavailable";

export type PrepareReserveAssessment =
  | { readonly ready: true }
  | {
      readonly ready: false;
      readonly reason: PrepareReserveBlockedReason;
      readonly message: string;
    };

const PREPARE_COPY: Record<PrepareReserveBlockedReason, string> = {
  "kit-missing":
    "Create, verify and checkpoint the local recovery context before preparing a reserve.",
  "kit-not-checkpointed":
    "A commercial reserve needs a bound canonical address. Checkpoint an observed deployment address first.",
  "kit-lost":
    "Capability reported lost. Reserve preparation is unavailable; this order is read-only.",
  "wallet-missing":
    "No compatible Midnight wallet (API v4) was found. Install or unlock the extension, then retry.",
  "wallet-not-connected":
    "A connected PREPROD wallet is required before preparing a reserve. Connect Midnight Lace and retry.",
  "network-wrong":
    "Unsupported Midnight network. Only PREPROD is enabled; Mainnet is blocked.",
  "contract-address-missing":
    "A checkpointed canonical contract address is required to prepare a reserve.",
  "private-state-missing":
    "Buyer private state (secret, agreed terms and approval limit) is required. Secrets stay on this device and are never requested here.",
  "providers-incomplete":
    "Provider assembly is incomplete. The browser proof/wallet provider slots are not shipped in this build, so a reserve cannot be prepared yet.",
  "submit-path-unavailable":
    "Prove, balance and submit are not available in this build. Preparing a reserve is a descriptor only; no signed transaction will be produced until the wallet-mediated submit path is ready.",
};

function missingProviderSlots(
  providers: Partial<MidnightProviderSlots>,
): string[] {
  const required: (keyof MidnightProviderSlots)[] = [
    "privateStateProvider",
    "publicDataProvider",
    "zkConfigProvider",
    "proofProvider",
    "walletProvider",
    "midnightProvider",
  ];
  return required.filter(
    (slot) => providers[slot] === undefined || providers[slot] === null,
  );
}

export type PrepareReserveInput = {
  readonly kit: RecoveryKit | null | undefined;
  readonly wallet: WalletConnectionState | null | undefined;
  readonly privateState: BuyerPrivateState | null | undefined;
  readonly providers: Partial<MidnightProviderSlots>;
  readonly expectedRevision?: bigint;
};

/**
 * Ordered fail-closed gate in front of `prepareReserveCall`. Each check names
 * the missing piece; nothing here contacts the wallet or chain.
 */
export function assessPrepareReserve(
  input: PrepareReserveInput,
): PrepareReserveAssessment {
  const kit = input.kit;
  if (!kit) {
    return {
      ready: false,
      reason: "kit-missing",
      message: PREPARE_COPY["kit-missing"],
    };
  }
  if (kit.stage === "LOST") {
    return {
      ready: false,
      reason: "kit-lost",
      message: PREPARE_COPY["kit-lost"],
    };
  }
  if (kit.stage !== "CHECKPOINTED" || !kit.address) {
    return {
      ready: false,
      reason: "kit-not-checkpointed",
      message: PREPARE_COPY["kit-not-checkpointed"],
    };
  }
  const wallet = input.wallet;
  if (!wallet || wallet.status === "disconnected") {
    return {
      ready: false,
      reason: wallet ? "wallet-not-connected" : "wallet-missing",
      message: wallet
        ? PREPARE_COPY["wallet-not-connected"]
        : PREPARE_COPY["wallet-missing"],
    };
  }
  if (wallet.status === "connecting") {
    return {
      ready: false,
      reason: "wallet-not-connected",
      message: PREPARE_COPY["wallet-not-connected"],
    };
  }
  if (wallet.status === "error") {
    return {
      ready: false,
      reason: "wallet-not-connected",
      message: PREPARE_COPY["wallet-not-connected"],
    };
  }
  if (wallet.networkId !== SUPPORTED_MIDNIGHT_NETWORK) {
    return {
      ready: false,
      reason: "network-wrong",
      message: PREPARE_COPY["network-wrong"],
    };
  }
  if (!input.privateState) {
    return {
      ready: false,
      reason: "private-state-missing",
      message: PREPARE_COPY["private-state-missing"],
    };
  }
  const missing = missingProviderSlots(input.providers);
  if (missing.length > 0) {
    return {
      ready: false,
      reason: "providers-incomplete",
      message: `${PREPARE_COPY["providers-incomplete"]} Missing: ${missing.join(", ")}.`,
    };
  }
  if (RESERVE_SUBMIT_PATH === "UNKNOWN") {
    // Preparation itself is allowed — it returns a descriptor and does not
    // sign. This reason is surfaced as a status note, not a hard block on the
    // prepare call, because the descriptor is still useful and honest.
    return { ready: true };
  }
  return { ready: true };
}

export type PrepareReserveResult =
  | {
      readonly ok: true;
      readonly prepared: PreparedReserveCall;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly reason: PrepareReserveBlockedReason | "prepare-failed";
      readonly message: string;
    };

/**
 * Prepare a buyer `reserve` descriptor through midnight-client. Fails closed
 * on any missing prerequisite. Success means a validated descriptor only —
 * never a signed transaction and never a completed reserve.
 */
export function prepareBuyerReserve(
  input: PrepareReserveInput,
): PrepareReserveResult {
  const assessment = assessPrepareReserve(input);
  if (!assessment.ready) {
    return {
      ok: false,
      reason: assessment.reason,
      message: assessment.message,
    };
  }
  const kit = input.kit as RecoveryKit;
  const wallet = input.wallet as Extract<
    WalletConnectionState,
    { status: "connected" }
  >;
  try {
    const prepared = prepareReserveCall({
      network: SUPPORTED_MIDNIGHT_NETWORK,
      wallet,
      contractAddress: kit.address as string,
      expectedRevision: input.expectedRevision ?? 0n,
      privateState: input.privateState as BuyerPrivateState,
      providers: input.providers,
    });
    return {
      ok: true,
      prepared,
      message: `Reserve call prepared (descriptor only; not signed or submitted). Circuit "${prepared.request.circuit}" targets revision ${prepared.request.expectedRevision}. Wallet-signed reserve runtime: ${RESERVE_SUBMIT_PATH}.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "prepare-failed",
      message:
        error instanceof Error
          ? error.message
          : "Reserve preparation failed closed.",
    };
  }
}

// ---------------------------------------------------------------------------
// In-flight operation tracking (begin / confirm) — real transitions only
// ---------------------------------------------------------------------------

export type BeginReserveResult =
  | { readonly ok: true; readonly kit: RecoveryKit; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "begin-failed";
      readonly message: string;
    };

/**
 * Record an in-flight reserve on the recovery kit. Call only when a real
 * submission attempt is underway (or about to be): begin leaves the kit
 * unusable until confirm or abandon. Never invents a transaction identity.
 */
export function beginReserveOperation(
  kit: RecoveryKit,
  identity: string,
  revision: number,
): BeginReserveResult {
  try {
    const next = beginOperation(kit, "reserve", identity, revision);
    return {
      ok: true,
      kit: next,
      message: `Reserve operation begun for identity ${identity} at revision ${revision}. The kit is unusable until this operation is confirmed by a real observation or abandoned for reconciliation.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "begin-failed",
      message:
        error instanceof Error
          ? error.message
          : "The reserve operation could not be begun.",
    };
  }
}

export type ConfirmReserveResult =
  | { readonly ok: true; readonly kit: RecoveryKit; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "confirm-failed" | "no-observation";
      readonly message: string;
    };

/**
 * Confirm a reserve only from a real observed transition (identity + revision).
 * Passing no observation fails closed — this function never fabricates a
 * chain result and never marks an order usable without evidence.
 */
export function confirmObservedReserve(
  kit: RecoveryKit,
  observation: { identity: string; revision: number } | null | undefined,
): ConfirmReserveResult {
  if (!observation) {
    return {
      ok: false,
      reason: "no-observation",
      message:
        "No observed transition is available. A reserve is confirmed only after a real chain observation matches the pending identity and revision.",
    };
  }
  try {
    const next = confirmOperation(
      kit,
      observation.identity,
      observation.revision,
    );
    return {
      ok: true,
      kit: next,
      message: `Reserve confirmed from observation ${observation.identity} at revision ${observation.revision}.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "confirm-failed",
      message:
        error instanceof Error
          ? error.message
          : "The observed transition does not confirm this reserve.",
    };
  }
}

/** Honest run-status copy for the export/run surface. */
export function reserveRunStatus(): string {
  return `Wallet-signed reserve runtime: ${RESERVE_SUBMIT_PATH}. Prepare produces a descriptor only. No reserve is claimed complete without a real signed transaction and a matching observation.`;
}
