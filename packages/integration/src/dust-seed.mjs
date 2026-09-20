// DUST start-late seeder for Midnight Preprod.
//
// A fresh wallet normally replays the entire dust ledger event history
// (currently ~1.3 to 1.54 million events on Preprod) before it can hold a
// usable DUST tree. This module seeds the two dust Merkle trees directly from
// the indexer's collapsed updates, verifies the seeded roots against the roots
// the chain publishes, and only then replays the post-seed tail.
//
// Safety posture (fail closed):
//   * the block and both collapsed updates are fetched in a single pinned
//     indexer request, so the roots compared belong to the same indexer state;
//   * verification accepts a match at lag 0 or lag 1 (the published root can
//     trail the collapsed-update endpoint by one state) and aborts on anything
//     wider;
//   * nothing is emitted unless both roots verify, the tail cursor is anchored
//     to the pinned block, and the produced snapshot round-trips through the
//     shipped SDK's own serialization capability;
//   * the seeder is read-only: it never signs, never submits, and never writes
//     to the chain. No secret material (no seed, no secret key) is ever
//     serialized, logged, or returned.
//
// The tail cursor matters: the collapsed trees cover every dust event up to the
// pinned block, and replaying one of those covered events is not idempotent
// (the ledger throws "values inserted non-linearly into dust commitment tree").
// The cursor is therefore derived from the pinned block itself, never guessed.

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
  // How many times to re-pin the tip before giving up on a root match.
  pinAttempts: 3,
  // Widest accepted root lag, in collapse states. Wider MUST abort.
  maxLag: 1,
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

function resolveLag(currentRoot, previousRoot, chainRoot, maxLag) {
  if (rootMatches(currentRoot, chainRoot)) return 0;
  if (
    maxLag >= 1 &&
    typeof previousRoot === "bigint" &&
    rootMatches(previousRoot, chainRoot)
  ) {
    return 1;
  }
  return -1;
}

/**
 * Verify the seeded local roots against the roots the chain publishes. Accepts
 * a match at the collapsed-update endpoint (lag 0) or one collapse state behind
 * it (lag 1, when the published field trails), and throws otherwise. A return
 * value means the seed may be trusted; a throw means nothing may be emitted.
 */
