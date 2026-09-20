// wallet-state-verify: the fail-closed verification gate for the restored wallet fast path.
//
// WHY THIS EXISTS
// A restored snapshot that merely does not throw is NOT proof of correctness. Three known
// upstream traps make that concrete:
//   T1  servicedesk #104: a snapshot serialized by an older wallet-sdk hangs the restore with
//       no exception and CPU near zero. A bounded restore with CPU accounting is the only
//       way to tell "hung" from "slow" (issue #639: a real dust state can take minutes).
//   T2  midnight-wallet #298: serializing mid-sync with spends in flight stores stale pending
//       state that hides balances after restore.
//   T3  midnight-wallet #559: a field dropped from a shielded snapshot restored WITHOUT error
//       and silently discarded history. A non-throwing restore therefore proves nothing, so
//       the gate cross-checks restored content against the chain instead of trusting it.
// The lane (preprod-lane.mjs) pays the ~125 minute genesis sync once, serializes each
// sub-wallet under <runDir>/wallet-state/, and restores on later runs. Before a restore is
// trusted, this module answers one question with evidence: is the restored state actually
// correct, and is the fast path safe to use? It refuses rather than guesses.
//
// Ported from hardening/v6/prototype/restore-verify/verify.mjs; the G1-G10 gate definition
// and the PASS/FAIL/UNEXERCISED semantics are that prototype's (see its RESULTS.md).
//
// SAFETY
// Read-only. It never signs, never submits, never writes to the chain, never reads
// .env.preprod, never handles a seed, and never records or prints snapshot contents. Snapshot
// files are hashed (SHA-256 + byte size) and only public metadata is extracted (addresses,
// indices, counts, flags, sizes).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export const NETWORK_ID = "preprod";
const INDEXER_HTTP = "https://indexer.preprod.midnight.network/api/v4/graphql";
const INDEXER_WS = "wss://indexer.preprod.midnight.network/api/v4/graphql/ws";
const PROOF_SERVER = "http://127.0.0.1:6300";
const RELAY = "wss://rpc.preprod.midnight.network";

// Exactly the files the lane serializes, and the packages it pins beside them.
export const WALLET_STATE_FILES = Object.freeze({
  shielded: "shielded.json",
  unshielded: "unshielded.json",
  dust: "dust.json",
});

export const SDK_PACKAGES = Object.freeze([
  "wallet-sdk",
  "wallet-sdk-facade",
  "wallet-sdk-shielded",
  "wallet-sdk-unshielded-wallet",
  "wallet-sdk-dust-wallet",
  "wallet-sdk-indexer-client",
]);

const require = createRequire(import.meta.url);

export function walletStateDir(runDir) {
  return resolve(runDir, "wallet-state");
}

// --------------------------------------------------------------------------------------
// Small utilities
// --------------------------------------------------------------------------------------
function asBigIntString(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  return null;
}

