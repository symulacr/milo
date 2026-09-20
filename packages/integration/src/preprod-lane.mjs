// Preprod lane (v6). The local lane proves the protocol on a disposable network;
// this lane puts the same contract on Midnight Preprod with a funded wallet and
// records explorer-checkable receipts. Fail-closed by construction: nothing here
// touches a network unless the environment explicitly authorizes preprod, the
// proof server is loopback (it sees witness data), and the seed comes from the
// environment (never from source, never logged).
//
// Modes (exactly one):
//   --check                   validate env, build providers, report address and balances
//   --register-dust           register NIGHT UTXOs for DUST generation
//   --deploy                  deploy the compiled contract and record the receipt
//   --sweep                   drive every proof circuit (positive and negative cases)
//   --breaker <circuit>       removeVerifierKey (disable a circuit on-chain)
//   --restore <circuit>       insertVerifierKey (restore a circuit)
//   --freeze <key|empty>      replaceAuthority (hand over or relinquish control)
//
// Env (from .env.preprod, allowlist-ignored):
//   MIDNIGHT_PREPROD_SEED        64 hex characters (required)
//   MILO_PREPROD_ALLOW           must equal "disposable-owned-preprod"
//   MIDNIGHT_PREPROD_PROOF_HTTP  loopback proof server, default http://127.0.0.1:6300
//   MIDNIGHT_PREPROD_RUN_DIR     optional receipt directory
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "./preprod-actions.mjs";

const PREPROD = Object.freeze({
  networkId: "preprod",
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "https://rpc.preprod.midnight.network",
  explorer: "https://preprod.midnightexplorer.com",
});

const GENERATED = "packages/contract/generated";
const HEX64 = /^[a-f0-9]{64}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function preprodConfig(env) {
  if (env.MILO_PREPROD_ALLOW !== "disposable-owned-preprod")
    throw new Error(
      "Explicit disposable-owned-preprod authorization required (MILO_PREPROD_ALLOW)",
    );
  assert(HEX64.test(env.MIDNIGHT_PREPROD_SEED ?? ""), "64-hex seed required");
  const proofServer = (
    env.MIDNIGHT_PREPROD_PROOF_HTTP ?? "http://127.0.0.1:6300"
  ).replace(/\/$/, "");
  const url = new URL(proofServer);
  assert.equal(url.protocol, "http:");
  assert.ok(
    ["127.0.0.1", "[::1]"].includes(url.hostname),
    "loopback proof server required",
  );
  return {
    seed: env.MIDNIGHT_PREPROD_SEED,
    proofServer,
    // Resolved from this module, not the cwd, so the receipts always land in the
    // repository's ignored .hoplite tree.
    runDir:
      env.MIDNIGHT_PREPROD_RUN_DIR ??
      new URL("../../../.hoplite/artifacts/preprod", import.meta.url).pathname,
    // Derived, never hardcoded: 16+ characters with three character classes.
    privateStatePassword: `Milo1!${hash(env.MIDNIGHT_PREPROD_SEED).slice(0, 20)}`,
    ...PREPROD,
  };
}

async function emit(runDir, event) {
  await mkdir(runDir, { recursive: true });
  await writeFile(
    resolve(runDir, "transactions.jsonl"),
    `${JSON.stringify(event)}\n`,
    {
      flag: "a",
    },
  );
  console.log(JSON.stringify(event));
}

async function buildSession(config) {
  const { WebSocket } = await import("ws");
  globalThis.WebSocket = WebSocket;
  const { setNetworkId } = await import(
    "@midnight-ntwrk/midnight-js-network-id"
  );
  setNetworkId(config.networkId);
  const ledger = await import("@midnight-ntwrk/midnight-js-protocol/ledger");
  const addressFormat = await import(
    "@midnight-ntwrk/wallet-sdk-address-format"
  );
  const {
    HDWallet,
    Roles,
    createKeystore,
    WalletFacade,
    ShieldedWallet,
    UnshieldedWallet,
    DustWallet,
    PublicKey,
    NoOpTransactionHistoryStorage,
  } = await import("@midnight-ntwrk/wallet-sdk");

  const hd = HDWallet.fromSeed(Buffer.from(config.seed, "hex"));
  if (hd.type !== "seedOk") throw new Error("seed rejected");
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== "keysDerived") throw new Error("key derivation failed");
  hd.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(
    derived.keys[Roles.Zswap],
  );
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    derived.keys[Roles.NightExternal],
    config.networkId,
  );
  const base = {
    networkId: config.networkId,
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^https/, "wss")),
  };
  const wallet = await WalletFacade.init({
    configuration: {
      ...base,
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    },
    shielded: (cfg) =>
      ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) =>
      UnshieldedWallet(cfg).startWithPublicKey(
        PublicKey.fromKeyStore(unshieldedKeystore),
      ),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return {
    ledger,
    addressFormat,
    wallet,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    address: String(unshieldedKeystore.getBech32Address()),
  };
}

