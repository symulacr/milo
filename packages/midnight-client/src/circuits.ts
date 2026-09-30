/**
 * Circuit-call surface for the buyer `reserve` and merchant `accept` paths.
 *
 * Provider assembly is owned by provider-factory.ts (the one factory used by
 * packages/midnight-client and packages/integration). This module keeps the
 * prepare-reserve / prepare-accept descriptors and their fail-closed gates.
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
} from "./network.ts";
import {
  type AssembledProviders,
  assembleProvidersFromSlots,
  type MidnightProviderSlots,
} from "./provider-factory.ts";
import type { BuyerPrivateState, MerchantPrivateState } from "./types.ts";
import { assertWalletConnected, type WalletConnectionState } from "./wallet.ts";

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

/** Re-exported for callers that still build slots structurally. */
export type { AssembledProviders, MidnightProviderSlots };

export type ProviderAssemblyInput = {
  readonly network: SupportedMidnightNetwork;
  readonly contractAddress: string;
  readonly slots: Partial<MidnightProviderSlots>;
};

/**
 * Assemble one typed provider tuple from already-built slots. Fail closed on
 * a wrong network, a missing contract address, or any missing slot. Does not
 * contact the wallet or chain. New callers with concrete runtimes should use
 * `assembleProviderFactory` instead (same factory, builds the wrappers).
 */
export function assembleProviders(
  input: ProviderAssemblyInput,
): AssembledProviders {
  return assembleProvidersFromSlots({
    guard: "preprod-only",
    network: input.network,
    contractAddress: input.contractAddress,
    slots: input.slots,
  });
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
