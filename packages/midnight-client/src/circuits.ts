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

export const WALLET_SIGNED_RESERVE_RUNTIME = "UNKNOWN" as const;
export type WalletSignedReserveRuntime = typeof WALLET_SIGNED_RESERVE_RUNTIME;

export type ReserveRequest = {
  readonly circuit: "reserve";
  readonly expectedRevision: bigint;
};
export type AcceptRequest = {
  readonly circuit: "accept";
  readonly expectedRevision: bigint;
};
export type OrderCircuitRequest = ReserveRequest | AcceptRequest;

export type { AssembledProviders, MidnightProviderSlots };

export type ProviderAssemblyInput = {
  readonly network: SupportedMidnightNetwork;
  readonly contractAddress: string;
  readonly slots: Partial<MidnightProviderSlots>;
};

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

type CallInput = {
  readonly network: string;
  readonly wallet: WalletConnectionState;
  readonly contractAddress: string;
  readonly expectedRevision: bigint;
  readonly providers: Partial<MidnightProviderSlots>;
};

export type ReserveCallInput = CallInput & {
  readonly privateState: BuyerPrivateState;
};
export type AcceptCallInput = CallInput & {
  readonly privateState: MerchantPrivateState;
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

const SECRET_BYTES = 32;
function assertRevision(expectedRevision: bigint) {
  if (typeof expectedRevision !== "bigint" || expectedRevision < 0n)
    throw new Error("expectedRevision must be a non-negative bigint.");
}

function assertSecret(secret: unknown, role: "Buyer" | "Merchant") {
  if (!(secret instanceof Uint8Array) || secret.length !== SECRET_BYTES)
    throw new Error(`${role} secret must be ${SECRET_BYTES} bytes.`);
}
function assertTerms(terms: unknown, circuit: "reserve" | "accept") {
  if (!terms)
    throw new Error(`Agreed terms opening is required for ${circuit}.`);
}

function assertBuyerState(state: BuyerPrivateState) {
  if (state?.actor !== "buyer")
    throw new Error("Buyer private state is required for reserve.");
  assertSecret(state.secret, "Buyer");
  if (typeof state.limit !== "bigint" || state.limit < 0n)
    throw new Error("Buyer approval limit must be a non-negative bigint.");
  assertTerms(state.terms, "reserve");
}

function assertMerchantState(state: MerchantPrivateState) {
  if (state?.actor !== "merchant")
    throw new Error("Merchant private state is required for accept.");
  assertSecret(state.secret, "Merchant");
  assertTerms(state.terms, "accept");
}

function assertCall(input: CallInput, assertState: () => void) {
  assertSupportedNetwork(input.network);
  assertWalletConnected(input.wallet);
  assertRevision(input.expectedRevision);
  assertState();
  return assembleProviders({
    network: SUPPORTED_MIDNIGHT_NETWORK,
    contractAddress: input.contractAddress,
    slots: input.providers,
  });
}

export function prepareReserveCall(
  input: ReserveCallInput,
): PreparedReserveCall {
  const assembly = assertCall(input, () =>
    assertBuyerState(input.privateState),
  );
  return {
    request: { circuit: "reserve", expectedRevision: input.expectedRevision },
    assembly,
    privateState: input.privateState,
  };
}

export function prepareAcceptCall(input: AcceptCallInput): PreparedAcceptCall {
  const assembly = assertCall(input, () =>
    assertMerchantState(input.privateState),
  );
  return {
    request: { circuit: "accept", expectedRevision: input.expectedRevision },
    assembly,
    privateState: input.privateState,
  };
}
