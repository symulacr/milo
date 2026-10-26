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
 * Classify a wallet/SDK failure as insufficient DUST using the shared
 * taxonomy, falling back to the integration dust.mjs shape walk.
 */
export function isInsufficientDust(error) {
  if (error instanceof InsufficientDustError) return true;
  if (classifyMidnightClientError(error) === "INSUFFICIENT_DUST") return true;
  return isInsufficientDustShape(error);
}
