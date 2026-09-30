/**
 * The one provider-assembly factory (01-blueprint §3.7).
 *
 * Single construction point for the six required `MidnightProviders` slots,
 * used by packages/midnight-client (browser prepare path) and
 * packages/integration (Node local/preprod lane via
 * packages/integration/src/provider-assembly.mjs).
 *
 * The factory owns:
 *   - network guard (compile-time narrowing + runtime `WrongNetworkError`)
 *   - fail-closed slot completeness
 *   - walletProvider / proofProvider / midnightProvider wrappers shared by
 *     every local driver (wallet: balance → sign → finalize; proof: emit;
 *     submit: emit + txId)
 *
 * It does NOT import testkit, wallet-sdk, or any network client. Callers
 * inject the concrete runtimes. No stubs: every wrapper performs the real
 * call on the injected runtime and rethrows failures as taxonomy errors.
 */

import {
  classifyMidnightClientError,
  InsufficientDustError,
  LockedWalletError,
  type MidnightClientErrorCode,
  RejectedSignatureError,
  rethrowAsMidnightClientError,
} from "./errors.ts";
import {
  assertNetworkGuard,
  type LocalDisposableNetwork,
  type NetworkForGuard,
  type NetworkGuardMode,
  type SupportedMidnightNetwork,
} from "./network.ts";

/** Manages actor-local private state (secrets never leave the actor). */
export type PrivateStateProviderSlot = unknown;
/** Reads public chain data / watches transaction outcomes. */
export type PublicDataProviderSlot = unknown;
/** Resolves ZK artifacts (prover/verifier keys, ZKIR). */
export type ZkConfigProviderSlot = unknown;
/** Creates proven, unbalanced transactions. */
export type ProofProviderSlot = {
  proveTx(...args: unknown[]): Promise<unknown>;
};
/** Creates proven, balanced transactions (wallet-mediated). */
export type WalletProviderSlot = {
  getCoinPublicKey(): string;
  getEncryptionPublicKey(): string;
  balanceTx(tx: unknown, ttl?: Date): Promise<unknown>;
};
/** Submits proven, balanced transactions. */
export type MidnightProviderSlot = {
  submitTx(tx: unknown): Promise<string>;
};

/**
 * Provider assembly boundary — the six required `MidnightProviders` slots.
 * A slot is a functional role, not a package count. The optional logger is
 * not a seventh required provider.
 */
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

/** Secret-key bundle the wallet runtime needs to balance a transaction. */
export type WalletSecretKeys = {
  readonly dustSecretKey: unknown;
  readonly shieldedSecretKeys?: unknown;
};

/** Minimal wallet actor surface the factory wraps into `walletProvider`. */
export type WalletActor = {
  getCoinPublicKey(): string;
  getEncryptionPublicKey(): string;
  submitTx(tx: unknown): Promise<string>;
  readonly zswapSecretKeys: unknown;
  readonly dustSecretKey: unknown;
  readonly unshieldedKeystore: {
    signData(payload: unknown): unknown;
  };
  wallet: {
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
};

export type ProofRuntime = {
  proveTx(...args: unknown[]): Promise<unknown>;
};

export type FactoryEvent = (
  event: string,
  fields?: Record<string, unknown>,
) => void;

/**
 * How `walletProvider.balanceTx` obtains a balanced recipe.
 *   - `"skip-estimate"`     — wait for any positive DUST balance, then balance
 *     (local-happy / local-circuit-sweep: estimateTransactionFee hung on call txs)
 *   - `"dust-readiness"`    — wait until observed DUST covers the estimated fee,
 *     retrying on typed insufficient-DUST (local-ops / local.mjs)
 *   - `"injected"`          — caller supplies `balanceTx` (tests, specialized lanes)
 */
export type BalanceStrategy = "skip-estimate" | "dust-readiness" | "injected";

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
  /**
   * Required when `balanceStrategy` is `"injected"`. Returns the already
   * balanced, signed, finalized transaction the proof pipeline produced.
   */
  readonly balanceTx?: (tx: unknown, ttl?: Date) => Promise<unknown>;
  /**
   * Required when `balanceStrategy` is `"dust-readiness"`. Returns the
   * balancing recipe (not yet signed).
   */
  readonly waitForBalancedRecipe?: (
    wallet: WalletActor["wallet"],
    tx: unknown,
    secretKeys: WalletSecretKeys,
    options: {
      ttl: Date;
      deadline: number;
      emit: FactoryEvent;
    },
  ) => Promise<unknown>;
  readonly onEvent?: FactoryEvent;
  /** Default TTL for `balanceTx` when the caller omits one. */
  readonly ttlMs?: number;
  /** Deadline (epoch ms) for dust-readiness waits. */
  readonly deadlineMs?: number;
  /** Extra hook around `submitTx` (resource preflight, fences). */
  readonly beforeSubmit?: (tx: unknown) => Promise<void> | void;
};