export function assertSeedRootsMatch({
  chainCommitmentRoot,
  chainGenerationRoot,
  localCommitmentRoot,
  localGenerationRoot,
  previousCommitmentRoot,
  previousGenerationRoot,
  maxLag = 1,
}) {
  const commitmentLag = resolveLag(
    localCommitmentRoot,
    previousCommitmentRoot,
    chainCommitmentRoot,
    maxLag,
  );
  const generationLag = resolveLag(
    localGenerationRoot,
    previousGenerationRoot,
    chainGenerationRoot,
    maxLag,
  );
  if (commitmentLag < 0 || generationLag < 0) {
    throw new DustSeedError(
      "DUST root verification failed: the seeded trees do not match the " +
        `published roots (commitmentLag=${commitmentLag} ` +
        `generationLag=${generationLag}); refusing to emit a snapshot`,
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

/**
 * Pin the tip block and both collapsed updates in one indexer request and
 * verify the seeded roots. Retries the pin while the tip moves or the roots
 * transiently disagree, and aborts after `maxLag` is exceeded.
 */
async function pinAndVerify(config, request, ctx) {
  let lastError;
  let best;
  for (let attempt = 1; attempt <= config.pinAttempts; attempt++) {
    ctx.check("pin");
    const tip = await request(
      "{ block(offset:null){ height dustCommitmentEndIndex dustGenerationEndIndex } }",
    );
    const block = tip?.block;
    const height = requireSafeIndex(block?.height, "block height");
    const commitmentEndExclusive = requireSafeIndex(
      block?.dustCommitmentEndIndex,
      "dust commitment end index",
    );
    const generationEndExclusive = requireSafeIndex(
      block?.dustGenerationEndIndex,
      "dust generation end index",
    );
    if (commitmentEndExclusive < 1 || generationEndExclusive < 1) {
      throw new DustSeedError("dust trees are empty; nothing to seed");
    }
    // The block end indices are exclusive and the collapsed-update end index is
    // inclusive, so the range ends one index lower. The exact tip end index is
    // rejected by the indexer ("attempted update on updated sub-tree").
    const commitmentEnd = commitmentEndExclusive - 1;
    const generationEnd = generationEndExclusive - 1;
    const commitmentPrev = commitmentEnd - 1;
    const generationPrev = generationEnd - 1;

    const previousCommitment =
      commitmentPrev >= 0
        ? `cp:dustCommitmentMerkleTreeUpdate(startIndex:0,endIndex:${commitmentPrev}){ endIndex update }`
        : "";
    const previousGeneration =
      generationPrev >= 0
        ? `gp:dustGenerationMerkleTreeUpdate(startIndex:0,endIndex:${generationPrev}){ endIndex update }`
        : "";

    const query = `{
      block(offset:null){
        height
        dustCommitmentEndIndex
        dustGenerationEndIndex
        dustCommitmentMerkleTreeRoot
        dustGenerationMerkleTreeRoot
      }
      c:dustCommitmentMerkleTreeUpdate(startIndex:0,endIndex:${commitmentEnd}){ endIndex update }
      g:dustGenerationMerkleTreeUpdate(startIndex:0,endIndex:${generationEnd}){ endIndex update }
      ${previousCommitment}
      ${previousGeneration}
    }`;

    const data = await request(query);
    const pinned = data?.block;
    if (!pinned) {
      throw new DustSeedError("indexer returned no block");
    }
    // If the tip advanced between the two reads, retry with the newer state.
    if (
      pinned.dustCommitmentEndIndex !== commitmentEndExclusive ||
      pinned.dustGenerationEndIndex !== generationEndExclusive
    ) {
      ctx.emit("dust-seed-tip-moved", { attempt });
      continue;
    }
    const commitmentPayloadHex = normalizeHex(
      data.c?.update,
      "commitment update",
    );
    const generationPayloadHex = normalizeHex(
      data.g?.update,
      "generation update",
    );

    let localCommitmentRoot;
    let localGenerationRoot;
    let previousCommitmentRoot;
    let previousGenerationRoot;
    try {
      const current = applyCollapsedUpdates({
        commitmentUpdate: commitmentPayloadHex,
        generationUpdate: generationPayloadHex,
      });
      localCommitmentRoot = current.commitmentTreeRoot();
      localGenerationRoot = current.generatingTreeRoot();
      if (data.cp?.update && commitmentPrev >= 0) {
        previousCommitmentRoot = applyCollapsedUpdates({
          commitmentUpdate: normalizeHex(
            data.cp.update,
            "previous commitment update",
          ),
        }).commitmentTreeRoot();
      }
      if (data.gp?.update && generationPrev >= 0) {
        previousGenerationRoot = applyCollapsedUpdates({
          generationUpdate: normalizeHex(
            data.gp.update,
            "previous generation update",
          ),
        }).generatingTreeRoot();
      }
    } catch (error) {
      if (error instanceof DustSeedError) throw error;
      throw new DustSeedError(
        `collapsed update could not be applied: ${error.message}`,
      );
    }

    try {
      const verification = assertSeedRootsMatch({
        chainCommitmentRoot: pinned.dustCommitmentMerkleTreeRoot,
        chainGenerationRoot: pinned.dustGenerationMerkleTreeRoot,
        localCommitmentRoot,
        localGenerationRoot,
        previousCommitmentRoot,
        previousGenerationRoot,
        maxLag: config.maxLag,
      });
      const candidate = {
        height,
        commitmentEndExclusive,
        generationEndExclusive,
        commitmentEnd,
        generationEnd,
        chainCommitmentRoot: pinned.dustCommitmentMerkleTreeRoot,
        chainGenerationRoot: pinned.dustGenerationMerkleTreeRoot,
        localCommitmentRoot,
        localGenerationRoot,
        commitmentUpdate: commitmentPayloadHex,
        generationUpdate: generationPayloadHex,
        commitmentPayloadBytes: toBytes(commitmentPayloadHex).length,
        generationPayloadBytes: toBytes(generationPayloadHex).length,
        verification,
        attempts: attempt,
      };
      // Prefer an exact (lag 0) match. A lagged match is still usable and is
      // recorded, but only if no later attempt pins an exact one.
      if (verification.lag === 0) return candidate;
      if (!best) best = candidate;
      ctx.emit("dust-seed-root-lagged", {
        attempt,
        height,
        lag: verification.lag,
        commitmentLag: verification.commitmentLag,
        generationLag: verification.generationLag,
      });
    } catch (error) {
      lastError = error;
      ctx.emit("dust-seed-root-mismatch", {
        attempt,
        height,
        chainCommitmentRoot: pinned.dustCommitmentMerkleTreeRoot,
        localCommitmentRoot: encodeMerkleRoot(localCommitmentRoot),
        chainGenerationRoot: pinned.dustGenerationMerkleTreeRoot,
        localGenerationRoot: encodeMerkleRoot(localGenerationRoot),
      });
    }
  }
  if (best) return best;
  throw (
    lastError ?? new DustSeedError("could not pin a verifiable dust tree state")
  );
}

/**
 * Find the highest dust ledger event id reflected by the pinned block, by
 * scanning blocks downward from the pinned height until one carries dust
 * events. This anchors the tail cursor to the same state the trees were seeded
 * at, so no covered event is replayed and no uncovered event is skipped.
 */
async function findCutoffEventId(config, request, ctx, height) {
  let scanned = 0;
  let cursor = height;
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
      });
      return {
        cutoffEventId: maxId,
        cutoffHeight: foundAt,
        scannedBlocks: scanned + heights.length,
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
  });

  ctx.check("cutoff");
  const cutoff = await findCutoffEventId(config, request, ctx, pinned.height);
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
      const wallet = {
        state,
        publicKey: { publicKey },
        networkId: config.networkId,
        pendingDust: [],
        protocolVersion: config.protocolVersion,
        progress: { appliedIndex: BigInt(lastAppliedEventId) },
      };
      let updated;
      try {
        [updated] = CoreWallet.applyEventsWithChanges(
          wallet,
          config.secretKey,
          ledgerEvents,
          new Date(clock()),
        );
      } catch (error) {
        throw new DustSeedError(
          `tail events could not be applied: ${error.message}`,
        );
      }
      state = updated.state;
      lastAppliedEventId = ordered[ordered.length - 1].id;
      tailEventsApplied = ordered.length;
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
    lag: pinned.verification.lag,
    commitmentLag: pinned.verification.commitmentLag,
    generationLag: pinned.verification.generationLag,
    pinAttempts: pinned.attempts,
    commitmentPayloadBytes: pinned.commitmentPayloadBytes,
    generationPayloadBytes: pinned.generationPayloadBytes,
    scannedBlocks: cutoff.scannedBlocks,
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
