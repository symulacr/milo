// Preprod lane (v6). The local lane proves the protocol on a disposable network;
// this lane puts the same contract on Midnight Preprod with a funded wallet and
// records explorer-checkable receipts. Fail-closed by construction: nothing here
// touches a network unless the environment explicitly authorizes preprod, the
// proof server is loopback (it sees witness data), and the seed comes from the
// environment (never from source, never logged).
//
// Modes (exactly one):
//   --check                   validate env, build providers, report address and balances
//   --sync                    sync fully, persist the wallet snapshots, report progress
//   --register-dust           register NIGHT UTXOs for DUST generation
//   --deploy                  deploy the compiled contract and record the receipt
//   --sweep                   drive every proof circuit (positive and negative cases)
//   --breaker <circuit>       removeVerifierKey (disable a circuit on-chain)
//   --restore <circuit>       insertVerifierKey (restore a circuit)
//   --freeze <key|empty>      replaceAuthority (hand over or relinquish control)
//   --verify-state            verify the snapshot metadata and restore against the chain,
//                             print the receipt, exit non-zero when the fast path is refused
//   --repair-state            rewrite sdk-versions.json from the installed versions
//                             (explicit operator repair; never automatic during a restore)
//
// Sync cost: a fresh Preprod wallet replays full genesis history (Midnight servicedesk
// #118: the DUST wallet dominates it and a fresh sync can approach three hours). Nothing
// here can avoid the first sync, so the lane does two things about it: it widens the
// documented sync knobs, and it persists each sub-wallet's snapshot under
// <runDir>/wallet-state after every full sync. Later runs restore from those snapshots
// and resume at the recorded applied index instead of replaying genesis.
//
// A restore that merely does not throw is not proof of correctness (midnight-wallet #559:
// a dropped field restored without error and silently lost history; #298: stale pending
// state survived serialization; servicedesk #104: an incompatible snapshot hangs with CPU
// near zero). So before trusting a restore the lane runs the fail-closed gate in
// wallet-state-verify.mjs and, on any FAIL or unexercised check, discards the snapshot and
// takes a full from-seed sync instead.
//
// Env (from .env.preprod, allowlist-ignored):
//   MIDNIGHT_PREPROD_SEED        64 hex characters (required)
//   MILO_PREPROD_ALLOW           must equal "disposable-owned-preprod"
//   MIDNIGHT_PREPROD_PROOF_HTTP  loopback proof server, default http://127.0.0.1:6300
//   MIDNIGHT_PREPROD_RUN_DIR     optional receipt directory
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "./preprod-actions.mjs";
import {
  inspectSdkVersions,
  repairSdkVersions,
  resolveSdkVersions,
  verifyWalletState,
  WALLET_STATE_FILES,
  walletStateDir,
} from "./wallet-state-verify.mjs";

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

// Resolved from this module, not the cwd, so receipts always land in the repository's
// ignored .hoplite tree.
function defaultRunDir() {
  return new URL("../../../.hoplite/artifacts/preprod", import.meta.url)
    .pathname;
}

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
    runDir: env.MIDNIGHT_PREPROD_RUN_DIR ?? defaultRunDir(),
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

// Sync tuning. These are the documented `DefaultSyncConfiguration` knobs (added in
// wallet-sdk-dust-wallet 4.0.0), not private API. Defaults are sized for a wallet at the
// tip: batches of 10 events, a 4 ms delay injected between batches, and a 10k in-flight
// cap. A fresh Preprod wallet instead replays full genesis history, where the injected
// spacing is pure overhead.
const SYNC_TUNING = Object.freeze({
  batchUpdates: Object.freeze({ size: 500, timeout: 2, spacing: 0 }),
  bufferSize: 20_000,
  resumeThreshold: 200,
});

// The snapshot role files, the version matrix and the SDK version resolver all live in
// wallet-state-verify.mjs: the resolver must read each manifest by path because the
// packages are ESM-only and their "exports" maps do not expose "./package.json", so a
// require() of the specifier throws ERR_PACKAGE_PATH_NOT_EXPORTED and an empty matrix
// would silently disable the version gate.

/** Restored snapshots make every run after the first cheap: the wallet resumes at its
 * recorded applied index instead of replaying genesis. Any missing role, an incomplete or
 * drifted version recording, or a failed chain verification means a fresh from-seed sync
 * rather than a partially restored wallet. Every rejection is emitted by name. */
