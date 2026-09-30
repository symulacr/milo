/**
 * D2c: split a NIGHT UTXO on Preprod so a fresh unregistered coin exists,
 * then register it for DUST generation. Never logs secrets.
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

for (const line of readFileSync(
  new URL("../../../.env.preprod", import.meta.url),
  "utf8",
).split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#") || !s.includes("=")) continue;
  const i = s.indexOf("=");
  const k = s.slice(0, i).trim();
  let v = s.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  if (/^[A-Z0-9_]+$/.test(k)) process.env[k] = v;
}
process.env.MILO_PREPROD_ALLOW =
  process.env.MILO_PREPROD_ALLOW || "disposable-owned-preprod";

const { getNetworkId, setNetworkId } = await import(
  "@midnight-ntwrk/midnight-js-network-id"
);
setNetworkId("preprod");

// Build session the same way preprod-lane --check does
const laneSrc = readFileSync(
  new URL("./preprod-lane.mjs", import.meta.url),
  "utf8",
);
if (!laneSrc.includes("registerDust")) {
  console.error("lane missing registerDust");
  process.exit(1);
}

// Import internal helpers via dynamic evaluation of the lane's session factory is too
// heavy; use wallet-sdk facade through testkit like local-happy funding.
const tk = await import("@midnight-ntwrk/testkit-js");
tk.logger.level = "silent";

const env = {
  walletNetworkId: "preprod",
  networkId: "preprod",
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "https://rpc.preprod.midnight.network/",
  nodeWS: "wss://rpc.preprod.midnight.network/",
  faucet: undefined,
  proofServer: "http://127.0.0.1:6300/",
  genesisHash: undefined,
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

const night = (
  await import("@midnight-ntwrk/midnight-js-protocol/ledger")
).unshieldedToken().raw;
const amount = 2_000_000n; // 2 NIGHT in specks (1 NIGHT = 1e6)
const recipe = await wallet.wallet.transferTransaction(
  [
    {
      type: "unshielded",
      outputs: [
        {
          type: night,
          amount,
          receiverAddress: wallet.unshieldedKeystore
            .getBech32Address()
            .decode(
              (await import("@midnight-ntwrk/wallet-sdk")).UnshieldedAddress,
              "preprod",
            ),
        },
      ],
    },
  ],
  {
    shieldedSecretKeys: wallet.zswapSecretKeys,
    dustSecretKey: wallet.dustSecretKey,
  },
  { ttl: new Date(Date.now() + 3_600_000) },
);
const signed = await wallet.wallet.signRecipe(recipe, (payload) =>
  wallet.unshieldedKeystore.signData(payload),
);
const finalized = await wallet.wallet.finalizeRecipe(signed);
const txId = await wallet.submitTx(finalized);
console.log("split-submitted", txId);
const rec = await wallet.wallet.state().pipe();
// wait a bit for indexer
await sleep(15000);
const state = await new Promise((resolve) => {
  const sub = wallet.wallet.state().subscribe((s) => {
    if (s.isSynced) {
      sub.unsubscribe();
      resolve(s);
    }
  });
});
const unreg = state.unshielded.availableCoins.filter(
  (c) => c.meta?.registeredForDustGeneration !== true,
);
console.log(
  "unregistered_coins",
  unreg.length,
  "dust",
  String(state.dust.balance(new Date())),
  "night",
  String(state.unshielded.balances[night] ?? 0n),
);
await wallet.stop();
process.exit(0);
