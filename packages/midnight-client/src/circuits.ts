/**
 * Circuit-call surface for the buyer `reserve` and merchant `accept` paths.
 *
 * Wave A ships types, provider-assembly boundaries, and fail-closed gates only.
 * It does not prove, sign, balance, or submit. Openings (terms, capability
 * secrets) must never cross as transaction arguments (packages/contract/SPEC.md).
 * Commitments are produced by the generated module's `pureCircuits`
 * (`hashTerms` / `hashCapability`) — never reimplemented in this package.
 */

import {
  assertSupportedNetwork,
  SUPPORTED_MIDNIGHT_NETWORK,
  type SupportedMidnightNetwork,
} from "./network";
import type { BuyerPrivateState, MerchantPrivateState } from "./types";
import { assertWalletConnected, type WalletConnectionState } from "./wallet";

/**
 * Runtime status of the wallet-signed reserve/accept path.
 *
 * Wave A did not exercise a real Lace wallet in this environment. Interfaces
 * and fail-closed gates are implemented and unit-tested; on-chain wallet-signed
 * reserve remains UNKNOWN until a browser wallet session is run end-to-end.
 */
export const WALLET_SIGNED_RESERVE_RUNTIME = "UNKNOWN" as const;
export type WalletSignedReserveRuntime = typeof WALLET_SIGNED_RESERVE_RUNTIME;

/** Circuit call descriptors. The only state argument is `expectedRevision`. */
export type ReserveRequest = {
  readonly circuit: "reserve";
  readonly expectedRevision: bigint;
};

export type AcceptRequest = {
  readonly circuit: "accept";
  readonly expectedRevision: bigint;
};

export type OrderCircuitRequest = ReserveRequest | AcceptRequest;

/**
 * Provider assembly boundary — the six required `MidnightProviders` slots
 * (01-blueprint §3.7). A slot is a functional role, not a package count.
 * The optional logger is not a seventh required provider.
 *
 * Concrete SDK providers are assembled in Wave B from a validated
 * (network, wallet connection/key context, actor, contract/artifact version)
 * tuple. Wave A keeps the boundary structural so it does not invent APIs.
 */
export type MidnightProviderSlots = {
  /** Manages actor-local private state (secrets never leave the browser). */
  readonly privateStateProvider: unknown;
  /** Reads public chain data. */
  readonly publicDataProvider: unknown;
  /** Resolves ZK artifacts (prover/verifier keys, ZKIR). */
  readonly zkConfigProvider: unknown;
  /** Creates proven, unbalanced transactions. */
  readonly proofProvider: unknown;
  /** Creates proven, balanced transactions (wallet-mediated). */
  readonly walletProvider: unknown;
  /** Submits proven, balanced transactions. */
  readonly midnightProvider: unknown;
};

export type ProviderAssemblyInput = {
  readonly network: SupportedMidnightNetwork;
  readonly contractAddress: string;
  readonly slots: Partial<MidnightProviderSlots>;
};

export type AssembledProviders = {
  readonly network: SupportedMidnightNetwork;
  readonly contractAddress: string;
  readonly providers: MidnightProviderSlots;
};

const REQUIRED_SLOTS = [
  "privateStateProvider",
  "publicDataProvider",
  "zkConfigProvider",
  "proofProvider",
  "walletProvider",
  "midnightProvider",
] as const;

/**
 * Assemble one typed provider tuple. Fail closed on a wrong network, a missing
 * contract address, or any missing slot. Does not contact the wallet or chain.
 */
export function assembleProviders(
  input: ProviderAssemblyInput,
): AssembledProviders {
  assertSupportedNetwork(input.network);
  if (
    typeof input.contractAddress !== "string" ||
    input.contractAddress.length === 0
  ) {
    throw new Error("A deployed contract address is required.");
  }
  const missing = REQUIRED_SLOTS.filter(
    (slot) => input.slots[slot] === undefined || input.slots[slot] === null,
  );
  if (missing.length > 0) {
    throw new Error(
      `Provider assembly is incomplete; missing: ${missing.join(", ")}`,
    );
  }
  return {
    network: input.network,
    contractAddress: input.contractAddress,
    providers: input.slots as MidnightProviderSlots,
  };
}