async function buildProviders(config, session) {
  const { levelPrivateStateProvider } = await import(
    "@midnight-ntwrk/midnight-js-level-private-state-provider"
  );
  const { indexerPublicDataProvider } = await import(
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider"
  );
  const { httpClientProofProvider } = await import(
    "@midnight-ntwrk/midnight-js-http-client-proof-provider"
  );
  const { NodeZkConfigProvider } = await import(
    "@midnight-ntwrk/midnight-js-node-zk-config-provider"
  );
  const { ttlOneHour } = await import("@midnight-ntwrk/midnight-js-utils");

  const zkConfigProvider = new NodeZkConfigProvider(
    resolve(process.cwd(), GENERATED),
  );
  const walletAndMidnightProvider = {
    getCoinPublicKey: () => session.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () =>
      session.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx, ttl = ttlOneHour()) {
      const recipe = await session.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: session.shieldedSecretKeys,
          dustSecretKey: session.dustSecretKey,
        },
        { ttl },
      );
      return session.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx) => session.wallet.submitTransaction(tx),
  };
  return {
    zkConfigProvider,
    providers: {
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: "milo-preprod-private-state",
        signingKeyStoreName: "milo-preprod-signing-keys",
        privateStoragePasswordProvider: () => config.privateStatePassword,
        accountId: session.address,
      }),
      publicDataProvider: indexerPublicDataProvider(
        config.indexer,
        config.indexerWS,
      ),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(
        config.proofServer,
        zkConfigProvider,
      ),
      walletProvider: walletAndMidnightProvider,
      midnightProvider: walletAndMidnightProvider,
    },
  };
}

/** Live balances, bounded: a fresh preprod wallet can sync for a long time. */
async function balances(session, ledger, timeoutMs = 120_000) {
  const Rx = await import("rxjs");
  const night = ledger.unshieldedToken().raw;
  const state = await Rx.firstValueFrom(
    session.wallet.state().pipe(
      Rx.filter(
        (s) =>
          s.shielded.state.progress.isConnected &&
          s.unshielded.state.progress.isConnected &&
          s.dust.state.progress.isConnected,
      ),
      Rx.timeout({ first: timeoutMs }),
    ),
  );
  return {
    connected: true,
    synced: state.isSynced === true,
    night: (state.unshielded.balances[night] ?? 0n).toString(),
    dust: state.dust.balance(new Date()).toString(),
  };
}

async function registerDust(config, session) {
  const Rx = await import("rxjs");
  // Sync is the long pole on a fresh preprod wallet; report progress so a run
  // can never fail invisibly.
  const ticker = setInterval(() => {
    Rx.firstValueFrom(session.wallet.state())
      .then((s) =>
        console.log(
          JSON.stringify({
            event: "sync-progress",
            synced: s.isSynced === true,
            shieldedConnected: s.shielded.state.progress.isConnected,
            unshieldedConnected: s.unshielded.state.progress.isConnected,
            dustConnected: s.dust.state.progress.isConnected,
          }),
        ),
      )
      .catch((error) =>
        console.log(
          JSON.stringify({
            event: "sync-progress-error",
            message: String(error?.message ?? error),
          }),
        ),
      );
  }, 30_000);
  let state;
  try {
    state = await session.wallet.waitForSyncedState();
  } finally {
    clearInterval(ticker);
  }
  const unregistered = state.unshielded.availableCoins.filter(
    (coin) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (unregistered.length === 0) {
    await emit(config.runDir, {
      event: "dust-already-registered",
      address: session.address,
    });
    return;
  }
  const { DustAddress, MidnightBech32m } = session.addressFormat;
  const target = String(
    DustAddress.encodePublicKey(
      config.networkId,
      session.dustSecretKey.publicKey,
    ),
  );
  const dustReceiver = MidnightBech32m.parse(target).decode(
    DustAddress,
    config.networkId,
  );
  const recipe = await session.wallet.registerNightUtxosForDustGeneration(
    unregistered,
    session.unshieldedKeystore.getPublicKey(),
    (payload) => session.unshieldedKeystore.signData(payload),
    dustReceiver,
  );
  const finalized = await session.wallet.finalizeRecipe(recipe);
  const txId = await session.wallet.submitTransaction(finalized);
  await emit(config.runDir, {
    event: "dust-registration-submitted",
    address: session.address,
    txId,
  });
  await Rx.firstValueFrom(
    session.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      Rx.timeout({ first: 600_000 }),
    ),
  );
  await emit(config.runDir, { event: "dust-observed" });
}

async function main() {
  const flags = process.argv.slice(2);
  const mode = flags.find((flag) => flag.startsWith("--"));
  assert(mode, "one mode flag is required (see the file header)");
  const config = preprodConfig(process.env);
  const session = await buildSession(config);
  try {
    if (mode === "--check") {
      await emit(config.runDir, {
        event: "preprod-check",
        network: config.networkId,
        indexer: config.indexer,
        node: config.node,
        proofServer: config.proofServer,
        address: session.address,
        balances: await balances(session, session.ledger),
      });
      return;
    }
    if (mode === "--register-dust") {
      await registerDust(config, session);
      return;
    }
    const { providers, zkConfigProvider } = await buildProviders(
      config,
      session,
    );
    const generated = await import(
      resolve(process.cwd(), `${GENERATED}/contract/index.js`)
    );
    await run({
      mode,
      flags,
      config,
      session,
      providers,
      zkConfigProvider,
      Contract: generated.Contract,
      emit: (event) => emit(config.runDir, event),
    });
  } finally {
    await session.wallet.stop().catch(() => {});
  }
}

await main();