async function loadWalletState(config) {
  const dir = walletStateDir(config.runDir);
  const loaded = {};
  try {
    for (const [role, file] of Object.entries(WALLET_STATE_FILES))
      loaded[role] = await readFile(resolve(dir, file), "utf8");
  } catch {
    // First run, or a partial snapshot: there is no restorable state, so a full sync follows.
    return null;
  }

  const inspection = await inspectSdkVersions(dir);
  // Fail closed on an unresolvable installed matrix: comparing two empty records would
  // otherwise read as "no drift" and let a snapshot be restored under an unknown SDK
  // version, the exact silent-hang failure this gate exists to prevent.
  if (inspection.unresolved.length > 0) {
    await emit(config.runDir, {
      event: "wallet-state-rejected",
      reason: "sdk-versions-unresolvable",
      unresolved: inspection.unresolved,
    });
    return null;
  }
  // An empty or key-incomplete recording is never silently accepted and never auto-repaired:
  // the operator must run --repair-state deliberately.
  if (!inspection.exists || inspection.parseError !== null) {
    await emit(config.runDir, {
      event: "wallet-state-rejected",
      reason: inspection.exists
        ? "sdk-versions-unreadable"
        : "sdk-versions-missing",
      error: inspection.parseError,
      hint: "operator action required: run --repair-state to rewrite sdk-versions.json from the installed versions",
    });
    return null;
  }
  if (inspection.empty || inspection.missingKeys.length > 0) {
    await emit(config.runDir, {
      event: "wallet-state-rejected",
      reason: "sdk-versions-incomplete",
      empty: inspection.empty,
      missingKeys: inspection.missingKeys,
      hint: "operator action required: run --repair-state to rewrite sdk-versions.json from the installed versions; never auto-repaired during a restore",
    });
    return null;
  }
  if (inspection.drifted.length > 0) {
    await emit(config.runDir, {
      event: "wallet-state-rejected",
      reason: "sdk-version-changed",
      drifted: inspection.drifted,
    });
    return null;
  }

  // Versions match, but a restore that merely does not throw proves nothing (#559, #298).
  // Verify the restored state against the chain before the lane trusts it; any FAIL or an
  // unexercised check refuses the snapshot and forces the full from-seed sync below.
  const verdict = await verifyWalletState(dir, {
    receiptPath: resolve(config.runDir, "wallet-state-verification.json"),
  });
  if (!verdict.safeForFastPath) {
    await emit(config.runDir, {
      event: "wallet-state-rejected",
      reason: "restore-verification-failed",
      failed: verdict.failedIds,
      unexercised: verdict.unexercisedIds,
      receipt: verdict.receiptPath,
    });
    return null;
  }
  await emit(config.runDir, {
    event: "wallet-state-verified",
    checks: verdict.checks.length,
    receipt: verdict.receiptPath,
  });
  return loaded;
}

