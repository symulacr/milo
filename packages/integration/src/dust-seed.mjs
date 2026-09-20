// DUST start-late seeder for Midnight Preprod.
//
// A fresh wallet normally replays the entire dust ledger event history
// (currently ~1.3 to 1.54 million events on Preprod) before it can hold a
// usable DUST tree. This module seeds the two dust Merkle trees directly from
// the indexer's collapsed updates, verifies the seeded roots against the roots
// the chain publishes, and only then replays the post-seed tail.
//
// Safety posture (fail closed):
//   * the published tip (end indices and dust roots) must be stable across two
//     consecutive reads before anything is compared, so verification never runs
//     against a moving target on an actively-growing chain;
//   * the block, both collapsed updates, the previous `maxLag` collapse states
//     and a batch of recent blocks' dust events are then fetched in a single
//     pinned indexer request, so every value compared belongs to one indexer
//     state and the tail boundary is pinned to the same state as the trees;
//   * the leaf count of the reconstructed trees is derived from that same
//     response (the collapsed update end index, cross-checked against the
//     reconstructed tree's first-free index), so the comparison cannot straddle
//     two different tree states;
//   * verification accepts a published root that trails the collapsed-update
//     endpoint by up to `maxLag` leaves (the live tip field is known to lag on
//     a busy chain) and aborts on anything wider;
//   * nothing is emitted unless both roots verify, the tail cursor is anchored
//     to the pinned state, and the produced snapshot round-trips through the
//     shipped SDK's own serialization capability;
//   * the tail replay is bounded, requires contiguous event ids, and surfaces
//     the ledger's "values inserted non-linearly into dust generation tree"
//     error as a `DustSeedError` naming the offset, so a wrong offset fails
//     visibly instead of hanging a restoring wallet's sync loop;
//   * the seeder is read-only: it never signs, never submits, and never writes
//     to the chain. No secret material (no seed, no secret key) is ever
//     serialized, logged, or returned.
//
// The tail cursor matters: the collapsed trees cover every dust event up to the
// pinned block, and replaying one of those covered events is not idempotent
// (the ledger throws "values inserted non-linearly into dust commitment tree").
// The cursor is therefore derived from the pinned state itself, never guessed.

import * as ledger from "@midnight-ntwrk/ledger-v8";
import { CoreWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet/v1";

/** Public Preprod indexer GraphQL endpoint. */
export const PREPROD_INDEXER_HTTP =
  "https://indexer.preprod.midnight.network/api/v4/graphql";
/** Public Preprod indexer GraphQL websocket endpoint. */
export const PREPROD_INDEXER_WS =
  "wss://indexer.preprod.midnight.network/api/v4/graphql/ws";

/** One byte tag the chain prefixes to a dust Merkle root. */
const DUST_ROOT_TAG = "73";

/** Defaults shared by every seeder call. */
export const DUST_SEED_DEFAULTS = Object.freeze({
  indexerHttp: PREPROD_INDEXER_HTTP,
  indexerWs: PREPROD_INDEXER_WS,
  networkId: "preprod",
  // Overall bounded wall clock for one seeding attempt.
  deadlineMs: 45_000,
  // Per HTTP request bound.
  requestTimeoutMs: 15_000,
  // How many consecutive equal reads of the published tip settle it. Two reads
  // (one repeat) is the documented quiet-window sample.
  stabiliseReads: 2,
  // Gap between the quiet-window reads.
  stabilisePollMs: 500,
  // Wall clock after which an unsettled tip is refused rather than chased.
  stabiliseMs: 20_000,
  // How many times to re-pin the tip before giving up on a root match.
  pinAttempts: 4,
  // Widest accepted published-root lag, in leaves. The live tip field has been
  // observed lagging three leaves behind the collapsed-update endpoint.
  maxLag: 4,
  // How far back to look for the most recent dust event anchoring the cursor.
  maxScanBlocks: 512,
  scanBatchSize: 24,
  // Bounded tail listen window and idle flush.
  tailMs: 4_000,
  tailQuietMs: 1_200,
  maxTailEvents: 2_000,
  protocolVersion: 0n,
});

/** A seeder failure that must prevent any snapshot from being emitted. */
export class DustSeedError extends Error {
  constructor(message) {
    super(message);
    this.name = "DustSeedError";
  }
}

/** Raised when the bounded operation runs out of wall clock. */
export class DustSeedTimeoutError extends DustSeedError {
  constructor(message) {
    super(message);
    this.name = "DustSeedTimeoutError";
  }
}

function isSafeIndex(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isHex(value) {
  return typeof value === "string" && /^[0-9a-fA-F]+$/.test(value);
}

/**
 * Normalize a hex payload: accept an optional `0x` prefix and require an even
 * number of hex digits. Returns the bare lowercase hex without the prefix.
 */
function normalizeHex(value, label) {
  if (typeof value !== "string") {
    throw new DustSeedError(`${label} must be a hex string`);
  }
  const hex =
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!isHex(hex) || hex.length % 2 !== 0) {
    throw new DustSeedError(`${label} is not an even-length hex string`);
  }
  return hex.toLowerCase();
}

/** Decode a hex payload to bytes. */
export function hexToBytes(value, label = "payload") {
  return Buffer.from(normalizeHex(value, label), "hex");
}

function toBytes(hex) {
  return Buffer.from(hex, "hex");
}

/**
 * Encode a local dust Merkle root the way the chain publishes it: one `73` tag
 * byte followed by the byte-reversed 32-byte little-endian root.
 */
export function encodeMerkleRoot(value) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new DustSeedError("dust Merkle root must be a non-negative bigint");
  }
  const hex = value.toString(16).padStart(64, "0");
  if (hex.length > 64) {
    throw new DustSeedError("dust Merkle root does not fit in 32 bytes");
  }
  return DUST_ROOT_TAG + toBytes(hex).reverse().toString("hex");
}