export type ReserveCallInput = {
  readonly network: string;
  readonly wallet: WalletConnectionState;
  readonly contractAddress: string;
  readonly expectedRevision: bigint;
  readonly privateState: BuyerPrivateState;
  readonly providers: Partial<MidnightProviderSlots>;
};

export type AcceptCallInput = {
  readonly network: string;
  readonly wallet: WalletConnectionState;
  readonly contractAddress: string;
  readonly expectedRevision: bigint;
  readonly privateState: MerchantPrivateState;
  readonly providers: Partial<MidnightProviderSlots>;
};

export type PreparedReserveCall = {
  readonly request: ReserveRequest;
  readonly assembly: AssembledProviders;
  readonly privateState: BuyerPrivateState;
};

export type PreparedAcceptCall = {
  readonly request: AcceptRequest;
  readonly assembly: AssembledProviders;
  readonly privateState: MerchantPrivateState;
};

function assertRevision(expectedRevision: bigint) {
  if (typeof expectedRevision !== "bigint" || expectedRevision < 0n) {
    throw new Error("expectedRevision must be a non-negative bigint.");
  }
}

function assertBuyerState(state: BuyerPrivateState) {
  if (state?.actor !== "buyer") {
    throw new Error("Buyer private state is required for reserve.");
  }
  if (!(state.secret instanceof Uint8Array) || state.secret.length !== 32) {
    throw new Error("Buyer secret must be 32 bytes.");
  }
  if (typeof state.limit !== "bigint" || state.limit < 0n) {
    throw new Error("Buyer approval limit must be a non-negative bigint.");
  }
  if (!state.terms) {
    throw new Error("Agreed terms opening is required for reserve.");
  }
}

function assertMerchantState(state: MerchantPrivateState) {
  if (state?.actor !== "merchant") {
    throw new Error("Merchant private state is required for accept.");
  }
  if (!(state.secret instanceof Uint8Array) || state.secret.length !== 32) {
    throw new Error("Merchant secret must be 32 bytes.");
  }
  if (!state.terms) {
    throw new Error("Agreed terms opening is required for accept.");
  }
}

/**
 * Validate and assemble a buyer `reserve` call. Fail closed if the wallet or
 * network is wrong, the revision is invalid, private state is incomplete, or
 * any provider slot is missing. Returns a descriptor only — no proof, no
 * signature, no submission.
 */
export function prepareReserveCall(
  input: ReserveCallInput,
): PreparedReserveCall {
  assertSupportedNetwork(input.network);
  assertWalletConnected(input.wallet);
  assertRevision(input.expectedRevision);
  assertBuyerState(input.privateState);
  const assembly = assembleProviders({
    network: SUPPORTED_MIDNIGHT_NETWORK,
    contractAddress: input.contractAddress,
    slots: input.providers,
  });
  return {
    request: {
      circuit: "reserve",
      expectedRevision: input.expectedRevision,
    },
    assembly,
    privateState: input.privateState,
  };
}

/**
 * Validate and assemble a merchant `accept` call. Same fail-closed rules as
 * `prepareReserveCall`.
 */
export function prepareAcceptCall(input: AcceptCallInput): PreparedAcceptCall {
  assertSupportedNetwork(input.network);
  assertWalletConnected(input.wallet);
  assertRevision(input.expectedRevision);
  assertMerchantState(input.privateState);
  const assembly = assembleProviders({
    network: SUPPORTED_MIDNIGHT_NETWORK,
    contractAddress: input.contractAddress,
    slots: input.providers,
  });
  return {
    request: {
      circuit: "accept",
      expectedRevision: input.expectedRevision,
    },
    assembly,
    privateState: input.privateState,
  };
}
