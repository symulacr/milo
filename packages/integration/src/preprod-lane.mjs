// Preprod lane (v6). The local lane proves the protocol on a disposable network;
// this lane puts the same contract on Midnight Preprod with a funded wallet and
// records explorer-checkable receipts. Fail-closed by construction: nothing here
// touches a network unless the environment explicitly authorizes preprod, the
// proof server is loopback (it sees witness data), and the seed comes from the
// environment (never from source, never logged).
//
// Modes (exactly one):
//   --check                   validate env, build providers, report address and balances
//   --sync                    sync fully, append durable progress receipts, persist the wallet
//                             snapshots, report progress
//   --seed-dust               opt-in fast start: seed the two DUST Merkle trees from the
//                             chain's collapsed updates, write <runDir>/wallet-state/dust.json
//                             atomically, then continue into the ordinary flow so the dust
//                             wallet restores from that snapshot and replays only the tail.
//                             On any seeder, root-verification or restore failure it emits
//                             dust-seed-failed and falls back to the ordinary full sync
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
// #118: the DUST wallet dominates it and a fresh sync can approach three hours). The lane
// attacks this from two sides. It widens the documented sync knobs and persists each
// sub-wallet's snapshot under <runDir>/wallet-state after every full sync, so later runs
// restore from those snapshots and resume at the recorded applied index instead of
// replaying genesis. Separately, the opt-in --seed-dust mode seeds the dust trees directly
// from the chain's collapsed updates before any wallet is built, so even a first run can
// skip the event-by-event dust tree replay and sync only the tail. A seed is accepted only
// after the reconstructed roots equal the roots the chain publishes; any failure falls
// back to the ordinary full sync.
//
// Durability of a long run. A full sync can outlive a terminal and the host: the record of
// how far it got must not live only in stdout or /tmp, which a reboot destroys. So while a
// sync waits, the lane appends a progress receipt to <runDir>/transactions.jsonl on a
// bounded interval (default once a minute, tunable below), carrying the applied index of
// all three roles, the connected flags, the elapsed time and whether the run restored or
// seeded. Separately, a run writes <runDir>/sync-inflight.json at start and removes it on a
// clean exit, so a later run reports previous-run-interrupted together with the last durable
// receipt. This is visibility, never recovery: the ledger exposes no partial-sync
// checkpoint, so a killed sync is not resumed and its state cannot be reconstructed from
// these files. A later run restores from a snapshot a prior run finished and verified, or
// replays from its cursor exactly as if the killed run had never started.
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
//   MIDNIGHT_PREPROD_PROGRESS_INTERVAL_MS  durable sync-progress-receipt interval in ms,
//                                default 60000, bounded 10000..3600000
//   MIDNIGHT_PREPROD_INDEXER_HTTP / MIDNIGHT_PREPROD_INDEXER_WS / MIDNIGHT_PREPROD_NODE
//                                indexer and node endpoints, default the public Preprod
//                                endpoints. Overridable only so an offline dry run can
//                                point at local stubs without touching the chain.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  DustSeedError,
  DustSeedTimeoutError,
  decodeDustSnapshot,
  encodeMerkleRoot,
  seedDustState,
} from "./dust-seed.mjs";
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
    ...PREPROD,
    seed: env.MIDNIGHT_PREPROD_SEED,
    proofServer,
    runDir: env.MIDNIGHT_PREPROD_RUN_DIR ?? defaultRunDir(),
    // Durable progress cadence; bounded so a bad value cannot flood the trail or disable it.
    progressIntervalMs: progressIntervalMs(env),
    // Derived, never hardcoded: 16+ characters with three character classes.
    privateStatePassword: `Milo1!${hash(env.MIDNIGHT_PREPROD_SEED).slice(0, 20)}`,
    // Default to the public Preprod endpoints. The override exists only for offline dry
    // runs (local stubs) so the mode can be exercised without touching the chain.
    indexer: env.MIDNIGHT_PREPROD_INDEXER_HTTP ?? PREPROD.indexer,
    indexerWS: env.MIDNIGHT_PREPROD_INDEXER_WS ?? PREPROD.indexerWS,
    node: env.MIDNIGHT_PREPROD_NODE ?? PREPROD.node,
  };
}