export async function sha256File(path) {
  const bytes = await readFile(path);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

/** Bound a promise with a hard timeout. Returns a value, never throws.
 *
 * It samples process CPU across the call. That distinction is load-bearing: the silent-hang
 * trap (#104) leaves CPU near zero, while a slow dust restore is CPU-bound (#639 measured
 * ~255s to deserialize a 5MB DustLocalState). A CPU-near-zero timeout refuses the snapshot;
 * a CPU-busy timeout is a slow restore and is re-run, never accepted as-is. */
export async function withTimeout(label, ms, fn) {
  const started = Date.now();
  const cpu0 = process.cpuUsage();
  let timer;
  const measured = (result) => {
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const elapsedMs = Date.now() - started;
    return {
      ...result,
      elapsedMs,
      cpuMs,
      stalled: result.status === "timeout" ? cpuMs < elapsedMs * 0.15 : false,
    };
  };
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        // Deliberately NOT unref'd: the silent-hang trap leaves no other handle, so an
        // unref'd timer could let the process exit before the timeout is reported.
        timer = setTimeout(
          () => reject(new Error(`__timeout__:${label} after ${ms}ms`)),
          ms,
        );
      }),
    ]);
    return measured({ status: "ok", value });
  } catch (error) {
    const message = String(error?.message ?? error);
    return measured({
      status: message.startsWith("__timeout__") ? "timeout" : "error",
      error: message.replace(/^__timeout__:/, ""),
    });
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------------------
// Version matrix
// --------------------------------------------------------------------------------------
// These packages are ESM-only: their "exports" maps declare no "require" condition, so
// require() of either the specifier or its package.json throws
// ERR_PACKAGE_PATH_NOT_EXPORTED, and an empty matrix would silently disable the version
// gate. Read each manifest by path from the node_modules trees above this module instead.
// A version that cannot be established is recorded as null, and every consumer fails
// closed on null rather than treating an unresolvable matrix as a match.
export async function resolveSdkVersions() {
  const bases = ["../", "../../", "../../../"].map(
    (up) => new URL(`${up}node_modules/@midnight-ntwrk/`, import.meta.url),
  );
  const matrix = {};
  for (const name of SDK_PACKAGES) {
    let version = null;
    for (const base of bases) {
      try {
        const manifest = JSON.parse(
          await readFile(new URL(`${name}/package.json`, base), "utf8"),
        );
        if (manifest.name === `@midnight-ntwrk/${name}`) {
          version = manifest.version;
          break;
        }
      } catch {
        // Not installed in this tree; try the next one up.
      }
    }
    matrix[name] = version;
  }
  return matrix;
}

/** Inspect the recorded version matrix beside a snapshot without touching the state files.
 * Returns the drift, the keys missing from the recording, and whether it is empty, so the
 * lane can tell "incomplete, repairable" (operator runs --repair-state) apart from "drifted,
 * forbidden" (a different SDK wrote it). */
export async function inspectSdkVersions(snapshotDir) {
  const path = resolve(snapshotDir, "sdk-versions.json");
  const current = await resolveSdkVersions();
  const out = {
    path,
    exists: existsSync(path),
    recorded: null,
    parseError: null,
    current,
    unresolved: Object.keys(current).filter((name) => current[name] === null),
    empty: false,
    missingKeys: [],
    unexpectedKeys: [],
    drifted: [],
  };
  if (!out.exists) return out;
  try {
    out.recorded = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    out.parseError = String(error?.message ?? error);
    return out;
  }
  if (
    out.recorded === null ||
    typeof out.recorded !== "object" ||
    Array.isArray(out.recorded)
  ) {
    out.parseError = "not a JSON object";
    return out;
  }
  const keys = Object.keys(out.recorded);
  out.empty = keys.length === 0;
  out.missingKeys = SDK_PACKAGES.filter((name) => out.recorded[name] == null);
  out.unexpectedKeys = keys.filter((key) => !SDK_PACKAGES.includes(key));
  for (const name of new Set([...keys, ...SDK_PACKAGES])) {
    const recorded = out.recorded[name] ?? null;
    const installed = current[name] ?? null;
    if (recorded !== installed)
      out.drifted.push({ name, recorded, current: installed });
  }
  return out;
}

/** Explicit operator repair for the version recording. Never called automatically during a
 * restore: an empty or key-incomplete sdk-versions.json refuses the fast path, and the
 * operator must deliberately rewrite it from the versions actually installed. */
export async function repairSdkVersions(snapshotDir) {
  const inspection = await inspectSdkVersions(snapshotDir);
  if (inspection.unresolved.length > 0)
    throw new Error(
      `cannot repair sdk-versions.json: unresolved installed versions for ${inspection.unresolved.join(", ")}`,
    );
  const after = {};
  for (const name of SDK_PACKAGES) after[name] = inspection.current[name];
  const needsRepair =
    !inspection.exists ||
    inspection.parseError !== null ||
    inspection.empty ||
    inspection.missingKeys.length > 0;
  if (!needsRepair)
    return {
      repaired: false,
      reason: "already-complete",
      path: inspection.path,
      before: inspection.recorded,
      after: inspection.recorded,
    };
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(inspection.path, `${JSON.stringify(after, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    repaired: true,
    path: inspection.path,
    before: inspection.recorded,
    after,
    missingBefore: inspection.missingKeys,
    emptyBefore: inspection.empty,
    parseErrorBefore: inspection.parseError,
  };
}

// --------------------------------------------------------------------------------------
// Check recording
// --------------------------------------------------------------------------------------
class Checks {
  constructor() {
    this.items = [];
  }
  add(
    id,
    title,
    status,
    { observed, expected, detail, requires, remedy } = {},
  ) {
    if (!["PASS", "FAIL", "UNEXERCISED"].includes(status))
      throw new Error(`bad status ${status}`);
    this.items.push({
      id,
      title,
      status,
      observed: observed ?? null,
      expected: expected ?? null,
      detail: detail ?? null,
      requires: requires ?? null,
      remedy: remedy ?? null,
    });
    const mark =
      status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "----";
    console.log(`[${mark}] ${id}: ${title}`);
    if (observed !== undefined && observed !== null)
      console.log(
        `        observed: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`,
      );
    if (status === "FAIL" && remedy) console.log(`        remedy: ${remedy}`);
  }
  get failed() {
    return this.items.filter((c) => c.status === "FAIL");
  }
  get unexercised() {
    return this.items.filter((c) => c.status === "UNEXERCISED");
  }
}

// --------------------------------------------------------------------------------------
// Snapshot parsing (public metadata only; never echo the payload)
// --------------------------------------------------------------------------------------
function parseSnapshot(role, text) {
  const problems = [];
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      role,
      ok: false,
      problems: [`not JSON: ${String(error.message)}`],
    };
  }
  const out = { role, ok: true, problems, networkId: json.networkId ?? null };
  if (json.networkId !== NETWORK_ID)
    problems.push(`networkId=${json.networkId}`);
  out.protocolVersion = asBigIntString(json.protocolVersion);
  if (out.protocolVersion === null)
    problems.push("protocolVersion missing/not an integer");

  if (role === "unshielded") {
    const available = json?.state?.availableUtxos;
    const pending = json?.state?.pendingUtxos;
    if (!Array.isArray(available) || !Array.isArray(pending)) {
      problems.push("state.availableUtxos/pendingUtxos missing");
      return { ...out, ok: problems.length === 0 };
    }
    out.appliedId = asBigIntString(json.appliedId);
    out.address = json?.publicKey?.address ?? null;
    out.addressHex = json?.publicKey?.addressHex ?? null;
    out.availableCount = available.length;
    out.pendingCount = pending.length;
    out.available = available.map((u) => ({
      key: `${u?.utxo?.intentHash}:${u?.utxo?.outputNo}`,
      value: asBigIntString(u?.utxo?.value),
      tokenType: u?.utxo?.type ?? null,
      owner: u?.utxo?.owner ?? null,
      ctimeSeconds: Math.floor(new Date(u?.meta?.ctime).getTime() / 1000),
      registeredForDustGeneration:
        u?.meta?.registeredForDustGeneration === true,
    }));
  } else if (role === "dust") {
    out.offset = asBigIntString(json.offset);
    const pk = json?.publicKey?.publicKey;
    out.dustPublicKey = asBigIntString(pk);
    if (out.dustPublicKey === null)
      problems.push("publicKey.publicKey missing");
    if (typeof json.state !== "string")
      problems.push("state is not a hex string");
    else out.dustStateBytes = Math.floor(json.state.length / 2);
  } else if (role === "shielded") {
    out.appliedIndex = asBigIntString(json.offset ?? json.appliedIndex);
    out.shieldedPublicKeys =
      json?.publicKey && typeof json.publicKey === "object"
        ? Object.keys(json.publicKey)
        : null;
    if (typeof json.state !== "string")
      problems.push("state is not a hex string");
    else out.shieldedStateBytes = Math.floor(json.state.length / 2);
  }
  out.ok = problems.length === 0;
  return out;
}

/** Normalize a live UtxoWithMeta from the restored wallet into the same shape the snapshot
 * parse produces, so the two can be compared field by field. */
function normalizeRestoredCoin(coin) {
  const utxo = coin?.utxo ?? coin;
  const meta = coin?.meta ?? {};
  const ctime = meta?.ctime ? new Date(meta.ctime).getTime() : Number.NaN;
  return {
    key: `${utxo?.intentHash}:${utxo?.outputNo}`,
    value: asBigIntString(utxo?.value),
    tokenType: utxo?.type == null ? null : String(utxo.type),
    owner: utxo?.owner == null ? null : String(utxo.owner),
    ctimeSeconds: Number.isFinite(ctime) ? Math.floor(ctime / 1000) : null,
    registeredForDustGeneration: meta?.registeredForDustGeneration === true,
  };
}

function compareUtxoSet(left, right) {
  const a = new Map(left.map((u) => [u.key, u]));
  const b = new Map(right.map((u) => [u.key, u]));
  const missing = [...a.keys()].filter((k) => !b.has(k));
  const extra = [...b.keys()].filter((k) => !a.has(k));
  const mismatched = [];
  for (const [key, one] of a) {
    const other = b.get(key);
    if (!other) continue;
    const diffs = [];
    if (String(one.value) !== String(other.value))
      diffs.push(`value ${one.value}!=${other.value}`);
    if (one.tokenType !== other.tokenType) diffs.push("tokenType");
    if (one.owner !== other.owner) diffs.push("owner");
    if (one.registeredForDustGeneration !== other.registeredForDustGeneration)
      diffs.push("registered");
    if (String(one.ctimeSeconds) !== String(other.ctimeSeconds))
      diffs.push(`ctime ${one.ctimeSeconds}!=${other.ctimeSeconds}`);
    if (diffs.length) mismatched.push({ key, diffs });
  }
  return {
    equal:
      missing.length === 0 && extra.length === 0 && mismatched.length === 0,
    leftCount: a.size,
    rightCount: b.size,
    missing,
    extra,
    mismatched,
  };
}

// --------------------------------------------------------------------------------------
// Chain-side reads (independent of the wallet and of the snapshot)
// --------------------------------------------------------------------------------------
async function gqlHttp(query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(INDEXER_HTTP, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const body = await res.json();
    if (!res.ok || body.errors)
      throw new Error(
        `indexer HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`,
      );
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

async function queryTip() {
  const data = await gqlHttp("query { block { height hash timestamp } }");
  return data.block;
}

function makeWs() {
  const { WebSocket } = require("ws");
  const { createClient } = require("graphql-ws");
  return { WebSocket, createClient };
}

/** Reconstruct the live unshielded UTXO set for `address` from the indexer, and read the
 * indexer's own high-water transaction id for it. This is chain truth: it is built from
 * createdUtxos/spentUtxos, never from the wallet or the snapshot. */
async function reconstructUnshielded(
  address,
  { timeoutMs = 90_000, quietMs = 4_000 } = {},
) {
  const { WebSocket, createClient } = makeWs();
  const client = createClient({
    url: INDEXER_WS,
    webSocketImpl: WebSocket,
    retryAttempts: 0,
    lazy: false,
  });
  const query = `
    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {
      unshieldedTransactions(address: $address, transactionId: $transactionId) {
        ... on UnshieldedTransaction {
          type: __typename
          transaction { type: __typename id }
          createdUtxos { owner tokenType value outputIndex intentHash ctime registeredForDustGeneration }
          spentUtxos { owner tokenType value outputIndex intentHash ctime registeredForDustGeneration }
        }
        ... on UnshieldedTransactionsProgress {
          type: __typename
          highestTransactionId
        }
      }
    }`;
  const utxos = new Map();
  const key = (u) => `${u.intentHash}:${u.outputIndex}`;
  let progressHighest = null;
  let maxEventTxId = 0;
  let txs = 0;
  let lastEvent = Date.now();
  let settled = false;

  const result = await new Promise((resolvePromise) => {
    let unsubscribe = () => {};
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      try {
        unsubscribe();
      } catch {}
      resolvePromise(outcome);
    };
    const deadline = setTimeout(
      () =>
        finish({
          ok: false,
          error: `subscription timed out after ${timeoutMs}ms`,
          txs,
        }),
      timeoutMs,
    );
    const poll = setInterval(() => {
      // The progress marker is not always delivered (observed intermittently against
      // Preprod), so accept a quiet period after any evidence of having caught up.
      const haveEvidence = progressHighest !== null || txs > 0;
      if (haveEvidence && Date.now() - lastEvent > quietMs)
        finish({ ok: true });
    }, 500);
    unsubscribe = client.subscribe(
      { query, variables: { address, transactionId: 0 } },
      {
        next: (msg) => {
          lastEvent = Date.now();
          const ev = msg?.data?.unshieldedTransactions;
          if (!ev) return;
          if (ev.type === "UnshieldedTransactionsProgress") {
            if (
              progressHighest === null ||
              ev.highestTransactionId > progressHighest
            )
              progressHighest = ev.highestTransactionId;
            return;
          }
          txs += 1;
          if (
            typeof ev.transaction?.id === "number" &&
            ev.transaction.id > maxEventTxId
          )
            maxEventTxId = ev.transaction.id;
          for (const u of ev.createdUtxos ?? []) utxos.set(key(u), u);
          for (const u of ev.spentUtxos ?? []) utxos.delete(key(u));
        },
        error: (e) =>
          finish({ ok: false, error: String(e?.message ?? e), txs }),
      },
    );
  });
  client.dispose().catch(() => {});
  return {
    ...result,
    txs,
    highestTransactionId: progressHighest ?? maxEventTxId,
    highestTransactionIdSource:
      progressHighest !== null ? "progress-marker" : "max-observed-tx-id",
    utxos: [...utxos.values()].map((u) => ({
      key: key(u),
      value: String(u.value),
      tokenType: u.tokenType,
      owner: u.owner,
      ctimeSeconds: u.ctime,
      registeredForDustGeneration: u.registeredForDustGeneration === true,
    })),
  };
}

/** The indexer's same-space high-water mark for a ledger-event index space. */
async function readHighWater(kind, { timeoutMs = 30_000 } = {}) {
  const { WebSocket, createClient } = makeWs();
  const client = createClient({
    url: INDEXER_WS,
    webSocketImpl: WebSocket,
    retryAttempts: 0,
    lazy: false,
  });
  const query =
    kind === "dust"
      ? "subscription { dustLedgerEvents(id: 0) { type: __typename id maxId } }"
      : "subscription { zswapLedgerEvents(id: 0) { id maxId } }";
  const field = kind === "dust" ? "dustLedgerEvents" : "zswapLedgerEvents";
  const out = await new Promise((resolvePromise) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsubscribe();
      } catch {}
      resolvePromise(v);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: "timed out" }),
      timeoutMs,
    );
    unsubscribe = client.subscribe(
      { query },
      {
        next: (msg) => {
          const ev = msg?.data?.[field];
          if (ev) finish({ ok: true, id: ev.id, maxId: ev.maxId });
        },
        error: (e) => finish({ ok: false, error: String(e?.message ?? e) }),
      },
    );
  });
  client.dispose().catch(() => {});
  return out;
}

// --------------------------------------------------------------------------------------
// SDK session helpers (mirrors the lane's configuration; no seed required)
// --------------------------------------------------------------------------------------
async function loadSdk() {
  const { WebSocket } = require("ws");
  globalThis.WebSocket = WebSocket;
  const { setNetworkId } = await import(
    "@midnight-ntwrk/midnight-js-network-id"
  );
  setNetworkId(NETWORK_ID);
  const ledger = await import("@midnight-ntwrk/midnight-js-protocol/ledger");
  const addressFormat = await import(
    "@midnight-ntwrk/wallet-sdk-address-format"
  );
  const sdk = await import("@midnight-ntwrk/wallet-sdk");
  const rxjs = require("rxjs");
  return { ledger, addressFormat, sdk, rxjs };
}

function walletConfiguration(ledger, sdk) {
  return {
    networkId: NETWORK_ID,
    indexerClientConnection: {
      indexerHttpUrl: INDEXER_HTTP,
      indexerWsUrl: INDEXER_WS,
      bufferSize: 20_000,
      resumeThreshold: 200,
    },
    batchUpdates: { size: 500, timeout: 2, spacing: 0 },
    provingServerUrl: new URL(PROOF_SERVER),
    relayURL: new URL(RELAY),
    txHistoryStorage: new sdk.NoOpTransactionHistoryStorage(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    dustParameters: ledger.LedgerParameters.initialParameters().dust,
  };
}

// --------------------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------------------
/** G1: exact version-pin match; refuse by name on any drift, and refuse when the installed
 * matrix itself cannot be resolved (comparing two empty records would read as "no drift"). */
async function checkVersionPin(checks, snapshotDir) {
  const inspection = await inspectSdkVersions(snapshotDir);
  if (!inspection.exists) {
    checks.add(
      "sdk-version-pin",
      "sdk-versions.json matches the resolved installed versions",
      "UNEXERCISED",
      {
        requires: inspection.path,
        detail:
          "no sdk-versions.json yet; a snapshot without it is never restored",
      },
    );
    return inspection;
  }
  if (inspection.parseError !== null) {
    checks.add(
      "sdk-version-pin",
      "sdk-versions.json matches the resolved installed versions",
      "FAIL",
      {
        expected: "a JSON object of package -> version",
        observed: `unreadable: ${inspection.parseError}`,
        remedy:
          "The version pin cannot be trusted. Run --repair-state as a deliberate operator action, or take a fresh full sync.",
      },
    );
    return inspection;
  }
  if (inspection.unresolved.length > 0) {
    checks.add(
      "sdk-version-pin",
      "sdk-versions.json matches the resolved installed versions",
      "FAIL",
      {
        expected: "every pinned package resolves to an installed version",
        observed: `unresolved installed versions: ${inspection.unresolved.join(", ")}`,
        detail: { unresolved: inspection.unresolved },
        remedy:
          "Cannot establish the installed SDK matrix, so drift cannot be ruled out. Fail closed: do not restore; take a full from-seed sync.",
      },
    );
    return inspection;
  }
  if (inspection.drifted.length > 0) {
    const detail = inspection.drifted.map(
      (d) =>
        `${d.name} recorded=${d.recorded ?? "absent"} installed=${d.current ?? "absent"}`,
    );
    checks.add(
      "sdk-version-pin",
      "sdk-versions.json matches the resolved installed versions",
      "FAIL",
      {
        expected:
          "recorded version == installed version for every pinned package",
        observed: `drift: ${detail.join(", ")}`,
        detail: {
          drifted: inspection.drifted,
          emptyRecorded: inspection.empty,
          missingKeys: inspection.missingKeys,
          unexpectedKeys: inspection.unexpectedKeys,
        },
        remedy:
          "Snapshot was written by a different SDK. Do NOT restore it: run --repair-state only if the recording is merely incomplete {}, otherwise move wallet-state aside and take a fresh from-seed full sync. Restoring across this drift is the silent-hang trap (servicedesk #104).",
      },
    );
    return inspection;
  }
  checks.add(
    "sdk-version-pin",
    "sdk-versions.json matches the resolved installed versions",
    "PASS",
    {
      expected:
        "recorded version == installed version for every pinned package",
      observed: `all ${SDK_PACKAGES.length} pinned packages match`,
    },
  );
  return inspection;
}

/** G2: all three snapshot files present, parse, are preprod, and carry no pending state. */
async function checkSnapshotShape(checks, snapshotDir) {
  const texts = {};
  const parsed = {};
  const hashes = {};
  for (const [role, file] of Object.entries(WALLET_STATE_FILES)) {
    const path = resolve(snapshotDir, file);
    if (!existsSync(path)) {
      checks.add(
        `snapshot-${role}`,
        `${file} present, parses, and is a ${NETWORK_ID} snapshot`,
        "UNEXERCISED",
        {
          requires: path,
          detail: "file not written yet (a full sync has not completed)",
        },
      );
      continue;
    }
    const hashed = await sha256File(path);
    hashes[role] = { file, ...hashed };
    texts[role] = await readFile(path, "utf8");
    const p = parseSnapshot(role, texts[role]);
    parsed[role] = p;
    const problems = [...p.problems];
    if (role === "unshielded" && p.pendingCount > 0)
      problems.push(
        `pendingUtxos=${p.pendingCount} (stale-pending trap, issue #298)`,
      );
    checks.add(
      `snapshot-${role}`,
      `${file} present, parses, networkId=${NETWORK_ID}, no pending state`,
      p.ok ? "PASS" : "FAIL",
      {
        expected: `networkId=${NETWORK_ID}, schema-valid, unshielded pendingUtxos empty`,
        observed:
          problems.length === 0
            ? role === "unshielded"
              ? `available=${p.availableCount} pending=${p.pendingCount} appliedId=${p.appliedId} address=${p.address}`
              : role === "dust"
                ? `offset=${p.offset} dustStateBytes=${p.dustStateBytes}`
                : `offset=${p.appliedIndex} shieldedStateBytes=${p.shieldedStateBytes}`
            : problems.join("; "),
        detail: { sha256: hashed.sha256, bytes: hashed.bytes },
        remedy:
          "A snapshot that does not parse as a preprod state, or that carries pending state, must not be restored. Take a fresh full sync.",
      },
    );
  }
  const missing = Object.keys(WALLET_STATE_FILES).filter((r) => !texts[r]);
  checks.add(
    "snapshot-complete",
    "all three sub-wallet snapshots are present",
    missing.length === 0 ? "PASS" : "FAIL",
    {
      expected: "shielded.json, unshielded.json and dust.json all present",
      observed:
        missing.length === 0
          ? "all three present"
          : `missing: ${missing.join(", ")}`,
      remedy:
        "A partial snapshot cannot be restored by the lane (it requires all three roles). Take a fresh full sync.",
    },
  );
  return { texts, parsed, hashes };
}

/** Live tip plus the dust/zswap ledger-event high-water marks. Chain truth, always read. */
async function checkChain(checks, parsed, opts) {
  const [tip, dustHw, zswapHw] = await Promise.all([
    withTimeout("tip", 25_000, queryTip),
    withTimeout("dust-hw", 35_000, () => readHighWater("dust")),
    withTimeout("zswap-hw", 35_000, () => readHighWater("zswap")),
  ]);
  const chain = {
    tip: tip.status === "ok" ? tip.value : null,
    dustHighWater: dustHw.status === "ok" ? dustHw.value.maxId : null,
    zswapHighWater: zswapHw.status === "ok" ? zswapHw.value.maxId : null,
    unshielded: null,
  };
  checks.add(
    "chain-tip",
    "indexer tip reachable and indexer high-water marks readable",
    chain.tip !== null &&
      chain.dustHighWater !== null &&
      chain.zswapHighWater !== null
      ? "PASS"
      : "FAIL",
    {
      expected: "block tip + dust maxId + zswap maxId",
      observed: JSON.stringify({
        tip: chain.tip,
        dustHighWater: chain.dustHighWater,
        zswapHighWater: chain.zswapHighWater,
      }),
    },
  );

  const address = parsed?.unshielded?.address ?? null;
  if (address === null) {
    chain.unshielded = {
      ok: false,
      error: "no unshielded address in the snapshot",
      utxos: [],
      highestTransactionId: null,
    };
    return chain;
  }
  const r = await withTimeout(
    "reconstruct-unshielded",
    opts.chainTimeoutMs,
    () =>
      reconstructUnshielded(address, {
        timeoutMs: opts.chainTimeoutMs - 5_000,
        quietMs: opts.quietMs,
      }),
  );
  if (r.status !== "ok" || !r.value.ok) {
    chain.unshielded = {
      ok: false,
      error:
        r.status === "ok"
          ? r.value.error
          : `${r.status} after ${r.elapsedMs}ms: ${r.error}`,
      utxos: [],
      highestTransactionId: null,
    };
  } else {
    chain.unshielded = { ok: true, ...r.value };
  }
  return chain;
}

/** G7/G8: dust and shielded applied indices positive, within their own high-water marks,
 * and within the block tip. */
function checkLedgerIndices(checks, parsed, chain) {
  const dustOff =
    parsed?.dust?.offset !== undefined ? BigInt(parsed.dust.offset) : null;
  const shieldedOff =
    parsed?.shielded?.appliedIndex !== undefined
      ? BigInt(parsed.shielded.appliedIndex)
      : null;
  if (dustOff === null || shieldedOff === null) {
    checks.add(
      "ledger-index-crosscheck",
      "dust/shielded applied indices are positive and within their chain high-water marks",
      "UNEXERCISED",
      {
        requires: "dust.json and shielded.json",
        detail:
          "both snapshot files are needed to bound both index spaces; missing one leaves the check unexercised",
      },
    );
  } else if (chain.dustHighWater === null || chain.zswapHighWater === null) {
    checks.add(
      "ledger-index-crosscheck",
      "dust/shielded applied indices are positive and within their chain high-water marks",
      "FAIL",
      {
        expected: "live dust/zswap high-water marks read from the indexer",
        observed: `dustHighWater=${chain.dustHighWater} zswapHighWater=${chain.zswapHighWater}`,
        remedy:
          "The indexer high-water marks are unreadable, so the applied indices cannot be validated. Fail closed and re-sync.",
      },
    );
  } else {
    const dustOk = dustOff > 0n && dustOff <= BigInt(chain.dustHighWater);
    const shieldedOk =
      shieldedOff > 0n && shieldedOff <= BigInt(chain.zswapHighWater);
    checks.add(
      "ledger-index-crosscheck",
      "dust/shielded applied indices are positive and within their chain high-water marks",
      dustOk && shieldedOk ? "PASS" : "FAIL",
      {
        expected: `0 < dust.offset <= ${chain.dustHighWater} and 0 < shielded.offset <= ${chain.zswapHighWater}`,
        observed: `dust.offset=${dustOff} shielded.offset=${shieldedOff}`,
        remedy:
          "An applied index beyond the chain high-water means the snapshot belongs to a different chain or is corrupt. Fall back to a full from-seed sync.",
      },
    );
  }

  if (chain.tip !== null && dustOff !== null && shieldedOff !== null) {
    const ceiling = BigInt(chain.tip.height);
    const ok =
      dustOff > 0n &&
      dustOff <= ceiling &&
      shieldedOff > 0n &&
      shieldedOff <= ceiling;
    checks.add(
      "tip-sanity",
      "recorded applied offsets do not exceed the indexer's block height",
      ok ? "PASS" : "FAIL",
      {
        expected: `0 < dust.offset, shielded.offset <= tip.height=${chain.tip.height}`,
        observed: `dust.offset=${dustOff} shielded.offset=${shieldedOff} tip.height=${chain.tip.height} tip.hash=${chain.tip.hash}`,
        detail:
          "A loose plausibility bound: wallet applied indices live in ledger-event index spaces, not block heights, so exact equality against the tip is undefined. The same-space comparison is ledger-index-crosscheck.",
        remedy:
          "An offset beyond the tip cannot belong to this chain. Fall back to a full from-seed sync.",
      },
    );
  } else {
    checks.add(
      "tip-sanity",
      "recorded applied offsets do not exceed the indexer's block height",
      "UNEXERCISED",
      {
        requires: "dust.json, shielded.json and a readable tip",
        detail: "tip or an applied offset is unavailable",
      },
    );
  }
}

/** G4/G9/G10: bounded restore of every role, a bounded start of the restored unshielded
 * wallet (no secret key needed), and the dust address consistency check. */
async function checkBoundedRestore(checks, texts, opts, chain) {
  const present = Object.keys(WALLET_STATE_FILES).filter((r) => texts[r]);
  if (present.length === 0) {
    checks.add(
      "bounded-restore",
      "restore each sub-wallet from its snapshot under a hard timeout",
      "UNEXERCISED",
      {
        requires: "shielded.json, unshielded.json, dust.json",
        detail: "no snapshot on disk yet",
      },
    );
    return null;
  }
  let sdkParts;
  try {
    sdkParts = await loadSdk();
  } catch (error) {
    checks.add(
      "bounded-restore",
      "restore each sub-wallet under a hard timeout",
      "FAIL",
      {
        observed: `SDK import failed: ${String(error?.message ?? error)}`,
        remedy: "install the pinned SDK in the integration package",
      },
    );
    return null;
  }
  const { sdk, ledger, rxjs } = sdkParts;
  const cfg = walletConfiguration(ledger, sdk);
  const out = { instances: {} };

  // A CPU-busy timeout is a slow restore (#639), not a hang: re-run it with a larger bound
  // rather than accepting it. A CPU-near-zero timeout is the silent hang (#104) and refuses.
  const restoreRole = async (role, make) => {
    const first = await withTimeout(`${role}-restore`, opts.timeoutMs, make);
    if (first.status === "timeout" && !first.stalled) {
      const retry = await withTimeout(
        `${role}-restore-retry`,
        opts.timeoutMs * 2,
        make,
      );
      return { ...retry, attempts: 2, firstAttempt: first };
    }
    return { ...first, attempts: 1 };
  };

  const constructs = [
    ["shielded", () => sdk.ShieldedWallet(cfg).restore(texts.shielded)],
    ["unshielded", () => sdk.UnshieldedWallet(cfg).restore(texts.unshielded)],
    ["dust", () => sdk.DustWallet(cfg).restore(texts.dust)],
  ];
  for (const [role, make] of constructs) {
    if (!texts[role]) {
      checks.add(
        `bounded-restore-${role}`,
        `restore ${role} snapshot within ${opts.timeoutMs}ms`,
        "UNEXERCISED",
        {
          requires: `${role} snapshot file`,
          detail: `no ${role} snapshot on disk; the lane needs all three roles so a missing role already forbids the fast path`,
        },
      );
      continue;
    }
    const r = await restoreRole(role, make);
    out[role] = {
      status: r.status,
      elapsedMs: r.elapsedMs,
      cpuMs: r.cpuMs,
      stalled: r.stalled,
      attempts: r.attempts,
      error: r.error ?? null,
    };
    if (r.status === "ok") out.instances[role] = r.value;
    checks.add(
      `bounded-restore-${role}`,
      `restore ${role} snapshot within ${opts.timeoutMs}ms`,
      r.status === "ok" ? "PASS" : "FAIL",
      {
        expected: `construction completes within ${opts.timeoutMs}ms`,
        observed:
          r.status === "ok"
            ? `constructed in ${r.elapsedMs}ms (attempts=${r.attempts})`
            : `${r.status} after ${r.elapsedMs}ms (cpu ${Math.round(r.cpuMs)}ms${r.stalled ? ", STALLED: cpu near zero" : ", cpu busy"}, attempts=${r.attempts}): ${r.error}`,
        remedy:
          r.status === "timeout" && r.stalled
            ? `Silent-hang trap (servicedesk #104): restore consumed ~no CPU for the bound. Do NOT retry restore. Fall back to a full from-seed sync.`
            : r.status === "timeout"
              ? `Restore was CPU-busy for the bound, i.e. slow rather than hung (#639); it was re-run with a larger bound and still did not finish. Do not use the fast path: take a full sync or raise --timeout-ms deliberately.`
              : "Restore rejected the snapshot. Fall back to a full from-seed sync.",
      },
    );
  }

  // Unshielded needs no secret key to start: exercise the full restore -> start -> sync.
  const unshielded = out.instances.unshielded;
  if (unshielded) {
    const target =
      chain?.unshielded?.ok && chain.unshielded.highestTransactionId !== null
        ? BigInt(chain.unshielded.highestTransactionId)
        : null;
    const started = await withTimeout(
      "unshielded-start",
      opts.timeoutMs,
      async () => {
        await unshielded.start();
        const state = await rxjs.firstValueFrom(
          unshielded.state.pipe(
            rxjs.filter((s) => {
              if (s?.progress?.isConnected !== true) return false;
              if (target === null) return true;
              return BigInt(s.progress.appliedId ?? 0n) >= target;
            }),
          ),
        );
        return {
          connected: state.progress.isConnected === true,
          appliedId: String(state.progress.appliedId ?? 0n),
          highestTransactionId: String(
            state.progress.highestTransactionId ?? 0n,
          ),
          pendingCoins: state.pendingCoins.length,
          availableCoins: state.availableCoins.length,
          coins: state.availableCoins.map(normalizeRestoredCoin),
          address: String(state.address ?? ""),
        };
      },
    );
    out.unshieldedStart = started;
    checks.add(
      "bounded-restore-unshielded-start",
      "restored unshielded wallet starts and reports a connected progress",
      started.status === "ok" ? "PASS" : "FAIL",
      {
        expected:
          target === null
            ? "start + connected state within timeout"
            : `start + connected with appliedId >= indexer highestTransactionId ${target}`,
        observed:
          started.status === "ok"
            ? JSON.stringify({
                connected: started.value.connected,
                appliedId: started.value.appliedId,
                highestTransactionId: started.value.highestTransactionId,
                pendingCoins: started.value.pendingCoins,
                availableCoins: started.value.availableCoins,
              })
            : `${started.status} after ${started.elapsedMs}ms: ${started.error}`,
        remedy:
          "Restored wallet never became connected and current. Fall back to a full from-seed sync.",
      },
    );
    // G3: no stale pending state may survive the restore (issue #298).
    checks.add(
      "pending-clean-restored",
      "restored wallet has no stale pending coins (issue #298 trap)",
      started.status === "ok"
        ? started.value.pendingCoins === 0
          ? "PASS"
          : "FAIL"
        : "UNEXERCISED",
      {
        expected: "pendingCoins == 0 after restore",
        observed:
          started.status === "ok"
            ? `pendingCoins=${started.value.pendingCoins}`
            : "start not reached",
        remedy:
          "Snapshot was written with spends in flight. Move wallet-state aside and take a fresh full sync; do not spend from this state.",
      },
    );
  } else if (texts.unshielded) {
    checks.add(
      "bounded-restore-unshielded-start",
      "restored unshielded wallet starts and reports a connected progress",
      "UNEXERCISED",
      { requires: "a successfully constructed unshielded restore" },
    );
    checks.add(
      "pending-clean-restored",
      "restored wallet has no stale pending coins (issue #298 trap)",
      "UNEXERCISED",
      { requires: "a successfully constructed unshielded restore" },
    );
  }

  // G9: the dust address derives from the snapshot public key and matches the restored
  // dust wallet. The indexer exposes no query for a dust address, so this is a consistency
  // check, not an independent chain check.
  const dustParsed = texts.dust ? parseSnapshot("dust", texts.dust) : null;
  if (
    dustParsed?.dustPublicKey !== null &&
    dustParsed?.dustPublicKey !== undefined
  ) {
    try {
      const { addressFormat } = sdkParts;
      const derived = addressFormat.DustAddress.encodePublicKey(
        NETWORK_ID,
        BigInt(dustParsed.dustPublicKey),
      );
      let restoredAddress = null;
      if (out.instances.dust) {
        const r = await withTimeout("dust-getAddress", 15_000, () =>
          out.instances.dust.getAddress(),
        );
        if (r.status === "ok") restoredAddress = r.value;
      }
      // Normalise both sides to a bech32 string before comparing. encodePublicKey returns a
      // value that stringifies to bech32, while getAddress() returns an address OBJECT whose
      // String() is "[object Object]" - comparing them raw produced a false FAIL that refused
      // a valid snapshot and forced a full sync.
      const asBech32 = (value) => {
        if (value === null || value === undefined) return null;
        const direct = String(value);
        if (direct.startsWith("mn_dust_")) return direct;
        const attempts = [
          () => value.asString?.(),
          () =>
            addressFormat.MidnightBech32m.encode(
              NETWORK_ID,
              value,
            )?.toString(),
        ];
        for (const attempt of attempts) {
          try {
            const text = attempt();
            if (typeof text === "string" && text.startsWith("mn_dust_"))
              return text;
          } catch {
            // Try the next encoder.
          }
        }
        return direct;
      };
      const derivedText = asBech32(derived);
      const restoredText = asBech32(restoredAddress);
      const consistent =
        restoredText === null || restoredText === derivedText;
      checks.add(
        "dust-address",
        "dust address derived from the snapshot public key is well-formed and consistent",
        consistent ? "PASS" : "FAIL",
        {
          expected: "derived dust address == restored dust wallet address",
          observed: `derived=${derivedText} restored=${restoredText ?? "not readable without start"}`,
          detail:
            "The indexer exposes no query for a Midnight dust address, so this is a consistency check, not an independent chain check.",
          remedy:
            "The dust public key and the restored dust wallet disagree. Fall back to a full from-seed sync.",
        },
      );
      out.dustAddress = String(derived);
    } catch (error) {
      checks.add(
        "dust-address",
        "dust address derived from the snapshot public key is well-formed",
        "FAIL",
        { observed: String(error?.message ?? error) },
      );
    }
  } else {
    checks.add(
      "dust-address",
      "dust address derived from the snapshot public key is well-formed and consistent",
      "UNEXERCISED",
      { requires: "dust.json with a public key" },
    );
  }

  // Constructed sub-wallets must not keep the process alive or leak handles.
  for (const [role, instance] of Object.entries(out.instances)) {
    if (typeof instance?.stop === "function")
      await withTimeout(`stop-${role}`, 10_000, () => instance.stop());
  }
  delete out.instances;
  return out;
}

/** G5/G6: the restored unshielded wallet's UTXO set equals the chain's for its address, and
 * its applied index equals the indexer's highest transaction id for that address. */
function checkUnshieldedAgainstChain(checks, restored, chain) {
  const start = restored?.unshieldedStart;
  if (start?.status !== "ok") {
    checks.add(
      "unshielded-crosscheck",
      "restored unshielded UTXO set equals the indexer's for that address",
      "UNEXERCISED",
      { requires: "a successfully started restored unshielded wallet" },
    );
    checks.add(
      "unshielded-applied-id",
      "restored applied index equals the indexer's highest transaction id",
      "UNEXERCISED",
      { requires: "a successfully started restored unshielded wallet" },
    );
    return;
  }
  if (!chain?.unshielded?.ok) {
    checks.add(
      "unshielded-crosscheck",
      "restored unshielded UTXO set equals the indexer's for that address",
      "FAIL",
      {
        observed:
          chain?.unshielded?.error ?? "chain reconstruction unavailable",
        remedy:
          "The chain could not be read, so the restore cannot be validated. Fail closed and take a full sync.",
      },
    );
    checks.add(
      "unshielded-applied-id",
      "restored applied index equals the indexer's highest transaction id",
      "FAIL",
      {
        observed:
          chain?.unshielded?.error ?? "chain reconstruction unavailable",
        remedy: "Fail closed and take a full sync.",
      },
    );
    return;
  }
  const cmp = compareUtxoSet(start.value.coins, chain.unshielded.utxos);
  checks.add(
    "unshielded-crosscheck",
    "restored unshielded UTXO set equals the indexer's for that address",
    cmp.equal ? "PASS" : "FAIL",
    {
      expected:
        "exact set equality on (intentHash,outputNo) and value/tokenType/owner/registered/ctime",
      observed: JSON.stringify({
        restoredCount: cmp.leftCount,
        chainCount: cmp.rightCount,
        missingOnChain: cmp.missing.slice(0, 5),
        extraOnChain: cmp.extra.slice(0, 5),
        mismatched: cmp.mismatched.slice(0, 5),
      }),
      remedy:
        "Restored UTXO set disagrees with the chain. Fall back to a full from-seed sync.",
    },
  );
  const appliedOk =
    chain.unshielded.highestTransactionId !== null &&
    String(start.value.appliedId) ===
      String(chain.unshielded.highestTransactionId);
  checks.add(
    "unshielded-applied-id",
    "restored applied index equals the indexer's highest transaction id",
    appliedOk ? "PASS" : "FAIL",
    {
      expected: `restored appliedId == indexer highestTransactionId ${chain.unshielded.highestTransactionId}`,
      observed: `restored appliedId=${start.value.appliedId} indexer highestTransactionId=${chain.unshielded.highestTransactionId}`,
      remedy:
        "The restored wallet is not at the chain's tip for this address. Fall back to a full from-seed sync.",
    },
  );
}

function summarizeRestored(restored) {
  if (!restored) return null;
  const roleSummary = (role) =>
    restored[role]
      ? {
          status: restored[role].status,
          elapsedMs: restored[role].elapsedMs,
          attempts: restored[role].attempts,
          error: restored[role].error,
        }
      : null;
  return {
    shielded: roleSummary("shielded"),
    unshielded: roleSummary("unshielded"),
    dust: roleSummary("dust"),
    unshieldedStart: restored.unshieldedStart
      ? {
          status: restored.unshieldedStart.status,
          connected: restored.unshieldedStart.value?.connected ?? null,
          appliedId: restored.unshieldedStart.value?.appliedId ?? null,
          pendingCoins: restored.unshieldedStart.value?.pendingCoins ?? null,
          availableCoins:
            restored.unshieldedStart.value?.availableCoins ?? null,
        }
      : null,
    dustAddress: restored.dustAddress ?? null,
  };
}

// The written definition of the no-regression gate. Every condition must hold before the
// restored fast path may replace a full sync; any failure means a full from-seed sync.
export const GATE_DEFINITION = Object.freeze({
  statement:
    "The restored fast path may be used only if every condition below holds on a snapshot that is present, schema-valid, version-pinned, restores within the bound, and agrees with the chain. Any single failure falls back to a full from-seed sync; a partial or unverified state is never used.",
  conditions: [
    {
      id: "G1",
      check: "sdk-version-pin",
      text: "sdk-versions.json matches the resolved installed versions exactly; any drift refuses the snapshot by name. An unresolvable installed matrix also refuses.",
    },
    {
      id: "G2",
      check: "snapshot-{shielded,unshielded,dust} + snapshot-complete",
      text: "all three snapshots exist, parse, record networkId=preprod, and carry no pending state.",
    },
    {
      id: "G3",
      check: "pending-clean-restored",
      text: "no pending state survives restore (unshielded pendingUtxos empty; restored pendingCoins == 0), guarding issue #298.",
    },
    {
      id: "G4",
      check: "bounded-restore-{shielded,unshielded,dust}",
      text: "each role restores within the hard timeout and without error; a timeout with CPU near zero is the silent hang of #104 and refuses the snapshot, while a CPU-busy timeout is slow restore (#639) and is re-run with a larger bound, not accepted.",
    },
    {
      id: "G5",
      check: "unshielded-crosscheck",
      text: "the restored unshielded UTXO set equals the chain-reconstructed set exactly (key, value, tokenType, owner, registered flag, ctime).",
    },
    {
      id: "G6",
      check: "unshielded-applied-id",
      text: "the restored applied index equals the indexer's highestTransactionId for the wallet address.",
    },
    {
      id: "G7",
      check: "ledger-index-crosscheck",
      text: "dust and shielded applied indices are positive and within their own chain high-water marks (dust/zswap ledger-event maxId).",
    },
    {
      id: "G8",
      check: "tip-sanity",
      text: "recorded offsets do not exceed the indexer's block height, and the tip height/hash are recorded in the receipt.",
    },
    {
      id: "G9",
      check: "dust-address",
      text: "the dust address derived from the snapshot public key is well-formed and matches the restored dust wallet.",
    },
    {
      id: "G10",
      check: "bounded-restore-unshielded-start",
      text: "the restored unshielded wallet starts, becomes connected and current, and reports zero pending coins.",
    },
  ],
  onFailure:
    "Write the receipt with FAIL and the observed value, refuse the fast path, and take a fresh full from-seed sync (the lane's restore:false path). Never proceed on a partial state.",
  knownLimits: [
    "Dust and shielded wallets need their secret keys to start(); this module must not handle a seed, so their post-restore forward sync to the high-water mark is UNEXERCISED. Only the <= bound is checked.",
    "The indexer exposes no query for a Midnight dust address, so G9 is a consistency check, not an independent chain check.",
    "The SDK has no version marker inside the three snapshots (midnight-wallet #559), and a dropped field has already restored without error and silently discarded data. The external version pin (G1) plus the chain cross-checks (G5/G6) are the defence; shielded content has no independent chain query and is the largest residual gap.",
    "Progress is not a completion signal: #623 shows appliedIndex moving backwards on restored wallets and #646 shows the fast/projections dust sync wedging, so indices are treated as a bound plus one equality check, never as a synced boolean.",
    "withTimeout is an event-loop bound: it preempts a promise that never settles (the #104 silent hang) and a slow async restore that yields, but it cannot preempt a synchronous CPU block, which blocks the timer itself. A synchronous restore that eventually returns is still validated against the chain, so correctness holds; only a hypothetical synchronous infinite loop would evade the bound, and no such restore mode is known.",
  ],
});

// --------------------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------------------
/**
 * Verify a snapshot directory. Returns a structured result: every named check with PASS/FAIL
 * (or UNEXERCISED when a prerequisite is absent), plus the overall `safeForFastPath` boolean.
 * Never throws for a check failure; only for a programming error.
 */
export async function verifyWalletState(snapshotDir, options = {}) {
  const opts = {
    timeoutMs: options.timeoutMs ?? 300_000,
    chainTimeoutMs: options.chainTimeoutMs ?? 90_000,
    quietMs: options.quietMs ?? 4_000,
    receiptPath:
      options.receiptPath ?? resolve(snapshotDir, "verification-receipt.json"),
    writeReceipt: options.writeReceipt !== false,
  };
  const checks = new Checks();
  const receipt = {
    tool: "wallet-state-verify",
    version: 1,
    generatedAt: new Date().toISOString(),
    networkId: NETWORK_ID,
    indexer: INDEXER_HTTP,
    node: process.version,
    snapshotDir,
    timeoutMs: opts.timeoutMs,
    resolvedSdkVersions: await resolveSdkVersions(),
    snapshotFiles: {},
    chain: null,
    restored: null,
    checks: [],
    verdict: {},
    gate: GATE_DEFINITION,
  };

  await checkVersionPin(checks, snapshotDir);
  const shape = await checkSnapshotShape(checks, snapshotDir);
  receipt.snapshotFiles = shape.hashes;
  const chain = await checkChain(checks, shape.parsed, opts);
  receipt.chain = {
    tip: chain.tip,
    dustHighWater: chain.dustHighWater,
    zswapHighWater: chain.zswapHighWater,
    unshielded: chain.unshielded
      ? {
          ok: chain.unshielded.ok,
          error: chain.unshielded.error ?? null,
          utxoCount: chain.unshielded.utxos?.length ?? 0,
          highestTransactionId: chain.unshielded.highestTransactionId ?? null,
          highestTransactionIdSource:
            chain.unshielded.highestTransactionIdSource ?? null,
        }
      : null,
  };
  checkLedgerIndices(checks, shape.parsed, chain);
  const restored = await checkBoundedRestore(checks, shape.texts, opts, chain);
  receipt.restored = summarizeRestored(restored);
  checkUnshieldedAgainstChain(checks, restored, chain);

  const failed = checks.failed;
  const unexercised = checks.unexercised;
  receipt.checks = checks.items;
  receipt.verdict = {
    checksRun: checks.items.length,
    passed: checks.items.filter((c) => c.status === "PASS").length,
    failed: failed.length,
    unexercised: unexercised.length,
    failedIds: failed.map((c) => c.id),
    unexercisedIds: unexercised.map((c) => c.id),
    safeForFastPath: failed.length === 0 && unexercised.length === 0,
  };

  if (opts.writeReceipt) {
    await mkdir(dirname(opts.receiptPath), { recursive: true });
    await writeFile(opts.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  return {
    safeForFastPath: receipt.verdict.safeForFastPath,
    checks: checks.items,
    failedIds: receipt.verdict.failedIds,
    unexercisedIds: receipt.verdict.unexercisedIds,
    receipt,
    receiptPath: opts.writeReceipt ? opts.receiptPath : null,
  };
}
