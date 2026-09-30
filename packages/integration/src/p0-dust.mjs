/**
 * Phase 0.3 — DUST registration state + self-respend + poll.
 * Never prints the seed.
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

for (const line of readFileSync(new URL("../../../.env.preprod", import.meta.url), "utf8").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#") || !s.includes("=")) continue;
  const i = s.indexOf("=");
  const k = s.slice(0, i).trim();
  let v = s.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (/^[A-Z0-9_]+$/.test(k)) process.env[k] = v;
}
process.env.MILO_PREPROD_ALLOW = process.env.MILO_PREPROD_ALLOW || "disposable-owned-preprod";

const tk = await import("@midnight-ntwrk/testkit-js");
tk.logger.level = "silent";
const L = await import("@midnight-ntwrk/midnight-js-protocol/ledger");
const { UnshieldedAddress, DustAddress, MidnightBech32m } = await import("@midnight-ntwrk/wallet-sdk");

const env = {
  walletNetworkId: "preprod",
  networkId: "preprod",
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "https://rpc.preprod.midnight.network/",
  nodeWS: "wss://rpc.preprod.midnight.network/",
  faucet: undefined,
  proofServer: "http://127.0.0.1:6300/",
  timeoutMs: 1_800_000,
};

const seed = process.env.MIDNIGHT_PREPROD_SEED;
if (!seed) {
  console.error("missing MIDNIGHT_PREPROD_SEED");
  process.exit(2);
}

const wallet = await tk.MidnightWalletProvider.build(tk.logger, env, seed);
await wallet.start(false);
await tk.syncWallet(wallet.wallet);

const night = L.unshieldedToken().raw;
const state = await new Promise((resolve) => {
  const sub = wallet.wallet.state().subscribe((s) => {
    if (s.isSynced) {
      sub.unsubscribe();
      resolve(s);
    }
  });
});

const coins = state.unshielded.availableCoins;
const unreg = coins.filter((c) => c.meta?.registeredForDustGeneration !== true);
const dust = state.dust.balance(new Date());
const nightBal = state.unshielded.balances[night] ?? 0n;
console.log(JSON.stringify({
  coins: coins.length,
  unregistered: unreg.length,
  registered: coins.length - unreg.length,
  night: String(nightBal),
  dust: String(dust),
}));

// Self-spend 1 NIGHT to mint a fresh unregistered UTXO if dust is 0
if (dust === 0n && nightBal > 2_000_000n) {
  console.log("self-spend 1 NIGHT to create generating UTXO");
  const amount = 1_000_000n;
  const recipe = await wallet.wallet.transferTransaction(
    [{
      type: "unshielded",
      outputs: [{
        type: night,
        amount,
        receiverAddress: wallet.unshieldedKeystore.getBech32Address().decode(UnshieldedAddress, "preprod"),
      }],
    }],
    { shieldedSecretKeys: wallet.zswapSecretKeys, dustSecretKey: wallet.dustSecretKey },
    { ttl: new Date(Date.now() + 3_600_000) },
  );
  const signed = await wallet.wallet.signRecipe(recipe, (p) => wallet.unshieldedKeystore.signData(p));
  const finalized = await wallet.wallet.finalizeRecipe(signed);
  const txId = await wallet.submitTx(finalized);
  console.log("split-submitted", txId);
  await sleep(20000);
}

// re-read and register unregistered coins
const state2 = await new Promise((resolve) => {
  const sub = wallet.wallet.state().subscribe((s) => {
    if (s.isSynced) {
      sub.unsubscribe();
      resolve(s);
    }
  });
});
const unreg2 = state2.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration !== true);
console.log("after-split unregistered", unreg2.length, "dust", String(state2.dust.balance(new Date())));

if (unreg2.length > 0) {
  const target = String(DustAddress.encodePublicKey("preprod", wallet.dustSecretKey.publicKey));
  const dustReceiver = MidnightBech32m.parse(target).decode(DustAddress, "preprod");
  const recipe = await wallet.wallet.registerNightUtxosForDustGeneration(
    unreg2,
    wallet.unshieldedKeystore.getPublicKey(),
    (p) => wallet.unshieldedKeystore.signData(p),
    dustReceiver,
  );
  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  const txId = await wallet.submitTx(finalized);
  console.log("register-submitted", txId);
}

// poll dust with backoff up to 3 minutes
for (let i = 0; i < 6; i++) {
  await sleep(30000);
  const st = await new Promise((resolve) => {
    const sub = wallet.wallet.state().subscribe((s) => {
      if (s.isSynced) {
        sub.unsubscribe();
        resolve(s);
      }
    });
  });
  const d = st.dust.balance(new Date());
  console.log(`poll${i} dust=${d}`);
  if (d > 0n) {
    console.log("DUST_READY", String(d));
    break;
  }
}
await wallet.stop();
process.exit(0);