/** Normalize a chain-published root string for comparison. */
export function normalizeChainRoot(root) {
  if (typeof root !== "string") return "";
  const hex =
    root.startsWith("0x") || root.startsWith("0X") ? root.slice(2) : root;
  return hex.toLowerCase();
}

/** True when a local root value equals a chain-published root string. */
export function rootMatches(localValue, chainRoot) {
  if (typeof localValue !== "bigint") return false;
  const encoded = encodeMerkleRoot(localValue);
  return encoded === normalizeChainRoot(chainRoot);
}

/**
 * Resolve how many leaves the published root trails the reconstructed tree
 * endpoint by, searching the candidate roots from depth 0 (the endpoint) out to
 * `maxLag`. Returns the smallest matching depth, or -1 when nothing matches.
 * `candidates` may be sparse; holes (a collapse state the indexer did not
 * return) are skipped rather than treated as a mismatch.
 */
function resolveRootLag(candidates, chainRoot, maxLag) {
  for (let depth = 0; depth <= maxLag; depth++) {
    if (
      typeof candidates[depth] === "bigint" &&
      rootMatches(candidates[depth], chainRoot)
    ) {
      return depth;
    }
  }
  return -1;
}

/**
 * Normalize the root candidates for one tree. New callers pass an array indexed
 * by depth (`localCommitmentRoots[depth]`); older callers pass the endpoint and
 * one previous state directly.
 */
function normalizeRootCandidates(roots, endpoint, previous, maxLag) {
  const candidates = [];
  if (Array.isArray(roots)) {
    for (let depth = 0; depth <= maxLag; depth++) {
      if (typeof roots[depth] === "bigint") candidates[depth] = roots[depth];
    }
    return candidates;
  }
  if (typeof endpoint === "bigint") candidates[0] = endpoint;
  if (typeof previous === "bigint") candidates[1] = previous;
  return candidates;
}

/**
 * Derive the reconstructed trees' expected leaf counts directly from the
 * deserialized local state (its first-free index is the next leaf to insert).
 * Returns `null` when the state does not expose them, so callers can fall back
 * to the indexer's own end index.
 */
export function localTreeFirstFree(state) {
  if (!(state instanceof ledger.DustLocalState)) return null;
  const text = state.toString();
  const commitment = text.match(/commitment_tree_first_free:\s*(\d+)/);
  const generation = text.match(/generating_tree_first_free:\s*(\d+)/);
  if (!commitment || !generation) return null;
  return {
    commitment: BigInt(commitment[1]),
    generation: BigInt(generation[1]),
  };
}

/**
 * Verify the seeded local roots against the roots the chain publishes. Accepts
 * a match at the collapsed-update endpoint (lag 0) or up to `maxLag` leaves
 * behind it (the published field is known to lag a growing chain), and throws
 * otherwise. A return value means the seed may be trusted; a throw means
 * nothing may be emitted.
 */
export function assertSeedRootsMatch({
  chainCommitmentRoot,
  chainGenerationRoot,
  localCommitmentRoot,
  localGenerationRoot,
  previousCommitmentRoot,
  previousGenerationRoot,
  localCommitmentRoots,
  localGenerationRoots,
  maxLag = 1,
}) {
  const commitmentRoots = normalizeRootCandidates(
    localCommitmentRoots,
    localCommitmentRoot,
    previousCommitmentRoot,
    maxLag,
  );
  const generationRoots = normalizeRootCandidates(
    localGenerationRoots,
    localGenerationRoot,
    previousGenerationRoot,
    maxLag,
  );
  const commitmentLag = resolveRootLag(
    commitmentRoots,
    chainCommitmentRoot,
    maxLag,
  );
  const generationLag = resolveRootLag(
    generationRoots,
    chainGenerationRoot,
    maxLag,
  );
  if (commitmentLag < 0 || generationLag < 0) {
    throw new DustSeedError(
      "DUST root verification failed: the seeded trees do not match the " +
        `published roots (commitmentLag=${commitmentLag} ` +
        `generationLag=${generationLag}, widestSearchedLag=${maxLag}); ` +
        "refusing to emit a snapshot",
    );
  }
  return {
    verified: true,
    commitmentLag,
    generationLag,
    lag: Math.max(commitmentLag, generationLag),
  };
}

let serializationCapability;
let serializationPromise;

/**
 * Load the installed dust-wallet SDK's own v1 serialization capability. The
 * capability module is not re-exported from the package entrypoints, so it is
 * resolved from the package root rather than hard-coding a node_modules path.
 */
async function loadSerializationCapability() {
  if (!serializationCapability) {
    if (!serializationPromise) {
      serializationPromise = (async () => {
        const entry = import.meta.resolve(
          "@midnight-ntwrk/wallet-sdk-dust-wallet",
        );
        const moduleUrl = new URL("v1/Serialization.js", entry).href;
        const mod = await import(moduleUrl);
        return mod.makeDefaultV1SerializationCapability();
      })();
    }
    serializationCapability = await serializationPromise;
  }
  return serializationCapability;
}

/**
 * Encode exactly the snapshot JSON the shipped SDK restores: the same shape as
 * `SnapshotSchema` in the SDK's v1 `Serialization.js`. The state is the
 * serialized `DustLocalState` hex and no secret material is included.
 */
