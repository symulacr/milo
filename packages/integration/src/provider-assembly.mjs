/**
 * Integration-side provider assembly — the Node/testkit face of the one
 * provider-assembly factory in packages/midnight-client/src/provider-factory.ts.
 *
 * Every local driver (local-happy, local-ops, local-circuit-sweep, local.mjs)
 * builds providers through this module so wallet/dust/fund wiring exists once.
 * Driver-specific hooks (resource preflight, submission fences, custom emit
 * shapes) stay at the call site via the factory's `beforeSubmit` / `onEvent`.
 *
 * Network guard: `"undeployed-only"` for the disposable local lane,
 * `"preprod-only"` for Preprod actions. Both fail closed with WrongNetworkError.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  assembleProviderFactory,
  assertLocalDisposableNetwork,
  assertNetworkGuard,
  classifyMidnightClientError,
  InsufficientDustError,
  LOCAL_DISPOSABLE_NETWORK,
  LockedWalletError,
  WrongNetworkError,
} from "../midnight-client/src/provider-factory.ts";
import { isInsufficientDust as isInsufficientDustShape } from "./dust.mjs";
import { intentExpiry } from "./tx.mjs";

export {
  assembleProviderFactory,
  assertLocalDisposableNetwork,
  assertNetworkGuard,
  classifyMidnightClientError,
  InsufficientDustError,
  LOCAL_DISPOSABLE_NETWORK,
  LockedWalletError,
  WrongNetworkError,
};

/** Guard mode for the disposable local lane. */
export const LOCAL_GUARD = "undeployed-only";
/** Guard mode for Preprod. */
export const PREPROD_GUARD = "preprod-only";

/**
 * Shape-testkit MidnighWalletProvider (and friends) satisfy for the factory.
 * Structural so tests can pass doubles without importing testkit here.
 */
export function walletActorFromTestkit(provider) {
  assert(provider, "wallet actor is required");
  assert.equal(typeof provider.getCoinPublicKey, "function");
  assert.equal(typeof provider.getEncryptionPublicKey, "function");
  assert.equal(typeof provider.submitTx, "function");
  assert(provider.wallet, "wallet actor requires .wallet");
  assert.equal(typeof provider.wallet.balanceUnboundTransaction, "function");
  assert.equal(typeof provider.wallet.signRecipe, "function");
  assert.equal(typeof provider.wallet.finalizeRecipe, "function");
  assert(
    provider.unshieldedKeystore,
    "wallet actor requires unshieldedKeystore",
  );
  return provider;
}

/**
 * Wait until the wallet's DUST balance is positive. Shared skip-estimate
 * readiness used by local-happy and local-circuit-sweep (estimateTransactionFee
 * hung on proved call txs — R8).
 */
export function waitForPositiveDust(wallet, { deadlineMs, timeoutMs, rx }) {
  const { firstValueFrom, filter, timeout, timer, map, combineLatest } = rx;
  return firstValueFrom(
    combineLatest([wallet.state(), timer(0, 1000)]).pipe(
      filter(([state]) => state.isSynced),
      map(([state]) => state.dust.balance(new Date())),
      filter((balance) => balance > 0n),
      timeout({
        first: Math.max(
          1_000,
          Math.min(timeoutMs ?? 30_000, deadlineMs - Date.now()),
        ),
      }),
    ),
  );
}

/**
 * Shared walletProvider.balanceTx: wait for positive DUST, then
 * balanceUnbound → signRecipe → finalizeRecipe. No estimateTransactionFee.
 */
export function skipEstimateBalanceTx(
  actor,
  { deadlineMs, timeoutMs, rx, emit },
) {
  return async function balanceTx(tx, ttl = new Date(Date.now() + 3_600_000)) {
    if (emit) emit("balance-start", { note: "skip-estimate" });
    await waitForPositiveDust(actor.wallet, { deadlineMs, timeoutMs, rx });
    if (emit) emit("dust-present");
    const recipe = await actor.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: actor.zswapSecretKeys,
        dustSecretKey: actor.dustSecretKey,
      },
      { ttl },
    );
    if (emit) emit("dust-fee-ready");
    const signed = await actor.wallet.signRecipe(recipe, (payload) =>
      actor.unshieldedKeystore.signData(payload),
    );
    return await actor.wallet.finalizeRecipe(signed);
  };
}

/**
 * Shared funding path: genesis mint wallet → fresh buyer → unshielded
 * transfer → observed finalization → buyer DUST ready. Returns { funder, buyer }.
 *
 * Dedupes the block that was copy-pasted across local-happy.mjs,
 * local-ops.mjs, local-circuit-sweep.mjs and local.mjs. Call sites keep their
 * own emit labels and amount.
 */