const DEFAULT_TTL_MS = 3_600_000;

function emitOrNoop(onEvent: FactoryEvent | undefined): FactoryEvent {
  return (event, fields) => {
    if (onEvent) onEvent(event, fields);
  };
}

function secretKeysOf(actor: WalletActor): WalletSecretKeys {
  return {
    dustSecretKey: actor.dustSecretKey,
    shieldedSecretKeys: actor.zswapSecretKeys,
  };
}

function assertContractAddress(contractAddress: string): void {
  if (typeof contractAddress !== "string" || contractAddress.length === 0) {
    throw new Error("A deployed contract address is required.");
  }
}

/**
 * Build `walletProvider` from an actor. Always: balance → signRecipe →
 * finalizeRecipe. Signing/finalization are never retried with balancing
 * (they can reserve inputs).
 */
export function buildWalletProvider(
  actor: WalletActor,
  options: {
    balanceStrategy?: BalanceStrategy;
    balanceTx?: (tx: unknown, ttl?: Date) => Promise<unknown>;
    waitForBalancedRecipe?: ProviderFactoryInput<NetworkGuardMode>["waitForBalancedRecipe"];
    onEvent?: FactoryEvent;
    ttlMs?: number;
    deadlineMs?: number;
  } = {},
): WalletProviderSlot {
  const emit = emitOrNoop(options.onEvent);
  const strategy = options.balanceStrategy ?? "skip-estimate";
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  if (strategy === "injected") {
    if (typeof options.balanceTx !== "function") {
      throw new Error(
        'balanceStrategy "injected" requires a balanceTx function',
      );
    }
  }
  if (strategy === "dust-readiness" && !options.waitForBalancedRecipe) {
    throw new Error(
      'balanceStrategy "dust-readiness" requires waitForBalancedRecipe',
    );
  }

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
        let recipe: unknown;
        if (strategy === "dust-readiness" && options.waitForBalancedRecipe) {
          recipe = await options.waitForBalancedRecipe(
            actor.wallet,
            tx,
            secretKeysOf(actor),
            {
              ttl: effectiveTtl,
              deadline: options.deadlineMs ?? Date.now() + ttlMs,
              emit,
            },
          );
        } else {
          recipe = await actor.wallet.balanceUnboundTransaction(
            tx,
            secretKeysOf(actor),
            { ttl: effectiveTtl },
          );
        }
        // Signing/finalization can reserve inputs; never retry them with balancing.
        const signed = await actor.wallet.signRecipe(recipe, (payload) =>
          actor.unshieldedKeystore.signData(payload),
        );
        const finalized = await actor.wallet.finalizeRecipe(signed);
        emit("balance-completed", { strategy });
        return finalized;
      } catch (error) {
        const code = classifyMidnightClientError(error);
        emit("balance-failed", { strategy, code: code ?? "UNKNOWN" });
        rethrowAsMidnightClientError(
          error,
          "Wallet balancing, signing, or finalization failed.",
        );
      }
    },
  };
}