export async function encodeDustSnapshot({
  publicKey,
  state,
  protocolVersion = 0n,
  networkId,
  appliedIndex,
}) {
  if (typeof publicKey !== "bigint") {
    throw new DustSeedError("snapshot requires a dust public key");
  }
  if (!(state instanceof ledger.DustLocalState)) {
    throw new DustSeedError("snapshot requires a DustLocalState");
  }
  if (typeof networkId !== "string" || networkId.length === 0) {
    throw new DustSeedError("snapshot requires a network id");
  }
  if (!isSafeIndex(appliedIndex)) {
    throw new DustSeedError("snapshot requires a safe applied index");
  }
  const capability = await loadSerializationCapability();
  return capability.serialize({
    publicKey: { publicKey },
    state,
    protocolVersion,
    networkId,
    progress: { appliedIndex: BigInt(appliedIndex) },
  });
}

/**
 * Deserialize a snapshot through the installed SDK's own capability. The
 * capability returns an effect `Either`; it is unwrapped here without importing
 * `effect` directly, since the integration package does not declare it.
 */
export async function decodeDustSnapshot(serialized) {
  const capability = await loadSerializationCapability();
  const result = capability.deserialize(undefined, serialized);
  if (result && typeof result === "object" && typeof result._tag === "string") {
    if (result._tag === "Right") return result.right;
    if (result._tag === "Left") {
      throw new DustSeedError(
        `emitted snapshot did not deserialize: ${String(result.left).slice(0, 200)}`,
      );
    }
  }
  return result;
}

function dustParameters() {
  return ledger.LedgerParameters.initialParameters().dust;
}

function emptyLocalState() {
  return new ledger.DustLocalState(dustParameters());
}

function deserializeCollapsedUpdate(hex, label) {
  try {
    return ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(
      hexToBytes(hex, label),
    );
  } catch (error) {
    throw new DustSeedError(
      `${label} could not be deserialized as a collapsed update: ${error.message}`,
    );
  }
}

/**
 * Apply a collapsed commitment update and/or a collapsed generation update to a
 * fresh local state. Both payloads are hex. Returns the local state.
 */
export function applyCollapsedUpdates({
  commitmentUpdate,
  generationUpdate,
  base,
} = {}) {
  let state = base ?? emptyLocalState();
  if (commitmentUpdate !== undefined) {
    state = state.applyCommitmentCollapsedUpdate(
      deserializeCollapsedUpdate(commitmentUpdate, "commitment update"),
    );
  }
  if (generationUpdate !== undefined) {
    state = state.applyGenerationCollapsedUpdate(
      deserializeCollapsedUpdate(generationUpdate, "generation update"),
    );
  }
  return state;
}

/**
 * Bounded linearity guard for the tail that advances a seeded snapshot.
 *
 * The SDK's sync loop resumes from `offset - 1` and applies every event with
 * `id > offset`. That resume is linear only when the events applied to build the
 * tree are exactly the events with `id <= offset`. This applies the fresh tail
 * events in one bounded ledger call and:
 *
 *   * refuses a non-contiguous tail (a gap would make the offset skip events);
 *   * surfaces the ledger's own non-linear-insertion error as a `DustSeedError`
 *     naming the offset, instead of letting a restoring wallet retry forever.
 *
 * `events` entries are `{ id, event }` where `event` is a deserialized
 * `ledger.Event`. Returns `{ state, appliedEvents, lastAppliedEventId }`.
 */
export function applyTailEventsLinear({
  state,
  publicKey,
  appliedIndex,
  events,
  secretKey,
  networkId,
  protocolVersion = 0n,
  timestamp,
} = {}) {
  if (!(state instanceof ledger.DustLocalState)) {
    throw new DustSeedError("tail replay requires a DustLocalState");
  }
  const offset = BigInt(appliedIndex);
  const entries = (events ?? [])
    .map((entry) => ({ id: BigInt(entry.id), event: entry.event }))
    .filter((entry) => entry.id > offset)
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  let expected = offset + 1n;
  for (const entry of entries) {
    if (entry.id !== expected) {
      throw new DustSeedError(
        `dust tail is not contiguous at offset ${appliedIndex}: expected ` +
          `event id ${expected} next but received ${entry.id}; refusing to ` +
          "emit a snapshot whose offset would skip events",
      );
    }
    expected += 1n;
  }
  if (entries.length === 0) {
    return { state, appliedEvents: 0, lastAppliedEventId: Number(offset) };
  }
  let updated;
  try {
    const wallet = {
      state,
      publicKey: { publicKey },
      networkId,
      pendingDust: [],
      protocolVersion,
      progress: { appliedIndex: offset },
    };
    [updated] = CoreWallet.applyEventsWithChanges(
      wallet,
      secretKey,
      entries.map((entry) => entry.event),
      timestamp instanceof Date ? timestamp : new Date(timestamp ?? Date.now()),
    );
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/non-linearly into dust/.test(message)) {
      throw new DustSeedError(
        `dust sync offset ${appliedIndex} is inconsistent with the seeded ` +
          `trees (${message}); refusing to emit a snapshot that would make a ` +
          "restoring wallet retry forever",
      );
    }
    throw new DustSeedError(
      `tail events could not be applied at offset ${appliedIndex}: ${message}`,
    );
  }
  return {
    state: updated.state,
    appliedEvents: entries.length,
    lastAppliedEventId: Number(entries[entries.length - 1].id),
  };
}