/** Append one event to the run trail. Console first, file second: a progress line must be
 * visible even when the run directory is unusable. */
async function appendEvent(runDir, event) {
  await mkdir(runDir, { recursive: true });
  await writeFile(
    resolve(runDir, "transactions.jsonl"),
    `${JSON.stringify(event)}\n`,
    { flag: "a" },
  );
}

async function emit(runDir, event) {
  console.log(JSON.stringify(event));
  await appendEvent(runDir, event);
}

/** Emit an event that must be reported even when the run directory cannot be written (a
 * failure that is itself the reason to fail closed). Never throws. */
async function emitBestEffort(runDir, event) {
  console.log(JSON.stringify(event));
  try {
    await appendEvent(runDir, event);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "emit-failed",
        message: String(error?.message ?? error),
      }),
    );
  }
}

/** Read the most recent durable progress receipt from the run trail, so an interrupted
 * run can be reported as far as it got. Returns null when there is no trail or no receipt
 * yet. Bounded to the trail's own size; it is an operator receipt file, not a ledger. */
async function lastProgressReceipt(runDir) {
  let text;
  try {
    text = await readFile(resolve(runDir, "transactions.jsonl"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.event === "sync-progress-receipt") return parsed;
  }
  return null;
}

async function writeRunMarker(config, marker) {
  await mkdir(config.runDir, { recursive: true });
  await writeFile(
    resolve(config.runDir, RUN_MARKER_FILE),
    `${JSON.stringify(marker)}\n`,
  );
}

/** Mark a run in flight and surface a predecessor that died before it could clear the
 * marker. Visibility only, never recovery: the ledger has no partial-sync checkpoint, so
 * this reports that a run did not finish and how far its last durable receipt got, not a
 * resumable position. A new run still restores from a completed snapshot or replays from
 * its cursor. Never throws, so an unwritable run directory cannot abort the run. */
async function beginRunMarker(config, mode) {
  const markerPath = resolve(config.runDir, RUN_MARKER_FILE);
  try {
    const previous = JSON.parse(await readFile(markerPath, "utf8"));
    const last = await lastProgressReceipt(config.runDir);
    await emitBestEffort(config.runDir, {
      event: "previous-run-interrupted",
      detail:
        "a previous run left its in-flight marker behind, so it did not exit cleanly; " +
        "the ledger has no partial-sync checkpoint, so a killed sync is not resumed and " +
        "restarts from its cursor",
      previous,
      lastProgress: last
        ? {
            at: last.at ?? null,
            elapsedMs: last.elapsedMs ?? null,
            shieldedApplied: last.shieldedApplied ?? null,
            unshieldedApplied: last.unshieldedApplied ?? null,
            dustApplied: last.dustApplied ?? null,
            synced: last.synced ?? null,
          }
        : null,
    });
  } catch (error) {
    if (error?.code !== "ENOENT")
      await emitBestEffort(config.runDir, {
        event: "previous-run-marker-unreadable",
        message: String(error?.message ?? error).slice(0, 500),
      });
  }
  try {
    await writeRunMarker(config, {
      event: "sync-inflight",
      mode,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "run-marker-write-failed",
        message: String(error?.message ?? error),
      }),
    );
  }
}

/** Add detail learned only after the wallet is built (restored/seeded/address) to the
 * in-flight marker. Best effort: a failure here must not abort a healthy run. */
async function annotateRunMarker(config, fields) {
  try {
    const markerPath = resolve(config.runDir, RUN_MARKER_FILE);
    const current = JSON.parse(await readFile(markerPath, "utf8"));
    await writeRunMarker(config, { ...current, ...fields });
  } catch {
    // The marker is an indication, not a prerequisite: dropping the annotation is harmless.
  }
}

