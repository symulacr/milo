import {
  classifyMidnightClientError,
  rethrowAsMidnightClientError,
} from "./errors.ts";
import {
  assertNetworkGuard,
  type LocalDisposableNetwork,
  type NetworkForGuard,
  type NetworkGuardMode,
  type SupportedMidnightNetwork,
} from "./network.ts";

export type PrivateStateProviderSlot = unknown;
export type PublicDataProviderSlot = unknown;
export type ZkConfigProviderSlot = unknown;
export type ProofProviderSlot = {
  proveTx(...args: unknown[]): Promise<unknown>;
};
export type WalletProviderSlot = {
  getCoinPublicKey(): string;
  getEncryptionPublicKey(): string;
  balanceTx(tx: unknown, ttl?: Date): Promise<unknown>;
};
export type MidnightProviderSlot = {
  submitTx(tx: unknown): Promise<string>;
};
export type MidnightProviderSlots = {
  readonly privateStateProvider: PrivateStateProviderSlot;
  readonly publicDataProvider: PublicDataProviderSlot;
  readonly zkConfigProvider: ZkConfigProviderSlot;
  readonly proofProvider: ProofProviderSlot;
  readonly walletProvider: WalletProviderSlot;
  readonly midnightProvider: MidnightProviderSlot;
};
export type AssembledProviders = {
  readonly network: SupportedMidnightNetwork | LocalDisposableNetwork;
  readonly guard: NetworkGuardMode;
  readonly contractAddress: string;
  readonly providers: MidnightProviderSlots;
};
export type WalletSecretKeys = {
  readonly dustSecretKey: unknown;
  readonly shieldedSecretKeys?: unknown;
};
export type WalletRecipeRuntime = {
  balanceUnboundTransaction(
    tx: unknown,
    secretKeys: WalletSecretKeys,
    options: { ttl: Date },
  ): Promise<unknown>;
  signRecipe(
    recipe: unknown,
    signer: (payload: unknown) => unknown,
  ): Promise<unknown>;
  finalizeRecipe(signed: unknown): Promise<unknown>;
};
export type WalletActor = {
  getCoinPublicKey(): string;
  getEncryptionPublicKey(): string;
  submitTx(tx: unknown): Promise<string>;
  readonly zswapSecretKeys: unknown;
  readonly dustSecretKey: unknown;
  readonly unshieldedKeystore: { signData(payload: unknown): unknown };
  wallet: WalletRecipeRuntime;
};
export type ProofRuntime = { proveTx(...args: unknown[]): Promise<unknown> };
export type FactoryEvent = (
  event: string,
  fields?: Record<string, unknown>,
) => void;
export type BalanceStrategy = "skip-estimate" | "dust-readiness" | "injected";
export type BalanceTxFn = (tx: unknown, ttl?: Date) => Promise<unknown>;
export type WaitForBalancedRecipe = (
  wallet: WalletRecipeRuntime,
  tx: unknown,
  secretKeys: WalletSecretKeys,
  options: { ttl: Date; deadline: number; emit: FactoryEvent },
) => Promise<unknown>;
export type ProviderFactoryInput<M extends NetworkGuardMode> = {
  readonly guard: M;
  readonly network: NetworkForGuard<M>;
  readonly contractAddress: string;
  readonly privateStateProvider: PrivateStateProviderSlot;
  readonly publicDataProvider: PublicDataProviderSlot;
  readonly zkConfigProvider: ZkConfigProviderSlot;
  readonly proof: ProofRuntime;
  readonly actor: WalletActor;
  readonly balanceStrategy?: BalanceStrategy;
  readonly balanceTx?: BalanceTxFn;
  readonly waitForBalancedRecipe?: WaitForBalancedRecipe;
  readonly onEvent?: FactoryEvent;
  readonly ttlMs?: number;
  readonly deadlineMs?: number;
  readonly beforeSubmit?: (tx: unknown) => Promise<void> | void;
};

type BuildInput = ProviderFactoryInput<NetworkGuardMode>;
type WalletBuildOptions = Pick<
  BuildInput,
  | "balanceStrategy"
  | "balanceTx"
  | "waitForBalancedRecipe"
  | "onEvent"
  | "ttlMs"
  | "deadlineMs"
>;
type MidnightBuildOptions = Pick<BuildInput, "onEvent" | "beforeSubmit">;
const DEFAULT_TTL_MS = 3_600_000;
const emitOrNoop =
  (onEvent: FactoryEvent | undefined): FactoryEvent =>
  (event, fields) => {
    if (onEvent) onEvent(event, fields);
  };
const secretKeysOf = (actor: WalletActor): WalletSecretKeys => ({
  dustSecretKey: actor.dustSecretKey,
  shieldedSecretKeys: actor.zswapSecretKeys,
});
function assertContractAddress(contractAddress: string): void {
  if (typeof contractAddress !== "string" || contractAddress.length === 0)
    throw new Error("A deployed contract address is required.");
  if (!/^[0-9a-f]{64}$/.test(contractAddress))
    throw new Error(
      "A deployed contract address must be 64 lowercase hex characters (no 0x prefix).",
    );
}

function failWith(
  error: unknown,
  emit: FactoryEvent,
  event: string,
  fields: Record<string, unknown>,
  fallbackMessage: string,
): never {
  emit(event, {
    ...fields,
    code: classifyMidnightClientError(error) ?? "UNKNOWN",
  });
  rethrowAsMidnightClientError(error, fallbackMessage);
}

