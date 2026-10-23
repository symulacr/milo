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

const RESERVE_SUBMIT_PATH: "UNKNOWN" = WALLET_SIGNED_RESERVE_RUNTIME;

type CheckpointBlockedReason =
  | "kit-missing"
  | "kit-not-verified"
  | "kit-already-checkpointed"
  | "kit-lost"
  | "deployment-not-observable"
  | "address-missing"
  | "address-is-order-nonce";

type CheckpointAssessment =
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

const blocked = (
  reason: CheckpointBlockedReason,
  message: string,
): CheckpointAssessment => ({ ready: false, reason, message });

export function assessCheckpoint(
  kit: RecoveryKit | null | undefined,
  observedAddress: string | null | undefined,
): CheckpointAssessment {
  if (!kit) return blocked("kit-missing", CHECKPOINT_COPY["kit-missing"]);
  if (kit.stage === "LOST")
    return blocked("kit-lost", CHECKPOINT_COPY["kit-lost"]);
  if (kit.stage === "CHECKPOINTED")
    return blocked(
      "kit-already-checkpointed",
      CHECKPOINT_COPY["kit-already-checkpointed"],
    );
  if (kit.stage !== "VERIFIED")
    return blocked("kit-not-verified", CHECKPOINT_COPY["kit-not-verified"]);

  const address = (observedAddress ?? "").trim();
  if (address.length === 0) {
    const absent = observedAddress === null || observedAddress === undefined;
    return absent
      ? blocked(
          "deployment-not-observable",
          CHECKPOINT_COPY["deployment-not-observable"],
        )
      : blocked("address-missing", CHECKPOINT_COPY["address-missing"]);
  }
  if (address === kit.orderNonce)
    return blocked(
      "address-is-order-nonce",
      CHECKPOINT_COPY["address-is-order-nonce"],
    );
  return { ready: true, address };
}

type CheckpointResult =
  | { readonly ok: true; readonly kit: RecoveryKit; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: CheckpointBlockedReason | "checkpoint-failed";
      readonly message: string;
    };

const reasonOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export function applyCheckpoint(
  kit: RecoveryKit | null | undefined,
  observedAddress: string | null | undefined,
): CheckpointResult {
  const assessment = assessCheckpoint(kit, observedAddress);
  if (!assessment.ready)
    return {
      ok: false,
      reason: assessment.reason,
      message: assessment.message,
    };
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
      message: reasonOf(
        error,
        "The canonical address could not be checkpointed.",
      ),
    };
  }
}

type PrepareReserveBlockedReason =
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

type PrepareReserveAssessment =
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

const REQUIRED_SLOTS: readonly (keyof MidnightProviderSlots)[] = [
  "privateStateProvider",
  "publicDataProvider",
  "zkConfigProvider",
  "proofProvider",
  "walletProvider",
  "midnightProvider",
];

function missingProviderSlots(
  providers: Partial<MidnightProviderSlots>,
): string[] {
  return REQUIRED_SLOTS.filter(
    (slot) => providers[slot] === undefined || providers[slot] === null,
  );
}

const prepareBlocked = (
  reason: PrepareReserveBlockedReason,
  message = PREPARE_COPY[reason],
): PrepareReserveAssessment => ({ ready: false, reason, message });

export type PrepareReserveInput = {
  readonly kit: RecoveryKit | null | undefined;
  readonly wallet: WalletConnectionState | null | undefined;
  readonly privateState: BuyerPrivateState | null | undefined;
  readonly providers: Partial<MidnightProviderSlots>;
  readonly expectedRevision?: bigint;
};

export function assessPrepareReserve(
  input: PrepareReserveInput,
): PrepareReserveAssessment {
  const kit = input.kit;
  if (!kit) return prepareBlocked("kit-missing");
  if (kit.stage === "LOST") return prepareBlocked("kit-lost");
  if (kit.stage !== "CHECKPOINTED" || !kit.address)
    return prepareBlocked("kit-not-checkpointed");

  const wallet = input.wallet;
  if (!wallet) return prepareBlocked("wallet-missing");
  if (wallet.status !== "connected")
    return prepareBlocked("wallet-not-connected");
  if (wallet.networkId !== SUPPORTED_MIDNIGHT_NETWORK)
    return prepareBlocked("network-wrong");
  if (!input.privateState) return prepareBlocked("private-state-missing");

  const missing = missingProviderSlots(input.providers);
  if (missing.length > 0)
    return prepareBlocked(
      "providers-incomplete",
      `${PREPARE_COPY["providers-incomplete"]} Missing: ${missing.join(", ")}.`,
    );
  return { ready: true };
}

type PrepareReserveResult =
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

export function prepareBuyerReserve(
  input: PrepareReserveInput,
): PrepareReserveResult {
  const assessment = assessPrepareReserve(input);
  if (!assessment.ready)
    return {
      ok: false,
      reason: assessment.reason,
      message: assessment.message,
    };
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
      message: reasonOf(error, "Reserve preparation failed closed."),
    };
  }
}

type BeginReserveResult =
  | { readonly ok: true; readonly kit: RecoveryKit; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "begin-failed";
      readonly message: string;
    };

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
      message: reasonOf(error, "The reserve operation could not be begun."),
    };
  }
}

type ConfirmReserveResult =
  | { readonly ok: true; readonly kit: RecoveryKit; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "confirm-failed" | "no-observation";
      readonly message: string;
    };

export function confirmObservedReserve(
  kit: RecoveryKit,
  observation: { identity: string; revision: number } | null | undefined,
): ConfirmReserveResult {
  if (!observation)
    return {
      ok: false,
      reason: "no-observation",
      message:
        "No observed transition is available. A reserve is confirmed only after a real chain observation matches the pending identity and revision.",
    };
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
      message: reasonOf(
        error,
        "The observed transition does not confirm this reserve.",
      ),
    };
  }
}

export function reserveRunStatus(): string {
  return `Wallet-signed reserve runtime: ${RESERVE_SUBMIT_PATH}. Prepare produces a descriptor only. No reserve is claimed complete without a real signed transaction and a matching observation.`;
}