async function saveWalletState(config, wallet) {
  const dir = walletStateDir(config.runDir);
  await mkdir(dir, { recursive: true });
  const bytes = {};
  for (const role of Object.keys(WALLET_STATE_FILES)) {
    const serialized = await wallet[role].serializeState();
    const path = resolve(dir, WALLET_STATE_FILES[role]);
    await writeFile(path, serialized, { mode: 0o600 });
    await chmod(path, 0o600);
    bytes[role] = serialized.length;
  }
  await writeFile(
    resolve(dir, "sdk-versions.json"),
    `${JSON.stringify(await resolveSdkVersions(), null, 2)}\n`,
  );
  return bytes;
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
      bufferSize: SYNC_TUNING.bufferSize,
      resumeThreshold: SYNC_TUNING.resumeThreshold,
    },
    batchUpdates: { ...SYNC_TUNING.batchUpdates },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^https/, "wss")),
  };
  const restored = await loadWalletState(config);
  if (restored)
    await emit(config.runDir, {
      event: "wallet-state-restored",
      roles: Object.keys(restored),
    });
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
      restored
        ? ShieldedWallet(cfg).restore(restored.shielded)
        : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) =>
      restored
        ? UnshieldedWallet(cfg).restore(restored.unshielded)
        : UnshieldedWallet(cfg).startWithPublicKey(
            PublicKey.fromKeyStore(unshieldedKeystore),
          ),
    dust: (cfg) =>
      restored
        ? DustWallet(cfg).restore(restored.dust)
        : DustWallet(cfg).startWithSecretKey(
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
    restored: restored !== null,
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

// Fully synced facade, with progress reported so a long sync is never silent, then the
// snapshots persisted so the runs after this one restore instead of replaying genesis.
// A fresh Preprod sync measured 125 minutes on this SDK cohort (servicedesk #104), so the
// ticker prints the applied index alongside the connected flags: that is the number to
// compare against, and the only one that shows forward motion.
async function awaitSync(config, session) {
  const Rx = await import("rxjs");
  const ticker = setInterval(() => {
    Rx.firstValueFrom(session.wallet.state())
      .then((s) =>
        console.log(
          JSON.stringify({
            event: "sync-progress",
            restored: session.restored,
            synced: s.isSynced === true,
            shieldedConnected: s.shielded.state.progress.isConnected,
            unshieldedConnected: s.unshielded.state.progress.isConnected,
            dustConnected: s.dust.state.progress.isConnected,
            dustApplied: String(s.dust.state.progress.appliedIndex ?? 0n),
            unshieldedApplied: String(
              s.unshielded.state.progress.appliedId ?? 0n,
            ),
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
  const bytes = await saveWalletState(config, session.wallet);
  await emit(config.runDir, {
    event: "wallet-state-saved",
    address: session.address,
    restored: session.restored,
    bytes,
  });
  return state;
}

async function registerDust(config, session) {
  const Rx = await import("rxjs");
  const state = await awaitSync(config, session);
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
  // A registration is rejected with BalanceCheckOverspend when its own fee exceeds the
  // dust the registration generates, which is the whole budget on a wallet with no dust
  // yet. 4.2.0 estimates and throws before submission rather than letting the chain
  // reject, so wait for the projection to cover the estimate first.
  const estimate = await session.wallet.estimateRegistration(unregistered);
  await emit(config.runDir, {
    event: "dust-registration-estimate",
    address: session.address,
    fee: estimate.fee.toString(),
  });
  if (estimate.fee > 0n)
    await session.wallet.waitForGeneratedDust(unregistered, estimate.fee, {
      timeoutMs: 900_000,
    });
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
  const bytes = await saveWalletState(config, session.wallet);
  await emit(config.runDir, {
    event: "dust-observed",
    address: session.address,
    bytes,
  });
}

async function main() {
  const flags = process.argv.slice(2);
  const mode = flags.find((flag) => flag.startsWith("--"));
  assert(mode, "one mode flag is required (see the file header)");

  // Operator-only state modes. They deliberately do not require the seed or the allow
  // flag: they never build a wallet, and --repair-state must be a deliberate operator
  // action, never an automatic step inside a restore.
  if (mode === "--verify-state" || mode === "--repair-state") {
    const runDir = process.env.MIDNIGHT_PREPROD_RUN_DIR ?? defaultRunDir();
    const dir = walletStateDir(runDir);
    try {
      if (mode === "--repair-state") {
        const result = await repairSdkVersions(dir);
        if (!result.repaired) {
          console.log(
            JSON.stringify({
              event: "wallet-state-repair-skipped",
              reason: result.reason,
              dir,
            }),
          );
          return;
        }
        console.log(
          [
            "",
            "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
            "!! WALLET-STATE REPAIR: sdk-versions.json REWRITTEN     !!",
            `!! ${result.path}`,
            "!! rewritten from the versions installed RIGHT NOW.      !!",
            "!! This is a deliberate operator action, not automatic.  !!",
            "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
            "",
          ].join("\n"),
        );
        console.log(
          JSON.stringify(
            {
              event: "wallet-state-repaired",
              dir,
              emptyBefore: result.emptyBefore ?? false,
              missingBefore: result.missingBefore ?? [],
              parseErrorBefore: result.parseErrorBefore ?? null,
              after: result.after,
            },
            null,
            2,
          ),
        );
        return;
      }
      const verdict = await verifyWalletState(dir, {
        receiptPath: resolve(runDir, "wallet-state-verification.json"),
      });
      console.log(JSON.stringify(verdict.receipt, null, 2));
      console.error(
        `wallet-state-verify: ${verdict.receipt.verdict.passed} passed, ${verdict.failedIds.length} failed, ${verdict.unexercisedIds.length} unexercised; safeForFastPath=${verdict.safeForFastPath}; receipt=${verdict.receiptPath}`,
      );
      process.exit(verdict.safeForFastPath ? 0 : 1);
    } catch (error) {
      console.error(
        `wallet-state ${mode} failed: ${String(error?.message ?? error)}`,
      );
      process.exit(1);
    }
  }

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
    if (mode === "--sync") {
      const state = await awaitSync(config, session);
      await emit(config.runDir, {
        event: "sync-complete",
        address: session.address,
        restored: session.restored,
        dustBalance: state.dust.balance(new Date()).toString(),
      });
      return;
    }
    if (mode === "--register-dust") {
      await registerDust(config, session);
      return;
    }
    // Deploy, sweep and the maintenance drills all build transactions, so none of them
    // may start from a partially synced wallet; the same wait persists the snapshot.
    await awaitSync(config, session);
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
    const bytes = await saveWalletState(config, session.wallet);
    await emit(config.runDir, { event: "wallet-state-saved", bytes });
  } finally {
    await session.wallet.stop().catch(() => {});
  }
}

await main();