export async function fundBuyerFromGenesis({
  tk,
  env,
  L,
  UnshieldedAddress,
  publicDataProvider,
  rx,
  fundingAmount = 50_000n * 1_000_000n,
  emit = () => {},
  requireGenesisBalance = false,
}) {
  assert(tk && env && L && UnshieldedAddress && publicDataProvider && rx);
  const { firstValueFrom, filter, timeout } = rx;
  const waitState = (provider, predicate) =>
    firstValueFrom(
      provider.wallet.state().pipe(
        filter((state) => state.isSynced && predicate(state)),
        timeout({ first: env.timeoutMs }),
      ),
    );

  const genesis = new tk.LocalTestEnvironment(tk.logger);
  const funder = await tk.MidnightWalletProvider.build(
    tk.logger,
    env,
    genesis.genesisMintWalletSeed[0],
  );
  await funder.start(false);
  const night = L.unshieldedToken().raw;
  const genesisState = await tk.syncWallet(funder.wallet);
  if (requireGenesisBalance) {
    assert(
      (genesisState.unshielded.balances[night] ?? 0n) >= fundingAmount,
      "genesis mint cannot cover fundingAmount",
    );
  }
  await tk.waitForFunds(funder.wallet, env, false, funder.unshieldedKeystore);
  await waitState(funder, (state) => state.dust.balance(new Date()) > 0n);

  const buyer = await tk.MidnightWalletProvider.build(
    tk.logger,
    env,
    randomBytes(32).toString("hex"),
  );
  await buyer.start(false);
  await tk.syncWallet(buyer.wallet);
  const recipe = await funder.wallet.transferTransaction(
    [
      {
        type: "unshielded",
        outputs: [
          {
            type: night,
            amount: fundingAmount,
            receiverAddress: buyer.unshieldedKeystore
              .getBech32Address()
              .decode(UnshieldedAddress, env.networkId),
          },
        ],
      },
    ],
    {
      shieldedSecretKeys: funder.zswapSecretKeys,
      dustSecretKey: funder.dustSecretKey,
    },
    { ttl: intentExpiry() },
  );
  const signed = await funder.wallet.signRecipe(recipe, (payload) =>
    funder.unshieldedKeystore.signData(payload),
  );
  const fundingId = await funder.submitTx(
    await funder.wallet.finalizeRecipe(signed),
  );
  emit("submitted", { txId: fundingId });
  const finalized = await publicDataProvider.watchForTxData(fundingId);
  emit("funding-finalized", finalized);
  await waitState(
    buyer,
    (state) => (state.unshielded.balances[night] ?? 0n) > 0n,
  );
  await tk.waitForFunds(buyer.wallet, env, false, buyer.unshieldedKeystore);
  await waitState(buyer, (state) => state.dust.balance(new Date()) > 0n);
  return { funder, buyer, fundingId, night };
}

/**
 * Build the six-slot provider tuple through the one factory.
 *
 * `balanceStrategy`:
 *   - "skip-estimate"  (default) — positive-DUST wait, no estimateTransactionFee
 *   - "dust-readiness" — packages/integration/src/dust.mjs balanceWithDustReadiness
 *   - "injected"       — caller supplies balanceTx
 */
export function buildLocalProviders({
  guard = LOCAL_GUARD,
  network,
  contractAddress,
  privateStateProvider,
  publicDataProvider,
  zkConfigProvider,
  proof,
  actor,
  balanceStrategy = "skip-estimate",
  waitForBalancedRecipe,
  onEvent,
  beforeSubmit,
  ttlMs,
  deadlineMs,
  timeoutMs,
  rx,
}) {
  const effectiveGuard = guard;
  const effectiveNetwork =
    network ??
    (effectiveGuard === LOCAL_GUARD ? LOCAL_DISPOSABLE_NETWORK : "preprod");
  assertNetworkGuard(effectiveNetwork, effectiveGuard);

  let balanceTx;
  if (balanceStrategy === "skip-estimate") {
    assert(rx, 'balanceStrategy "skip-estimate" requires rx');
    balanceTx = skipEstimateBalanceTx(actor, {
      deadlineMs: deadlineMs ?? Date.now() + (timeoutMs ?? 900_000),
      timeoutMs,
      rx,
      emit: onEvent,
    });
  }

  return assembleProviderFactory({
    guard: effectiveGuard,
    network: effectiveNetwork,
    contractAddress,
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proof,
    actor: walletActorFromTestkit(actor),
    balanceStrategy:
      balanceStrategy === "skip-estimate" ? "injected" : balanceStrategy,
    balanceTx,
    waitForBalancedRecipe,
    onEvent,
    ttlMs,
    deadlineMs,
    beforeSubmit,
  });
}

/**
 * Classify a wallet/SDK failure as insufficient DUST using the shared
 * taxonomy, falling back to the integration dust.mjs shape walk.
 */
export function isInsufficientDust(error) {
  if (error instanceof InsufficientDustError) return true;
  if (classifyMidnightClientError(error) === "INSUFFICIENT_DUST") return true;
  return isInsufficientDustShape(error);
}