/**
 * Build `proofProvider` that emits start/completion around the real prover.
 * Failures are classified and rethrown as taxonomy errors.
 */
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
        const code = classifyMidnightClientError(error);
        emit("proof-provider-failed", { code: code ?? "UNKNOWN" });
        rethrowAsMidnightClientError(error, "Proof generation failed.");
      }
    },
  };
}

/**
 * Build `midnightProvider` that emits the submitted txId. Optional
 * `beforeSubmit` covers resource preflight / submission fences.
 */
export function buildMidnightProvider(
  actor: WalletActor,
  options: {
    onEvent?: FactoryEvent;
    beforeSubmit?: (tx: unknown) => Promise<void> | void;
  } = {},
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
        const code = classifyMidnightClientError(error);
        emit("submit-failed", { code: code ?? "UNKNOWN" });
        rethrowAsMidnightClientError(error, "Transaction submission failed.");
      }
    },
  };
}

/**
 * Assemble one typed provider tuple from concrete runtimes. Applies the
 * named network guard (compile-time + runtime), validates the contract
 * address, and builds the shared wallet/proof/submit wrappers.
 *
 * This is the single factory every caller must use. `assembleProviders`
 * (circuits.ts) remains the structural completeness check for already-built
 * slots; new call sites should prefer this function.
 */
export function assembleProviderFactory<M extends NetworkGuardMode>(
  input: ProviderFactoryInput<M>,
): AssembledProviders {
  assertNetworkGuard(input.network, input.guard);
  assertContractAddress(input.contractAddress);

  const onEvent = input.onEvent;
  const walletProvider = buildWalletProvider(input.actor, {
    balanceStrategy: input.balanceStrategy ?? "skip-estimate",
    balanceTx: input.balanceTx,
    waitForBalancedRecipe: input.waitForBalancedRecipe,
    onEvent,
    ttlMs: input.ttlMs,
    deadlineMs: input.deadlineMs,
  });
  const proofProvider = buildProofProvider(input.proof, { onEvent });
  const midnightProvider = buildMidnightProvider(input.actor, {
    onEvent,
    beforeSubmit: input.beforeSubmit,
  });

  return {
    network: input.network,
    guard: input.guard,
    contractAddress: input.contractAddress,
    providers: {
      privateStateProvider: input.privateStateProvider,
      publicDataProvider: input.publicDataProvider,
      zkConfigProvider: input.zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    },
  };
}

/** Required slot names in the official six-slot order. */
export const REQUIRED_PROVIDER_SLOTS = [
  "privateStateProvider",
  "publicDataProvider",
  "zkConfigProvider",
  "proofProvider",
  "walletProvider",
  "midnightProvider",
] as const;

/**
 * Structural completeness check for an already-built slot object. Used by
 * the browser prepare path when slots arrive from outside the factory.
 */
export function missingProviderSlots(
  slots: Partial<MidnightProviderSlots>,
): (keyof MidnightProviderSlots)[] {
  return REQUIRED_PROVIDER_SLOTS.filter(
    (slot) => slots[slot] === undefined || slots[slot] === null,
  );
}

/**
 * Structural assembly boundary for callers that already hold the six slots
 * (browser Wave B). Fail closed on a wrong network, a missing contract
 * address, or any missing slot. Does not contact the wallet or chain.
 */
export function assembleProvidersFromSlots<M extends NetworkGuardMode>(input: {
  guard: M;
  network: NetworkForGuard<M>;
  contractAddress: string;
  slots: Partial<MidnightProviderSlots>;
}): AssembledProviders {
  assertNetworkGuard(input.network, input.guard);
  assertContractAddress(input.contractAddress);
  const missing = missingProviderSlots(input.slots);
  if (missing.length > 0) {
    throw new Error(
      `Provider assembly is incomplete; missing: ${missing.join(", ")}`,
    );
  }
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