export function buildWalletProvider(
  actor: WalletActor,
  options: WalletBuildOptions = {},
): WalletProviderSlot {
  const emit = emitOrNoop(options.onEvent);
  const strategy = options.balanceStrategy ?? "skip-estimate";
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (strategy === "injected" && typeof options.balanceTx !== "function")
    throw new Error('balanceStrategy "injected" requires a balanceTx function');
  if (strategy === "dust-readiness" && !options.waitForBalancedRecipe)
    throw new Error(
      'balanceStrategy "dust-readiness" requires waitForBalancedRecipe',
    );
  return {
    getCoinPublicKey: () => actor.getCoinPublicKey(),
    getEncryptionPublicKey: () => actor.getEncryptionPublicKey(),
    async balanceTx(tx: unknown, ttl?: Date) {
      const effectiveTtl = ttl ?? new Date(Date.now() + ttlMs);
      if (strategy === "injected" && options.balanceTx) {
        emit("balance-start", { strategy, mode: "injected" });
        const result = await options.balanceTx(tx, ttl);
        emit("balance-completed", { strategy, mode: "injected" });
        return result;
      }
      emit("balance-start", { strategy });
      try {
        const secretKeys = secretKeysOf(actor);
        const wait = options.waitForBalancedRecipe;
        const recipe =
          strategy === "dust-readiness" && wait
            ? await wait(actor.wallet, tx, secretKeys, {
                ttl: effectiveTtl,
                deadline: options.deadlineMs ?? Date.now() + ttlMs,
                emit,
              })
            : await actor.wallet.balanceUnboundTransaction(tx, secretKeys, {
                ttl: effectiveTtl,
              });
        const signed = await actor.wallet.signRecipe(recipe, (payload) =>
          actor.unshieldedKeystore.signData(payload),
        );
        const finalized = await actor.wallet.finalizeRecipe(signed);
        emit("balance-completed", { strategy });
        return finalized;
      } catch (error) {
        failWith(
          error,
          emit,
          "balance-failed",
          { strategy },
          "Wallet balancing, signing, or finalization failed.",
        );
      }
    },
  };
}

export function buildProofProvider(
  proof: ProofRuntime,
  options: { onEvent?: FactoryEvent } = {},
): ProofProviderSlot {
  const emit = emitOrNoop(options.onEvent);
  return {
    async proveTx(...args: unknown[]) {
      emit("prove-start");
      try {
        const result = await proof.proveTx(...args);
        emit("proof-provider-completed");
        return result;
      } catch (error) {
        failWith(
          error,
          emit,
          "proof-provider-failed",
          {},
          "Proof generation failed.",
        );
      }
    },
  };
}

export function buildMidnightProvider(
  actor: WalletActor,
  options: MidnightBuildOptions = {},
): MidnightProviderSlot {
  const emit = emitOrNoop(options.onEvent);
  return {
    async submitTx(tx: unknown) {
      if (options.beforeSubmit) await options.beforeSubmit(tx);
      try {
        const txId = await actor.submitTx(tx);
        emit("submitted", { txId });
        return txId;
      } catch (error) {
        failWith(
          error,
          emit,
          "submit-failed",
          {},
          "Transaction submission failed.",
        );
      }
    },
  };
}

export function assembleProviderFactory<M extends NetworkGuardMode>(
  input: ProviderFactoryInput<M>,
): AssembledProviders {
  assertNetworkGuard(input.network, input.guard);
  assertContractAddress(input.contractAddress);
  const onEvent = input.onEvent;
  return {
    network: input.network,
    guard: input.guard,
    contractAddress: input.contractAddress,
    providers: {
      privateStateProvider: input.privateStateProvider,
      publicDataProvider: input.publicDataProvider,
      zkConfigProvider: input.zkConfigProvider,
      proofProvider: buildProofProvider(input.proof, { onEvent }),
      walletProvider: buildWalletProvider(input.actor, {
        balanceStrategy: input.balanceStrategy ?? "skip-estimate",
        balanceTx: input.balanceTx,
        waitForBalancedRecipe: input.waitForBalancedRecipe,
        onEvent,
        ttlMs: input.ttlMs,
        deadlineMs: input.deadlineMs,
      }),
      midnightProvider: buildMidnightProvider(input.actor, {
        onEvent,
        beforeSubmit: input.beforeSubmit,
      }),
    },
  };
}
export const REQUIRED_PROVIDER_SLOTS = [
  "privateStateProvider",
  "publicDataProvider",
  "zkConfigProvider",
  "proofProvider",
  "walletProvider",
  "midnightProvider",
] as const;
export function missingProviderSlots(
  slots: Partial<MidnightProviderSlots>,
): (keyof MidnightProviderSlots)[] {
  return REQUIRED_PROVIDER_SLOTS.filter(
    (slot) => slots[slot] === undefined || slots[slot] === null,
  );
}
export function assembleProvidersFromSlots<M extends NetworkGuardMode>(input: {
  guard: M;
  network: NetworkForGuard<M>;
  contractAddress: string;
  slots: Partial<MidnightProviderSlots>;
}): AssembledProviders {
  assertNetworkGuard(input.network, input.guard);
  assertContractAddress(input.contractAddress);
  const missing = missingProviderSlots(input.slots);
  if (missing.length > 0)
    throw new Error(
      `Provider assembly is incomplete; missing: ${missing.join(", ")}`,
    );
  return {
    network: input.network,
    guard: input.guard,
    contractAddress: input.contractAddress,
    providers: input.slots as MidnightProviderSlots,
  };
}

export {
  classifyMidnightClientError,
  InsufficientDustError,
  isInsufficientDustError,
  isLockedWalletError,
  isRejectedSignatureError,
  isWrongNetworkError,
  LockedWalletError,
  MidnightClientError,
  type MidnightClientErrorCode,
  RejectedSignatureError,
  rethrowAsMidnightClientError,
  WrongNetworkError,
} from "./errors.ts";