async function clearRunMarker(config) {
  await rm(resolve(config.runDir, RUN_MARKER_FILE), { force: true });
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

// Durable progress. A full sync runs for hours, so a progress line that exists only in the
// stdout stream dies with the process (and a reboot destroys /tmp too). The same numbers are
// therefore appended to <runDir>/transactions.jsonl on an interval: one line per interval.
// The 60s default keeps the durable record within a minute of the truth while adding roughly
// 180 lines to the documented ~3h genesis sync, which neither floods the shared trail nor
// competes with the 30s stdout ticker that exists for a live operator. It is tunable because
// a shorter sync may want a tighter bound and a very long one may want fewer lines; the
// clamp means a typo cannot flood the file (too small) or silence the record entirely.
const PROGRESS_INTERVAL_DEFAULT_MS = 60_000;
const PROGRESS_INTERVAL_MIN_MS = 10_000;
const PROGRESS_INTERVAL_MAX_MS = 3_600_000;
function progressIntervalMs(env) {
  const raw = Number(env.MIDNIGHT_PREPROD_PROGRESS_INTERVAL_MS);
  if (!Number.isFinite(raw)) return PROGRESS_INTERVAL_DEFAULT_MS;
  return Math.min(
    PROGRESS_INTERVAL_MAX_MS,
    Math.max(PROGRESS_INTERVAL_MIN_MS, Math.trunc(raw)),
  );
}

// Written at the start of a run and removed only on a clean exit, so its presence in the run
// directory means a predecessor did not finish. Visibility only: it is not a checkpoint and
// nothing reads it to resume a sync (see the durability note in the file header).
const RUN_MARKER_FILE = "sync-inflight.json";

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

// --------------------------------------------------------------------------------------
// DUST start-late seeding (--seed-dust)
// --------------------------------------------------------------------------------------
// The seeder (dust-seed.mjs) is read-only: it fetches the chain's collapsed dust updates,
// reconstructs both dust trees, verifies the reconstructed roots equal the roots the chain
// publishes, and only then emits a snapshot. This wrapper owns the run-directory side. It
// writes the snapshot atomically (temp + rename) so a later run can never restore a
// half-written file, independently re-decodes the emitted snapshot and matches it against
// the receipt, and on any failure emits dust-seed-failed and reports the fallback. The
// snapshot carries no secret material, and this wrapper never logs or returns key bytes.

function seedFailureReason(error) {
  if (error instanceof DustSeedTimeoutError) return "seed-timeout";
  if (error instanceof DustSeedError) return "seed-refused";
  return "seed-error";
}

/** Forward the seeder's progress events to the console immediately and append them to the
 * run trail in order. The seeder calls this synchronously; the appends run on a serialized
 * queue so they never interleave, and a write failure is reported without aborting a seed
 * that is still making progress. */
function makeSeedSink(config) {
  let queue = Promise.resolve();
  const sink = (event, fields = {}) => {
    const record = { event, ...fields };
    console.log(JSON.stringify(record));
    queue = queue
      .then(() => appendEvent(config.runDir, record))
      .catch((error) =>
        console.error(
          JSON.stringify({
            event: "dust-seed-emit-failed",
            message: String(error?.message ?? error),
          }),
        ),
      );
    return queue;
  };
  sink.flush = () => queue;
  return sink;
}

/** Seed dust, verify the emitted snapshot, and write it to <runDir>/wallet-state/dust.json.
 * Returns { ok: true, snapshot, receipt } on success and
 * { ok: false, reason, name, message, error } on any failure, having emitted
 * dust-seed-failed and left no temp file behind. It never throws, so the caller can always
 * fall back to the ordinary full-sync path. */
async function seedDustForRun(config, keys) {
  const dir = walletStateDir(config.runDir);
  const target = resolve(dir, WALLET_STATE_FILES.dust);
  const temp = `${target}.seed-${process.pid}.tmp`;
  const sink = makeSeedSink(config);
  let wroteTemp = false;
  try {
    const result = await seedDustState({
      secretKey: keys.dustSecretKey,
      networkId: config.networkId,
      indexerHttp: config.indexer,
      indexerWs: config.indexerWS,
      emit: sink,
    });
    await sink.flush();

    // Independent of the seeder's own round-trip: re-decode the emitted snapshot through
    // the installed SDK and match it against the receipt the seeder returned.
    const roundTrip = await decodeDustSnapshot(result.snapshot);
    if (!roundTrip?.state)
      throw new DustSeedError(
        "emitted snapshot did not restore a DustLocalState",
      );
    if (roundTrip.publicKey?.publicKey !== keys.dustSecretKey.publicKey)
      throw new DustSeedError(
        "emitted snapshot restored the wrong dust public key",
      );
    if (
      BigInt(roundTrip.progress?.appliedIndex ?? -1n) !==
      BigInt(result.receipt.lastAppliedEventId)
    )
      throw new DustSeedError(
        "emitted snapshot restored the wrong applied index",
      );
    // Compare against the POST-tail roots. The snapshot is encoded after the tail replay,
    // which may have inserted leaves, so the pre-tail localCommitmentRoot describes a
    // different tree state and matching against it refuses valid snapshots.
    if (
      encodeMerkleRoot(roundTrip.state.commitmentTreeRoot()) !==
      result.receipt.finalCommitmentRoot
    )
      throw new DustSeedError(
        "emitted snapshot restored a different commitment root",
      );
    if (
      encodeMerkleRoot(roundTrip.state.generatingTreeRoot()) !==
      result.receipt.finalGenerationRoot
    )
      throw new DustSeedError(
        "emitted snapshot restored a different generation root",
      );

    await mkdir(dir, { recursive: true });
    await writeFile(temp, result.snapshot, { mode: 0o600 });
    wroteTemp = true;
    await chmod(temp, 0o600);
    await rename(temp, target);
    wroteTemp = false;

    const receipt = result.receipt;
    await emit(config.runDir, {
      event: "dust-seeded",
      network: config.networkId,
      snapshotPath: target,
      matchedHeight: receipt.matchedHeight,
      blockHeight: receipt.blockHeight,
      lag: receipt.lag,
      commitmentLag: receipt.commitmentLag,
      generationLag: receipt.generationLag,
      chainCommitmentRoot: receipt.chainCommitmentRoot,
      localCommitmentRoot: receipt.localCommitmentRoot,
      chainGenerationRoot: receipt.chainGenerationRoot,
      localGenerationRoot: receipt.localGenerationRoot,
      commitmentPayloadBytes: receipt.commitmentPayloadBytes,
      generationPayloadBytes: receipt.generationPayloadBytes,
      cutoffEventId: receipt.cutoffEventId,
      cutoffHeight: receipt.cutoffHeight,
      tailStartEventId: receipt.tailStartEventId,
      lastAppliedEventId: receipt.lastAppliedEventId,
      highestPublishedEventId: receipt.highestPublishedEventId,
      tailEventsApplied: receipt.tailEventsApplied,
      tailSkippedReason: receipt.tailSkippedReason,
      snapshotBytes: receipt.snapshotBytes,
      pinAttempts: receipt.pinAttempts,
      scannedBlocks: receipt.scannedBlocks,
      elapsedMs: receipt.elapsedMs,
    });
    return { ok: true, snapshot: result.snapshot, receipt };
  } catch (error) {
    await sink.flush();
    if (wroteTemp) await rm(temp, { force: true });
    const reason = seedFailureReason(error);
    const message = String(error?.message ?? error).slice(0, 500);
    const name = error?.name ?? "Error";
    await emitBestEffort(config.runDir, {
      event: "dust-seed-failed",
      reason,
      name,
      message,
      fallback: "ordinary-full-sync",
    });
    // The reason detail travels back to the caller so it can also be recorded on the
    // fallback receipt: a later reader must see that the fast path was attempted and
    // refused, with why, rather than inferring it was never tried.
    return { ok: false, reason, name, message, error };
  }
}

/** Load and configure the wallet SDK once. The network id is process-global, so this runs
 * before anything constructs a wallet or reads a dust root. */
async function loadWalletSdk(config) {
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
  const sdk = await import("@midnight-ntwrk/wallet-sdk");
  return { ledger, addressFormat, sdk };
}

/** The one key-derivation path, shared by the DUST seeder and the wallet session, so the
 * dust secret key the seeder plants into the snapshot is exactly the key the session
 * restores with. This returns in-memory key material only; nothing here is serialized. */
async function deriveWalletKeys(config, modules) {
  const { ledger, addressFormat, sdk } = modules;
  const { HDWallet, Roles, createKeystore } = sdk;
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
  return {
    ledger,
    addressFormat,
    sdk,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    address: String(unshieldedKeystore.getBech32Address()),
  };
}

async function buildSession(config, options = {}) {
  const keys =
    options.keys ??
    (await deriveWalletKeys(
      config,
      options.modules ?? (await loadWalletSdk(config)),
    ));
  const {
    ledger,
    addressFormat,
    sdk,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    address,
  } = keys;
  const {
    WalletFacade,
    ShieldedWallet,
    UnshieldedWallet,
    DustWallet,
    PublicKey,
    NoOpTransactionHistoryStorage,
  } = sdk;
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
  // A complete, gate-verified snapshot wins outright. Otherwise a seeded dust snapshot
  // (from --seed-dust) restores just the dust role while shielded and unshielded start
  // fresh; the seeder proved that snapshot's roots equal the chain's before it was written.
  const restored = await loadWalletState(config);
  const dustSnapshot = options.dustSnapshot ?? null;
  const dustSeeded = restored === null && dustSnapshot !== null;
  // "seeded", "refused" (fast path attempted and fell back) or "not-attempted". Kept on the
  // session so every progress receipt states whether the fast path failed, not just that the
  // dust role was not restored from a seed.
  const dustSeedOutcome =
    options.dustSeedOutcome ?? (dustSeeded ? "seeded" : "not-attempted");
  if (restored)
    await emit(config.runDir, {
      event: "wallet-state-restored",
      roles: Object.keys(restored),
    });
  else if (dustSeeded)
    await emit(config.runDir, {
      event: "dust-seed-restore",
      detail:
        "dust restored from the seeded snapshot; shielded and unshielded start fresh",
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
        : dustSnapshot
          ? DustWallet(cfg).restore(dustSnapshot)
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
    dustSeeded,
    dustSeedOutcome,
    address,
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
// compare against, and the only one that shows forward motion. The same numbers are also
// appended to the durable run trail (one line per interval) so a reboot that kills an
// unattended sync leaves a record of how far it got, not just a stale stdout buffer.
function syncProgressFields(s, session, startedAt) {
  return {
    restored: session.restored,
    dustSeeded: session.dustSeeded,
    dustSeedOutcome: session.dustSeedOutcome,
    synced: s.isSynced === true,
    shieldedConnected: s.shielded.state.progress.isConnected,
    unshieldedConnected: s.unshielded.state.progress.isConnected,
    dustConnected: s.dust.state.progress.isConnected,
    shieldedApplied: String(s.shielded.state.progress.appliedIndex ?? 0n),
    unshieldedApplied: String(s.unshielded.state.progress.appliedId ?? 0n),
    dustApplied: String(s.dust.state.progress.appliedIndex ?? 0n),
    elapsedMs: Date.now() - startedAt,
  };
}

async function awaitSync(config, session) {
  const Rx = await import("rxjs");
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    Rx.firstValueFrom(session.wallet.state())
      .then((s) =>
        console.log(
          JSON.stringify({
            event: "sync-progress",
            ...syncProgressFields(s, session, startedAt),
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
  // The durable receipt is written file-first, on a serialized queue so receipts never
  // interleave with the events other paths append, and never to /tmp. A receipt write
  // failure is reported but must not abort a sync that is still making progress.
  let receiptQueue = Promise.resolve();
  const writeReceipt = () => {
    Rx.firstValueFrom(session.wallet.state())
      .then((s) => {
        const receipt = {
          event: "sync-progress-receipt",
          at: new Date().toISOString(),
          ...syncProgressFields(s, session, startedAt),
        };
        receiptQueue = receiptQueue
          .then(() => appendEvent(config.runDir, receipt))
          .catch((error) =>
            console.error(
              JSON.stringify({
                event: "sync-progress-receipt-failed",
                message: String(error?.message ?? error),
              }),
            ),
          );
      })
      .catch((error) =>
        console.error(
          JSON.stringify({
            event: "sync-progress-receipt-error",
            message: String(error?.message ?? error),
          }),
        ),
      );
  };
  // Write one receipt immediately as well as on the interval, so even a sync killed in its
  // first interval leaves the durable record of where it restarted from.
  writeReceipt();
  const receiptTimer = setInterval(writeReceipt, config.progressIntervalMs);
  let state;
  try {
    state = await session.wallet.waitForSyncedState();
  } finally {
    clearInterval(ticker);
    clearInterval(receiptTimer);
    await receiptQueue;
  }
  const bytes = await saveWalletState(config, session.wallet);
  await emit(config.runDir, {
    event: "wallet-state-saved",
    address: session.address,
    restored: session.restored,
    dustSeeded: session.dustSeeded,
    dustSeedOutcome: session.dustSeedOutcome,
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
  // Mark the run in flight before anything long runs, and report a predecessor whose marker
  // was left behind. The marker is cleared only on a clean exit below; it is an indication,
  // not a checkpoint (see the durability note in the file header).
  await beginRunMarker(config, mode);
  // --seed-dust must seed before the wallet exists: restoring the dust role needs the
  // snapshot on disk. The key derivation runs once here and is handed to buildSession so
  // the seeder and the session share exactly one derivation path. Any failure emits
  // dust-seed-failed (inside seedDustForRun) and falls through to the ordinary full sync.
  let prepared;
  let dustSnapshot = null;
  let dustSeedOutcome = "not-attempted";
  if (mode === "--seed-dust") {
    await emitBestEffort(config.runDir, {
      event: "dust-seed-mode",
      network: config.networkId,
      indexer: config.indexer,
    });
    try {
      const modules = await loadWalletSdk(config);
      const keys = await deriveWalletKeys(config, modules);
      prepared = { modules, keys };
      const seeded = await seedDustForRun(config, keys);
      if (seeded.ok) {
        dustSnapshot = seeded.snapshot;
        dustSeedOutcome = "seeded";
      } else {
        dustSeedOutcome = "refused";
        // Carry the refusal reason onto the fallback receipt so the durable trail shows the
        // fast path was attempted and why it failed, not merely that no seed was used.
        await emitBestEffort(config.runDir, {
          event: "dust-seed-fallback",
          mode,
          reason: seeded.reason,
          name: seeded.name,
          message: seeded.message,
          fallback: "ordinary-full-sync",
          fastPath: "refused",
        });
      }
    } catch (error) {
      dustSeedOutcome = "refused";
      await emitBestEffort(config.runDir, {
        event: "dust-seed-failed",
        reason: seedFailureReason(error),
        name: error?.name ?? "Error",
        message: String(error?.message ?? error).slice(0, 500),
        fallback: "ordinary-full-sync",
      });
    }
  }
  const session = await buildSession(config, {
    ...(prepared ?? {}),
    dustSnapshot,
    dustSeedOutcome,
  });
  await annotateRunMarker(config, {
    restored: session.restored,
    dustSeeded: session.dustSeeded,
    dustSeedOutcome: session.dustSeedOutcome,
    address: session.address,
  });
  let completed = false;
  // The mode bodies return early, so the run is wrapped in a function and `completed` is set
  // only once that function returns normally: any return inside it is still a clean exit, and
  // any throw leaves the marker in place.
  const dispatch = async () => {
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
        dustSeeded: session.dustSeeded,
        dustSeedOutcome: session.dustSeedOutcome,
        dustBalance: state.dust.balance(new Date()).toString(),
      });
      return;
    }
    if (mode === "--seed-dust") {
      // Seeding has already happened (or failed and fallen back). The ordinary flow here
      // restores the seeded dust snapshot when it is present, so the dust wallet replays
      // only the tail; when seeding failed this is simply the full from-seed sync.
      const state = await awaitSync(config, session);
      await emit(config.runDir, {
        event: "sync-complete",
        address: session.address,
        restored: session.restored,
        dustSeeded: session.dustSeeded,
        dustSeedOutcome: session.dustSeedOutcome,
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
  };
  try {
    await dispatch();
    completed = true;
  } finally {
    await session.wallet.stop().catch(() => {});
    // Clear the marker only after the mode ran to completion. A thrown error or a killed
    // process leaves it in place, which is the signal the next run reports.
    if (completed) await clearRunMarker(config).catch(() => {});
  }
}

await main();