function defaultRequest(config) {
  return async function request(query, timeoutMs = config.requestTimeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(config.indexerHttp, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new DustSeedError(
        `indexer request failed: ${error?.message ?? error}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new DustSeedError(
        `indexer request failed with HTTP ${response.status}`,
      );
    }
    const body = await response.json();
    if (body?.errors) {
      throw new DustSeedError(
        `indexer GraphQL error: ${JSON.stringify(body.errors).slice(0, 240)}`,
      );
    }
    if (!body?.data) {
      throw new DustSeedError("indexer returned no data");
    }
    return body.data;
  };
}

function requireSafeIndex(value, label) {
  if (!isSafeIndex(value)) {
    throw new DustSeedError(`indexer returned an invalid ${label}`);
  }
  return value;
}

/** The light read used only to observe the published tip while it settles. */
const TIP_QUERY =
  "{ block(offset:null){ height dustCommitmentEndIndex dustGenerationEndIndex dustCommitmentMerkleTreeRoot dustGenerationMerkleTreeRoot } }";

/** True when two tip reads describe the same published dust state. */
function sameDustTip(previous, current) {
  if (!previous || !current) return false;
  if (previous.dustCommitmentEndIndex !== current.dustCommitmentEndIndex) {
    return false;
  }
  if (previous.dustGenerationEndIndex !== current.dustGenerationEndIndex) {
    return false;
  }
  for (const field of [
    "dustCommitmentMerkleTreeRoot",
    "dustGenerationMerkleTreeRoot",
  ]) {
    const before = previous[field];
    const after = current[field];
    if (before !== undefined && after !== undefined && before !== after) {
      return false;
    }
  }
  return true;
}

async function readTip(request) {
  const data = await request(TIP_QUERY);
  const block = data?.block;
  if (!block) throw new DustSeedError("indexer returned no tip block");
  return block;
}

/**
 * Wait for the published tip to be stable across `stabiliseReads` consecutive
 * reads, so verification never compares against a moving target. Returns the
 * settled tip. A tip that keeps moving past `budgetMs` is refused rather than
 * chased, with the last observed values and how long it waited.
 */
async function stabiliseTip(
  config,
  request,
  ctx,
  budgetMs = config.stabiliseMs,
) {
  const limit = Math.max(0, Math.min(budgetMs, config.stabiliseMs));
  const started = ctx.now();
  const required = Math.max(1, config.stabiliseReads);
  let previous = null;
  let repeats = 0;
  let reads = 0;
  let last = null;
  while (ctx.now() - started <= limit) {
    ctx.check("stabilise");
    const tip = await readTip(request);
    reads += 1;
    last = tip;
    if (previous && sameDustTip(previous, tip)) {
      repeats += 1;
      if (repeats >= required - 1) {
        const waitedMs = ctx.now() - started;
        ctx.emit("dust-seed-root-stable", {
          reads,
          waitedMs,
          height: tip.height,
          commitmentEndExclusive: tip.dustCommitmentEndIndex,
          generationEndExclusive: tip.dustGenerationEndIndex,
          chainCommitmentRoot: tip.dustCommitmentMerkleTreeRoot,
          chainGenerationRoot: tip.dustGenerationMerkleTreeRoot,
        });
        return { tip, waitedMs, reads };
      }
    } else {
      repeats = 0;
    }
    previous = tip;
    if (ctx.now() - started + config.stabilisePollMs > limit) break;
    await new Promise((resolve) => setTimeout(resolve, config.stabilisePollMs));
  }
  throw new DustSeedError(
    `DUST published tip did not stabilise within ${limit}ms (${reads} ` +
      `reads, last height=${last?.height} ` +
      `commitmentEndExclusive=${last?.dustCommitmentEndIndex} ` +
      `generationEndExclusive=${last?.dustGenerationEndIndex}, ` +
      `chainCommitmentRoot=${last?.dustCommitmentMerkleTreeRoot}); ` +
      "the indexer kept moving the commitment root, so refusing to verify " +
      "against a moving target",
  );
}

/**
 * Build the single pinned request. It carries the block, the endpoint collapsed
 * updates, the previous `maxLag` collapse states, and a batch of recent blocks'
 * dust events. Everything in one request belongs to one indexer state, so the
 * root comparison and the tail boundary cannot straddle two tree states.
 */
function buildPinnedQuery(target, maxLag, batchHeights) {
  const commitmentEnd = target.dustCommitmentEndIndex - 1;
  const generationEnd = target.dustGenerationEndIndex - 1;
  const parts = [
    `block(offset:null){
      height
      dustCommitmentEndIndex
      dustGenerationEndIndex
      dustCommitmentMerkleTreeRoot
      dustGenerationMerkleTreeRoot
    }`,
    `c:dustCommitmentMerkleTreeUpdate(startIndex:0,endIndex:${commitmentEnd}){ endIndex update }`,
    `g:dustGenerationMerkleTreeUpdate(startIndex:0,endIndex:${generationEnd}){ endIndex update }`,
  ];
  for (let depth = 1; depth <= maxLag; depth++) {
    if (commitmentEnd - depth >= 0) {
      parts.push(
        `cp${depth}:dustCommitmentMerkleTreeUpdate(startIndex:0,endIndex:${commitmentEnd - depth}){ endIndex update }`,
      );
    }
    if (generationEnd - depth >= 0) {
      parts.push(
        `gp${depth}:dustGenerationMerkleTreeUpdate(startIndex:0,endIndex:${generationEnd - depth}){ endIndex update }`,
      );
    }
  }
  batchHeights.forEach((blockHeight, index) => {
    parts.push(
      `b${index}: block(offset:{height:${blockHeight}}){ height transactions { id dustLedgerEvents { id } } }`,
    );
  });
  return `{ ${parts.join("\n")} }`;
}

/** Highest dust event id carried by the recent-block batch of a pinned read. */
function cutoffFromPinnedBatch(data, batchHeights) {
  let maxId = -1;
  let foundAt = -1;
  for (let index = 0; index < batchHeights.length; index++) {
    const entry = data?.[`b${index}`];
    if (!entry || !Array.isArray(entry.transactions)) continue;
    for (const transaction of entry.transactions) {
      for (const event of transaction?.dustLedgerEvents ?? []) {
        if (Number.isSafeInteger(event?.id) && event.id > maxId) {
          maxId = event.id;
          foundAt = requireSafeIndex(entry.height, "block height");
        }
      }
    }
  }
  return maxId >= 0
    ? {
        cutoffEventId: maxId,
        cutoffHeight: foundAt,
        scannedBlocks: batchHeights.length,
        source: "pinned",
      }
    : null;
}

/**
 * Stabilise the published tip, then fetch the block, both collapsed updates,
 * the previous `maxLag` collapse states and a batch of recent dust events in one
 * request and verify the seeded roots. Re-pins while the tip moves, and aborts
 * with the observed lag once `maxLag` is exceeded.
 */
async function pinAndVerify(config, request, ctx) {
  let stabiliseUsedMs = 0;
  let target;
  let commitmentEndExclusive;
  let generationEndExclusive;
  let batchHeights = [];
  let lastStabilise = null;

  const repin = async () => {
    const budget = Math.max(0, config.stabiliseMs - stabiliseUsedMs);
    const stabilised = await stabiliseTip(config, request, ctx, budget);
    stabiliseUsedMs += stabilised.waitedMs + config.stabilisePollMs;
    lastStabilise = stabilised;
    target = stabilised.tip;
    commitmentEndExclusive = requireSafeIndex(
      target.dustCommitmentEndIndex,
      "dust commitment end index",
    );
    generationEndExclusive = requireSafeIndex(
      target.dustGenerationEndIndex,
      "dust generation end index",
    );
    if (commitmentEndExclusive < 1 || generationEndExclusive < 1) {
      throw new DustSeedError("dust trees are empty; nothing to seed");
    }
    batchHeights = [];
    for (let index = 0; index < config.scanBatchSize; index++) {
      const blockHeight = target.height - index;
      if (blockHeight < 1) break;
      batchHeights.push(blockHeight);
    }
    return stabilised;
  };

  await repin();
  let lastError;
  let best;
  let attempts = 0;
  for (let attempt = 1; attempt <= config.pinAttempts; attempt++) {
    ctx.check("pin");
    const data = await request(
      buildPinnedQuery(target, config.maxLag, batchHeights),
    );
    const pinned = data?.block;
    if (!pinned) throw new DustSeedError("indexer returned no block");
    const pinnedCommitmentEnd = requireSafeIndex(
      pinned.dustCommitmentEndIndex,
      "dust commitment end index",
    );
    const pinnedGenerationEnd = requireSafeIndex(
      pinned.dustGenerationEndIndex,
      "dust generation end index",
    );
    if (
      pinnedCommitmentEnd !== commitmentEndExclusive ||
      pinnedGenerationEnd !== generationEndExclusive
    ) {
      ctx.emit("dust-seed-tip-moved", {
        attempt,
        commitmentEndExclusive: pinnedCommitmentEnd,
        generationEndExclusive: pinnedGenerationEnd,
      });
      lastError = new DustSeedError(
        "the indexer tip advanced between the stabilised read and the pinned " +
          "read; refusing to compare across two tree states",
      );
      // The stabilised target moved; settle again (bounded) rather than chase.
      await repin();
      continue;
    }
    attempts = attempt;
    const commitmentPayloadHex = normalizeHex(
      data.c?.update,
      "commitment update",
    );
    const generationPayloadHex = normalizeHex(
      data.g?.update,
      "generation update",
    );
    // The collapsed updates and the block end index are from this same response,
    // so the expected leaf count is derived from one tree state. The block's end
    // index is exclusive and the collapsed-update end index is inclusive, hence
    // the requested range ends one index lower.
    if (
      Number(data.c?.endIndex) !== commitmentEndExclusive - 1 ||
      Number(data.g?.endIndex) !== generationEndExclusive - 1
    ) {
      throw new DustSeedError(
        "the collapsed updates do not cover the pinned block's dust end index " +
          `(update endIndex=${data.c?.endIndex}/${data.g?.endIndex}, block ` +
          `endIndex=${commitmentEndExclusive - 1}/${generationEndExclusive - 1}); ` +
          "refusing to compare across two tree states",
      );
    }

    let current;
    const localCommitmentRoots = [];
    const localGenerationRoots = [];
    try {
      current = applyCollapsedUpdates({
        commitmentUpdate: commitmentPayloadHex,
        generationUpdate: generationPayloadHex,
      });
      localCommitmentRoots[0] = current.commitmentTreeRoot();
      localGenerationRoots[0] = current.generatingTreeRoot();
      for (let depth = 1; depth <= config.maxLag; depth++) {
        const commitmentDepthHex = data?.[`cp${depth}`]?.update;
        if (commitmentDepthHex) {
          localCommitmentRoots[depth] = applyCollapsedUpdates({
            commitmentUpdate: normalizeHex(
              commitmentDepthHex,
              `previous commitment update ${depth}`,
            ),
          }).commitmentTreeRoot();
        }
        const generationDepthHex = data?.[`gp${depth}`]?.update;
        if (generationDepthHex) {
          localGenerationRoots[depth] = applyCollapsedUpdates({
            generationUpdate: normalizeHex(
              generationDepthHex,
              `previous generation update ${depth}`,
            ),
          }).generatingTreeRoot();
        }
      }
    } catch (error) {
      if (error instanceof DustSeedError) throw error;
      throw new DustSeedError(
        `collapsed update could not be applied: ${error.message}`,
      );
    }

    // Cross-check the reconstructed trees' own leaf counts against the block's
    // end index from the same response. This is the "expected leaf count" check
    // and it catches a payload whose range does not match its block.
    const firstFree = localTreeFirstFree(current);
    if (
      firstFree &&
      (firstFree.commitment !== BigInt(commitmentEndExclusive) ||
        firstFree.generation !== BigInt(generationEndExclusive))
    ) {
      throw new DustSeedError(
        `the collapsed updates reconstruct a tree of ` +
          `${firstFree.commitment}/${firstFree.generation} leaves but the ` +
          `pinned block publishes ${commitmentEndExclusive}/` +
          `${generationEndExclusive}; refusing to compare across two tree states`,
      );
    }

    try {
      const verification = assertSeedRootsMatch({
        chainCommitmentRoot: pinned.dustCommitmentMerkleTreeRoot,
        chainGenerationRoot: pinned.dustGenerationMerkleTreeRoot,
        localCommitmentRoots,
        localGenerationRoots,
        maxLag: config.maxLag,
      });
      const candidate = {
        height: pinned.height,
        commitmentEndExclusive,
        generationEndExclusive,
        commitmentEnd: commitmentEndExclusive - 1,
        generationEnd: generationEndExclusive - 1,
        chainCommitmentRoot: pinned.dustCommitmentMerkleTreeRoot,
        chainGenerationRoot: pinned.dustGenerationMerkleTreeRoot,
        localCommitmentRoot: localCommitmentRoots[0],
        localGenerationRoot: localGenerationRoots[0],
        commitmentUpdate: commitmentPayloadHex,
        generationUpdate: generationPayloadHex,
        commitmentPayloadBytes: toBytes(commitmentPayloadHex).length,
        generationPayloadBytes: toBytes(generationPayloadHex).length,
        verification,
        attempts,
        batchHeights,
        batchCutoff: cutoffFromPinnedBatch(data, batchHeights),
        stabiliseWaitedMs: lastStabilise?.waitedMs ?? 0,
        stabiliseReads: lastStabilise?.reads ?? 0,
      };
      // Prefer an exact (lag 0) match. A lagged match is still usable and is
      // recorded, but only if no later attempt pins an exact one.
      if (verification.lag === 0) return candidate;
      if (!best || verification.lag < best.verification.lag) best = candidate;
      ctx.emit("dust-seed-root-lagged", {
        attempt,
        height: pinned.height,
        lag: verification.lag,
        commitmentLag: verification.commitmentLag,
        generationLag: verification.generationLag,
        maxLag: config.maxLag,
      });
    } catch (error) {
      lastError = error;
      ctx.emit("dust-seed-root-mismatch", {
        attempt,
        height: pinned.height,
        chainCommitmentRoot: pinned.dustCommitmentMerkleTreeRoot,
        localCommitmentRoot: encodeMerkleRoot(localCommitmentRoots[0]),
        chainGenerationRoot: pinned.dustGenerationMerkleTreeRoot,
        localGenerationRoot: encodeMerkleRoot(localGenerationRoots[0]),
        maxLag: config.maxLag,
      });
    }
    // A lagged or mismatched published field usually catches up within a few
    // hundred milliseconds once the chain is quiet. Give it that time before
    // the next (bounded) attempt instead of re-reading back to back.
    if (attempt < config.pinAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, config.stabilisePollMs),
      );
    }
  }
  if (best) return best;
  throw (
    lastError ?? new DustSeedError("could not pin a verifiable dust tree state")
  );
}

/**
 * Find the highest dust ledger event id reflected by the pinned block. When the
 * pinned request's own recent-block batch carried dust events, that boundary is
 * used directly, so the cursor is pinned to the same indexer state as the trees.
 * Otherwise it scans blocks downward from below the batch until one carries dust
 * events. This anchors the tail cursor to the same state the trees were seeded
 * at, so no covered event is replayed and no uncovered event is skipped.
 */
async function findCutoffEventId(config, request, ctx, pinned) {
  if (pinned.batchCutoff) {
    ctx.emit("dust-seed-cutoff-found", {
      cutoffEventId: pinned.batchCutoff.cutoffEventId,
      foundAtHeight: pinned.batchCutoff.cutoffHeight,
      scannedBlocks: pinned.batchCutoff.scannedBlocks,
      source: pinned.batchCutoff.source,
    });
    return { ...pinned.batchCutoff };
  }
  const batchHeight = pinned.height - pinned.batchHeights.length;
  let scanned = pinned.batchHeights.length;
  let cursor = batchHeight + 1;
  while (scanned < config.maxScanBlocks) {
    ctx.check("scan");
    const heights = [];
    for (
      let index = 0;
      index < config.scanBatchSize && scanned + index < config.maxScanBlocks;
      index++
    ) {
      const candidate = cursor - index;
      if (candidate < 1) break;
      heights.push(candidate);
    }
    if (heights.length === 0) break;
    const query = `{
      ${heights
        .map(
          (h, index) =>
            `b${index}: block(offset:{height:${h}}){ height transactions { id dustLedgerEvents { id } } }`,
        )
        .join("\n")}
    }`;
    const data = await request(query);
    let maxId = -1;
    let foundAt = -1;
    for (const key of Object.keys(data)) {
      const entry = data[key];
      if (!entry || !Array.isArray(entry.transactions)) continue;
      for (const transaction of entry.transactions) {
        for (const event of transaction?.dustLedgerEvents ?? []) {
          if (Number.isSafeInteger(event?.id) && event.id > maxId) {
            maxId = event.id;
            foundAt = requireSafeIndex(entry.height, "block height");
          }
        }
      }
    }
    if (maxId >= 0) {
      ctx.emit("dust-seed-cutoff-found", {
        cutoffEventId: maxId,
        foundAtHeight: foundAt,
        scannedBlocks: scanned + heights.length,
        source: "scan",
      });
      return {
        cutoffEventId: maxId,
        cutoffHeight: foundAt,
        scannedBlocks: scanned + heights.length,
        source: "scan",
      };
    }
    scanned += heights.length;
    cursor -= heights.length;
  }
  throw new DustSeedError(
    `no dust ledger events found within ${config.maxScanBlocks} blocks of ` +
      "the pinned height; refusing to guess the tail cursor",
  );
}

/**
 * Subscribe to the dust ledger event stream from `tailStartId` and collect the
 * bounded tail. The subscription is inclusive at the cursor; the caller filters
 * to `id > cutoff`.
 */
async function collectTailEvents(config, ctx, tailStartId, deadline) {
  const { WebSocket } = await import("ws");
  const events = [];
  let highestSeen = tailStartId - 1;
  const listenMs = Math.max(0, Math.min(config.tailMs, deadline - ctx.now()));
  if (listenMs <= 0) {
    return { events, maxId: highestSeen, timedOut: true };
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let quietTimer;
    let hardTimer;
    let socket;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      try {
        socket?.close();
      } catch {
        // Closing a socket that already failed is not an error.
      }
      if (error) reject(error);
      else resolve({ events, maxId: highestSeen, timedOut: false });
    };
    const bumpQuiet = () => {
      clearTimeout(quietTimer);
      if (events.length > 0) {
        quietTimer = setTimeout(() => finish(), config.tailQuietMs);
      }
    };
    try {
      socket = new WebSocket(config.indexerWs, "graphql-transport-ws");
    } catch (error) {
      reject(
        new DustSeedError(`websocket could not be opened: ${error.message}`),
      );
      return;
    }
    hardTimer = setTimeout(() => finish(), listenMs);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "connection_init" }));
    });
    socket.on("message", (buffer) => {
      let message;
      try {
        message = JSON.parse(buffer.toString());
      } catch {
        return;
      }
      if (message.type === "connection_ack") {
        socket.send(
          JSON.stringify({
            id: "dust-seed-tail",
            type: "subscribe",
            payload: {
              query:
                "subscription DustSeedTail($id:Int){ dustLedgerEvents(id:$id){ id raw maxId } }",
              variables: { id: tailStartId },
            },
          }),
        );
        return;
      }
      if (message.type === "error") {
        finish(
          new DustSeedError(
            `indexer subscription error: ${JSON.stringify(message).slice(0, 200)}`,
          ),
        );
        return;
      }
      if (message.type !== "next") return;
      const event = message.payload?.data?.dustLedgerEvents;
      if (!event) return;
      if (Number.isSafeInteger(event.maxId) && event.maxId > highestSeen) {
        highestSeen = event.maxId;
      }
      const id = Number(event.id);
      if (
        Number.isSafeInteger(id) &&
        id >= tailStartId &&
        events.length < config.maxTailEvents &&
        typeof event.raw === "string"
      ) {
        events.push({ id, raw: event.raw });
        ctx.emit("dust-seed-tail-event", { id });
      }
      bumpQuiet();
      if (events.length >= config.maxTailEvents) finish();
    });
    socket.on("error", (error) => {
      finish(new DustSeedError(`indexer websocket error: ${error.message}`));
    });
    socket.on("close", () => finish());
  });
}

/**
 * Seed the dust trees from collapsed updates and replay the bounded tail.
 *
 * Returns `{ snapshot, state, receipt, verification }`. Throws a
 * `DustSeedError` (or `DustSeedTimeoutError`) without emitting anything when
 * verification fails, the cursor cannot be anchored, or the deadline passes.
 *
 * @param {object} options
 * @param {import("@midnight-ntwrk/ledger-v8").DustSecretKey} [options.secretKey]
 *   In-memory dust secret key used only to replay the tail and to derive the
 *   public key. Never serialized. If omitted, `publicKey` must be supplied and
 *   the tail is left for the restored wallet to replay.
 * @param {bigint} [options.publicKey] Dust public key, when no secret key given.
 * @param {(event: string, fields?: object) => void} [options.emit] Progress sink.
 */
export async function seedDustState(options = {}) {
  const config = { ...DUST_SEED_DEFAULTS, ...options };
  const emit = options.emit ?? (() => {});
  const clock = options.now ?? Date.now;
  const startedAt = clock();
  const deadline = startedAt + config.deadlineMs;
  const request = options.request ?? defaultRequest(config);

  const ctx = {
    now: clock,
    emit,
    check(stage) {
      if (clock() >= deadline) {
        throw new DustSeedTimeoutError(
          `dust seeding deadline reached during ${stage}`,
        );
      }
    },
  };

  const pinned = await pinAndVerify(config, request, ctx);
  emit("dust-seed-roots-verified", {
    height: pinned.height,
    lag: pinned.verification.lag,
    commitmentLag: pinned.verification.commitmentLag,
    generationLag: pinned.verification.generationLag,
    maxLag: config.maxLag,
    stabiliseWaitedMs: pinned.stabiliseWaitedMs,
    stabiliseReads: pinned.stabiliseReads,
  });

  ctx.check("cutoff");
  const cutoff = await findCutoffEventId(config, request, ctx, pinned);
  const tailStartId = cutoff.cutoffEventId + 1;

  let state = applyCollapsedUpdates({
    commitmentUpdate: pinned.commitmentUpdate,
    generationUpdate: pinned.generationUpdate,
  });
  let lastAppliedEventId = cutoff.cutoffEventId;
  let tailEventsApplied = 0;
  let tailSkippedReason = null;
  let highestPublishedId = cutoff.cutoffEventId;

  const publicKey =
    typeof config.secretKey?.publicKey === "bigint"
      ? config.secretKey.publicKey
      : config.publicKey;

  if (typeof config.secretKey === "undefined") {
    tailSkippedReason = "no-secret-key-supplied";
  } else {
    ctx.check("tail");
    const tail = await collectTailEvents(config, ctx, tailStartId, deadline);
    highestPublishedId = Math.max(highestPublishedId, tail.maxId);
    const ordered = tail.events
      .filter((event) => event.id > lastAppliedEventId)
      .sort((left, right) => left.id - right.id);
    if (ordered.length > 0) {
      let ledgerEvents;
      try {
        ledgerEvents = ordered.map((event) =>
          ledger.Event.deserialize(hexToBytes(event.raw, "dust event")),
        );
      } catch (error) {
        throw new DustSeedError(
          `tail event could not be deserialized: ${error.message}`,
        );
      }
      // Bounded, contiguity-checked apply: a wrong offset (a gap, a skip, or an
      // already-covered event) surfaces the ledger's non-linear-insertion error
      // here instead of hanging a restoring wallet's sync loop.
      const tailResult = applyTailEventsLinear({
        state,
        publicKey,
        appliedIndex: lastAppliedEventId,
        events: ordered.map((event, index) => ({
          id: event.id,
          event: ledgerEvents[index],
        })),
        secretKey: config.secretKey,
        networkId: config.networkId,
        protocolVersion: config.protocolVersion,
        timestamp: new Date(clock()),
      });
      state = tailResult.state;
      lastAppliedEventId = tailResult.lastAppliedEventId;
      tailEventsApplied = tailResult.appliedEvents;
    }
  }

  if (typeof publicKey !== "bigint") {
    throw new DustSeedError(
      "a dust public key (or secret key) is required to emit a snapshot",
    );
  }

  const snapshot = await encodeDustSnapshot({
    publicKey,
    state,
    protocolVersion: config.protocolVersion,
    networkId: config.networkId,
    appliedIndex: lastAppliedEventId,
  });

  // Round-trip through the SDK's own capability before claiming success.
  const restored = await decodeDustSnapshot(snapshot);
  if (!(restored.state instanceof ledger.DustLocalState)) {
    throw new DustSeedError(
      "emitted snapshot did not restore a DustLocalState",
    );
  }
  if (restored.publicKey?.publicKey !== publicKey) {
    throw new DustSeedError("emitted snapshot restored the wrong public key");
  }
  if (
    BigInt(restored.progress?.appliedIndex ?? -1n) !==
    BigInt(lastAppliedEventId)
  ) {
    throw new DustSeedError(
      "emitted snapshot restored the wrong applied index",
    );
  }
  if (restored.state.commitmentTreeRoot() !== state.commitmentTreeRoot()) {
    throw new DustSeedError(
      "emitted snapshot restored a different commitment root",
    );
  }
  if (restored.state.generatingTreeRoot() !== state.generatingTreeRoot()) {
    throw new DustSeedError(
      "emitted snapshot restored a different generation root",
    );
  }

  const elapsedMs = clock() - startedAt;
  const receipt = {
    indexerHttp: config.indexerHttp,
    networkId: config.networkId,
    blockHeight: pinned.height,
    matchedHeight: pinned.height,
    commitmentEndIndexExclusive: pinned.commitmentEndExclusive,
    generationEndIndexExclusive: pinned.generationEndExclusive,
    requestedCommitmentEndIndex: pinned.commitmentEnd,
    requestedGenerationEndIndex: pinned.generationEnd,
    chainCommitmentRoot: pinned.chainCommitmentRoot,
    localCommitmentRoot: encodeMerkleRoot(pinned.localCommitmentRoot),
    chainGenerationRoot: pinned.chainGenerationRoot,
    localGenerationRoot: encodeMerkleRoot(pinned.localGenerationRoot),
    // The roots the EMITTED snapshot actually contains. The tail replay above runs after
    // the verification point and may insert leaves, so a consumer that compares a restored
    // snapshot against localCommitmentRoot/localGenerationRoot would compare two different
    // tree states and refuse a valid snapshot. Those two stay the verification evidence;
    // these two are the post-tail values a round-trip check must match.
    finalCommitmentRoot: encodeMerkleRoot(state.commitmentTreeRoot()),
    finalGenerationRoot: encodeMerkleRoot(state.generatingTreeRoot()),
    lag: pinned.verification.lag,
    commitmentLag: pinned.verification.commitmentLag,
    generationLag: pinned.verification.generationLag,
    maxLag: config.maxLag,
    pinAttempts: pinned.attempts,
    stabiliseWaitedMs: pinned.stabiliseWaitedMs,
    stabiliseReads: pinned.stabiliseReads,
    commitmentPayloadBytes: pinned.commitmentPayloadBytes,
    generationPayloadBytes: pinned.generationPayloadBytes,
    scannedBlocks: cutoff.scannedBlocks,
    cutoffSource: cutoff.source,
    cutoffEventId: cutoff.cutoffEventId,
    cutoffHeight: cutoff.cutoffHeight,
    tailStartEventId: tailStartId,
    highestPublishedEventId: highestPublishedId,
    lastAppliedEventId,
    tailEventsApplied,
    tailSkippedReason,
    snapshotBytes: Buffer.byteLength(snapshot, "utf8"),
    elapsedMs,
  };
  emit("dust-seed-complete", {
    height: receipt.blockHeight,
    lag: receipt.lag,
    lastAppliedEventId,
    tailEventsApplied,
    elapsedMs,
  });
  return {
    snapshot,
    state,
    receipt,
    verification: pinned.verification,
  };
}
