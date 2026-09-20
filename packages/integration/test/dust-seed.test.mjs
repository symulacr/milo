// Tests for the DUST start-late seeder.
//
// Offline tests are hermetic: they use captured-and-verified collapsed-update
// payloads plus injected indexer responses. The live test runs against the live
// Preprod indexer when it is reachable and skips - with a reason - when the
// published tip will not settle, so it never fails intermittently on a busy
// chain.

import assert from "node:assert/strict";
import test from "node:test";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  applyCollapsedUpdates,
  applyTailEventsLinear,
  assertSeedRootsMatch,
  DustSeedError,
  decodeDustSnapshot,
  encodeDustSnapshot,
  encodeMerkleRoot,
  localTreeFirstFree,
  rootMatches,
  seedDustState,
} from "../src/dust-seed.mjs";

// Captured at Preprod height 2633333 and verified in the same pinned indexer
// request: applying these two payloads to a fresh DustLocalState reproduces the
// exact commitment/generation roots the chain published. The block's own end
// indices are 1143242 / 394976 (exclusive), so the collapsed-update end index
// is one lower. These are public data.
const GOLDEN = {
  height: 2633333,
  commitmentEndExclusive: 1143242,
  generationEndExclusive: 394976,
  commitment: {
    root: "73b889f6a9e9510663728d38b0194636734af7ffbe06e2d2cf1031d9634c26355b",
    payload:
      "6d69646e696768743a6d65726b6c652d747265652d636f6c6c61707365642d7570646174655b76315d3a0026c745002873a9b606da7186cf016a38c79cef4e4ae74dbc7fc5838a420ad1a2a73b2e2e914d73ddcd450236615975bcbf3a34fa161a9938f6e9cb668dd5d3a30536b38d612e517368cb8f0a5ee02d7417f59e6da485a385077e06b7c5c2dd8e19602bb9e49d2929736445061848bb4feeaa9592bd7b51f21de5a694abdc85aed0d82b178246e1831c73c890bf20257247746de8535e0e8592bacaab1fc78a15c3f9075dc8c048f06803735a2e9e0f4f9f19577a6c37b07e1211b0f0ad67d875966da3d165948f186aed377395929203fa3109519ca8d804d7c8007972c366662d921776480a08e374e2f94273507b7d0f3e92561c8adbfcaecf589b07ef060f556b41a6af243d2c471e5bb20f73cc4295bc6785bce2483635d2963474e8349cb590ab3fe60f0fc1391684c4e61473c4655e479b808fd72125e0fce9f219fd77e70ac23d82fd7e0fa4ebb32817aa0f",
  },
  generation: {
    root: "7311c6c9ac8b35dd5b83aa015d0a056df81a28ff049b8e58603661c158de685857",
    payload:
      "6d69646e696768743a6d65726b6c652d747265652d636f6c6c61707365642d7570646174655b76315d3a007e1b18001c733943f917951a736d12d61e47ba5c0afd58c3648bf9e211953dbb0e70986faf32730b6f0efea4be55ef3d048cfa21779f1eb3fc0398a48b5ac828a34e8941f8a25273b5159884eaf52ce3687bff042ef3289511d7f3c06a87ba056d0d7993b721f84f73b90ced9ce625b1e365f24009015083db9ae2cb4c7b93f820f54fa70a5c4cc96073aadfe45cfc186fba7c0896087e085331b9499d0036b8c9967e66c33ea267731d735a5dee648f1ef9b478aea2033214f3013d759c364ab717d56c0bb6a70ba45710735dce894a0339c0d3c18605db5ece0e6165a6b27cf8da708e633322aea0adba23",
  },
};

// The real collapsed update one leaf behind the endpoint (endIndex 1143240),
// captured from the same Preprod block. Used to exercise the widened lag window
// end to end with real payloads.
const GOLDEN_PREV = {
  root: "73908e35ea69219756cd0ce04d7ae851a49bee8729ba73102156170d4e6d365f4b",
  payload:
    "6d69646e696768743a6d65726b6c652d747265652d636f6c6c61707365642d7570646174655b76315d3a0022c745002873a9b606da7186cf016a38c79cef4e4ae74dbc7fc5838a420ad1a2a73b2e2e914d73ddcd450236615975bcbf3a34fa161a9938f6e9cb668dd5d3a30536b38d612e517368cb8f0a5ee02d7417f59e6da485a385077e06b7c5c2dd8e19602bb9e49d2929736445061848bb4feeaa9592bd7b51f21de5a694abdc85aed0d82b178246e1831c73c890bf20257247746de8535e0e8592bacaab1fc78a15c3f9075dc8c048f06803735a2e9e0f4f9f19577a6c37b07e1211b0f0ad67d875966da3d165948f186aed377395929203fa3109519ca8d804d7c8007972c366662d921776480a08e374e2f94273507b7d0f3e92561c8adbfcaecf589b07ef060f556b41a6af243d2c471e5bb20f73cc4295bc6785bce2483635d2963474e8349cb590ab3fe60f0fc1391684c4e6146f7cf6ec9cf5d13538e7f565f6734f063249713eab50d26e6d781a5d00c9e4e1",
};

// Real Preprod dust ledger events captured from the stream. Event 1539252
// applies linearly onto the golden state (whose boundary is event 1539251);
// 1539253 and 1539251 are used to drive the wrong-offset guard. Public data.
const GOLDEN_EVENTS = {
  1539251:
    "6d69646e696768743a6576656e745b76395d3a0400f5013e847b8c09a5e94c49d1139956bfd1623e7029e2c10d9091929f43ed84914fbf000001000773847d5e7ba5e47220d8c64306d0fdd4f1986cd8fff546e8f3965a99b6a82c771426c7450073bcee1443db05a864d06745cf04490c22f80fcd007208d18d7ce687d0faecbc480f01c06e31d910010338e6af6a0350e6af6a",
  1539252:
    "6d69646e696768743a6576656e745b76395d3a0400f501965c347ab3d4577b70d80bc6d141e2cbc2334bb3ee69dfb835685fa6a76c2c01000001000773d62497985214963e07c913a68bf47986c9bbc3d90cb567b9bc24d8c2b814a3442ac7450073f0ce56c2c3a3f648be91615696f7422715838db5097ed57cfd41a9b3cffc6f180f01c06e31d910010386e6af6a039ee6af6a",
  1539253:
    "6d69646e696768743a6576656e745b76395d3a0400f50193788639f0b2e9a0f7a012c64d05038a677224875a11151057a7fcd96beb0022000001000773480c271c3a457db69b26c4154f608f2a5726787e5d63a7789db73b399c6b5b6e2ec745007396b2b38cddbab676fa69b4fdf90b2a3cb114cf895f6dc39abc4492a97290fb350f01c06e31d9100103aae6af6a03bce6af6a",
  1539254:
    "6d69646e696768743a6576656e745b76395d3a0400f5011d1261afc8647a91f4c039d323f56a9742ef7329bd7dac88ac6898a0913bd190000002000773118265a3ed4da7e74a0d411181d938758bce5ddf68a7bde2fc19c18fe383393e32c7450073ccc7a6df4a38d489e5ceb404daf56e134df62e306f56b9ceae0544b61372e3560f01c06e31d9100103eae8af6a03fce8af6a",
};

const INDEXER_HTTP = "https://indexer.preprod.midnight.network/api/v4/graphql";
const APPLIED_INDEX = 1539228;

function goldenState() {
  return applyCollapsedUpdates({
    commitmentUpdate: GOLDEN.commitment.payload,
    generationUpdate: GOLDEN.generation.payload,
  });
}

function decodeEventFixture(id) {
  return ledger.Event.deserialize(Buffer.from(GOLDEN_EVENTS[id], "hex"));
}

/** Flip one hex digit in the middle of a payload. */
function corruptPayload(payload) {
  const at = Math.floor(payload.length / 2);
  const original = payload[at];
  const replacement = original === "0" ? "1" : "0";
  return payload.slice(0, at) + replacement + payload.slice(at + 1);
}

let probe;
async function networkAvailable() {
  if (probe === undefined) {
    probe = fetch(INDEXER_HTTP, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ block(offset:null){ height } }" }),
      signal: AbortSignal.timeout(8_000),
    })
      .then((response) => response.ok)
      .catch(() => false);
  }
  return probe;
}

/**
 * Injected indexer transport. The seeder issues three kinds of read: the light
 * tip read (for stabilisation), the pinned block + collapsed updates (with the
 * recent-block batch), and the fallback cutoff scan.
 */
function fakeIndexer({
  height = GOLDEN.height,
  commitmentEndExclusive = GOLDEN.commitmentEndExclusive,
  generationEndExclusive = GOLDEN.generationEndExclusive,
  commitmentRoot = GOLDEN.commitment.root,
  generationRoot = GOLDEN.generation.root,
  commitmentPayload = GOLDEN.commitment.payload,
  generationPayload = GOLDEN.generation.payload,
  commitmentUpdateEndIndex,
  previousCommitmentPayload = null,
  previousGenerationPayload = null,
  cutoffEventId = 77,
  includeBatch = true,
} = {}) {
  const calls = [];
  return {
    calls,
    request: async (query) => {
      calls.push(query);
      if (query.includes("dustCommitmentMerkleTreeUpdate")) {
        const response = {
          block: {
            height,
            dustCommitmentEndIndex: commitmentEndExclusive,
            dustGenerationEndIndex: generationEndExclusive,
            dustCommitmentMerkleTreeRoot: commitmentRoot,
            dustGenerationMerkleTreeRoot: generationRoot,
          },
          c: {
            endIndex: commitmentUpdateEndIndex ?? commitmentEndExclusive - 1,
            update: commitmentPayload,
          },
          g: {
            endIndex: generationEndExclusive - 1,
            update: generationPayload,
          },
        };
        if (previousCommitmentPayload) {
          response.cp1 = {
            endIndex: commitmentEndExclusive - 2,
            update: previousCommitmentPayload,
          };
        }
        if (previousGenerationPayload) {
          response.gp1 = {
            endIndex: generationEndExclusive - 2,
            update: previousGenerationPayload,
          };
        }
        if (includeBatch) {
          response.b0 = {
            height,
            transactions: [
              { id: 1, dustLedgerEvents: [{ id: cutoffEventId }] },
            ],
          };
        }
        return response;
      }
      if (query.includes("dustLedgerEvents")) {
        return {
          b0: {
            height,
            transactions: [
              { id: 1, dustLedgerEvents: [{ id: cutoffEventId }] },
            ],
          },
        };
      }
      return {
        block: {
          height,
          dustCommitmentEndIndex: commitmentEndExclusive,
          dustGenerationEndIndex: generationEndExclusive,
          dustCommitmentMerkleTreeRoot: commitmentRoot,
          dustGenerationMerkleTreeRoot: generationRoot,
        },
      };
    },
  };
}

/** Options that keep the quiet-window wait instantaneous in tests. */
function fastStabilise(extra = {}) {
  return { stabiliseMs: 5_000, stabilisePollMs: 0, ...extra };
}

test("golden collapsed updates reproduce the captured chain roots", () => {
  const state = goldenState();
  assert.ok(
    rootMatches(state.commitmentTreeRoot(), GOLDEN.commitment.root),
    `commitment root mismatch: local ${encodeMerkleRoot(state.commitmentTreeRoot())} vs chain ${GOLDEN.commitment.root}`,
  );
  assert.ok(
    rootMatches(state.generatingTreeRoot(), GOLDEN.generation.root),
    `generation root mismatch: local ${encodeMerkleRoot(state.generatingTreeRoot())} vs chain ${GOLDEN.generation.root}`,
  );
  assert.equal(
    encodeMerkleRoot(state.commitmentTreeRoot()),
    GOLDEN.commitment.root,
  );
  const firstFree = localTreeFirstFree(state);
  assert.equal(firstFree.commitment, BigInt(GOLDEN.commitmentEndExclusive));
  assert.equal(firstFree.generation, BigInt(GOLDEN.generationEndExclusive));
});

test("a deliberately corrupted collapsed update is rejected", () => {
  const corrupted = corruptPayload(GOLDEN.commitment.payload);
  assert.notEqual(corrupted, GOLDEN.commitment.payload);
  let corruptedRoot;
  try {
    corruptedRoot = applyCollapsedUpdates({
      commitmentUpdate: corrupted,
      generationUpdate: GOLDEN.generation.payload,
    }).commitmentTreeRoot();
  } catch (error) {
    assert.ok(error instanceof DustSeedError, `unexpected error: ${error}`);
    return;
  }
  assert.equal(rootMatches(corruptedRoot, GOLDEN.commitment.root), false);
  assert.throws(
    () =>
      assertSeedRootsMatch({
        chainCommitmentRoot: GOLDEN.commitment.root,
        chainGenerationRoot: GOLDEN.generation.root,
        localCommitmentRoot: corruptedRoot,
        localGenerationRoot: goldenState().generatingTreeRoot(),
      }),
    DustSeedError,
  );
});

test("a root mismatch aborts, and the lag window is bounded but wider than one", () => {
  const state = goldenState();
  const commitmentRoot = state.commitmentTreeRoot();
  const generationRoot = state.generatingTreeRoot();
  const wrong = `73${"a".repeat(64)}`;

  assert.throws(
    () =>
      assertSeedRootsMatch({
        chainCommitmentRoot: wrong,
        chainGenerationRoot: wrong,
        localCommitmentRoot: commitmentRoot,
        localGenerationRoot: generationRoot,
        maxLag: 4,
      }),
    /root verification failed/,
  );

  // The widened window accepts a published root matching any depth up to
  // maxLag, and records the depth it matched at.
  const depthThree = 0x3333n;
  const localCommitmentRoots = [commitmentRoot];
  localCommitmentRoots[3] = depthThree;
  const lagged = assertSeedRootsMatch({
    chainCommitmentRoot: encodeMerkleRoot(depthThree),
    chainGenerationRoot: encodeMerkleRoot(generationRoot),
    localCommitmentRoots,
    localGenerationRoots: [generationRoot],
    maxLag: 4,
  });
  assert.equal(lagged.commitmentLag, 3);
  assert.equal(lagged.generationLag, 0);
  assert.equal(lagged.lag, 3);

  // Beyond the window it must abort even when a deeper state exists.
  assert.throws(
    () =>
      assertSeedRootsMatch({
        chainCommitmentRoot: encodeMerkleRoot(depthThree),
        chainGenerationRoot: encodeMerkleRoot(generationRoot),
        localCommitmentRoots,
        localGenerationRoots: [generationRoot],
        maxLag: 2,
      }),
    DustSeedError,
  );

  // The single-value call style (endpoint plus one previous state) still works.
  const oneBehind = 0x4444n;
  const legacy = assertSeedRootsMatch({
    chainCommitmentRoot: encodeMerkleRoot(oneBehind),
    chainGenerationRoot: encodeMerkleRoot(generationRoot),
    localCommitmentRoot: commitmentRoot,
    localGenerationRoot: generationRoot,
    previousCommitmentRoot: oneBehind,
    previousGenerationRoot: generationRoot,
    maxLag: 4,
  });
  assert.equal(legacy.commitmentLag, 1);
});

test("emitted snapshot round-trips through the SDK and carries no secret material", async () => {
  const state = goldenState();
  const secretKey = ledger.sampleDustSecretKey();
  const other = ledger.sampleDustSecretKey();
  const snapshot = await encodeDustSnapshot({
    publicKey: secretKey.publicKey,
    state,
    protocolVersion: 0n,
    networkId: "preprod",
    appliedIndex: APPLIED_INDEX,
  });

  const parsed = JSON.parse(snapshot);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "networkId",
    "offset",
    "protocolVersion",
    "publicKey",
    "state",
  ]);
  assert.equal(parsed.publicKey.publicKey, secretKey.publicKey.toString());
  assert.equal(parsed.offset, String(APPLIED_INDEX));
  assert.equal(parsed.networkId, "preprod");

  const lowered = snapshot.toLowerCase();
  for (const forbidden of ["seed", "secret", "privatekey", "mnemonic"]) {
    assert.equal(
      lowered.includes(forbidden),
      false,
      `snapshot unexpectedly contains "${forbidden}"`,
    );
  }
  assert.equal(snapshot.includes(other.publicKey.toString()), false);

  const restored = await decodeDustSnapshot(snapshot);
  assert.ok(restored.state instanceof ledger.DustLocalState);
  assert.equal(restored.publicKey.publicKey, secretKey.publicKey);
  assert.equal(BigInt(restored.progress.appliedIndex), BigInt(APPLIED_INDEX));
  assert.equal(restored.state.commitmentTreeRoot(), state.commitmentTreeRoot());
  assert.equal(restored.state.generatingTreeRoot(), state.generatingTreeRoot());
});

test("seeder emits a verified snapshot from injected indexer responses", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer();
  const events = [];
  const { snapshot, receipt } = await seedDustState(
    fastStabilise({
      request: indexer.request,
      publicKey: secretKey.publicKey,
      networkId: "preprod",
      tailMs: 0,
      emit: (event, fields) => events.push({ event, ...fields }),
    }),
  );

  assert.equal(receipt.blockHeight, GOLDEN.height);
  assert.equal(receipt.matchedHeight, GOLDEN.height);
  assert.equal(receipt.lag, 0);
  assert.equal(receipt.chainCommitmentRoot, receipt.localCommitmentRoot);
  assert.equal(receipt.chainGenerationRoot, receipt.localGenerationRoot);
  assert.equal(receipt.chainCommitmentRoot, GOLDEN.commitment.root);
  assert.equal(receipt.chainGenerationRoot, GOLDEN.generation.root);
  assert.ok(receipt.commitmentPayloadBytes > 0);
  assert.ok(receipt.generationPayloadBytes > 0);
  assert.equal(receipt.cutoffEventId, 77);
  assert.equal(receipt.cutoffSource, "pinned");
  assert.equal(receipt.tailStartEventId, 78);
  assert.equal(receipt.lastAppliedEventId, 77);
  assert.equal(receipt.tailEventsApplied, 0);
  assert.equal(receipt.tailSkippedReason, "no-secret-key-supplied");
  assert.equal(typeof receipt.stabiliseWaitedMs, "number");
  assert.ok(receipt.stabiliseReads >= 2);
  assert.ok(events.some((entry) => entry.event === "dust-seed-roots-verified"));
  assert.ok(events.some((entry) => entry.event === "dust-seed-root-stable"));

  const restored = await decodeDustSnapshot(snapshot);
  assert.equal(restored.publicKey.publicKey, secretKey.publicKey);
  assert.equal(BigInt(restored.progress.appliedIndex), 77n);
});

test("seeder accepts a published root that lags within the widened window", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  // The live published commitment field is one leaf behind the endpoint; the
  // generation field is caught up. This is exactly the busy-chain condition.
  const indexer = fakeIndexer({
    commitmentRoot: GOLDEN_PREV.root,
    previousCommitmentPayload: GOLDEN_PREV.payload,
  });
  const events = [];
  const { receipt } = await seedDustState(
    fastStabilise({
      request: indexer.request,
      publicKey: secretKey.publicKey,
      networkId: "preprod",
      tailMs: 0,
      emit: (event, fields) => events.push({ event, ...fields }),
    }),
  );
  assert.equal(receipt.commitmentLag, 1);
  assert.equal(receipt.generationLag, 0);
  assert.equal(receipt.lag, 1);
  // The emitted snapshot's own root is still the endpoint root, not the lagged
  // published field.
  assert.equal(receipt.localCommitmentRoot, GOLDEN.commitment.root);
  assert.equal(receipt.chainCommitmentRoot, GOLDEN_PREV.root);
  assert.ok(events.some((entry) => entry.event === "dust-seed-root-lagged"));
});

test("seeder refuses a collapsed update that does not cover the pinned end index", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer({
    commitmentUpdateEndIndex: GOLDEN.commitmentEndExclusive - 2,
  });
  await assert.rejects(
    seedDustState(
      fastStabilise({
        request: indexer.request,
        publicKey: secretKey.publicKey,
        networkId: "preprod",
        tailMs: 0,
        pinAttempts: 2,
      }),
    ),
    /refusing to compare across two tree states/,
  );
});

test("seeder refuses when the reconstructed leaf count disagrees with the block", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  // Same payloads, but the block advertises one extra commitment leaf. The
  // payload still reconstructs 1143242 leaves, so the same-response check fires.
  const indexer = fakeIndexer({
    commitmentEndExclusive: GOLDEN.commitmentEndExclusive + 1,
  });
  await assert.rejects(
    seedDustState(
      fastStabilise({
        request: indexer.request,
        publicKey: secretKey.publicKey,
        networkId: "preprod",
        tailMs: 0,
        pinAttempts: 2,
      }),
    ),
    /reconstruct a tree of/,
  );
});

test("seeder refuses to emit when the published root does not match", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer({ commitmentRoot: `73${"b".repeat(64)}` });
  await assert.rejects(
    seedDustState(
      fastStabilise({
        request: indexer.request,
        publicKey: secretKey.publicKey,
        networkId: "preprod",
        tailMs: 0,
        pinAttempts: 2,
      }),
    ),
    DustSeedError,
  );
});

test("seeder refuses to emit when the collapsed update is corrupted", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer({
    commitmentPayload: corruptPayload(GOLDEN.commitment.payload),
  });
  await assert.rejects(
    seedDustState(
      fastStabilise({
        request: indexer.request,
        publicKey: secretKey.publicKey,
        networkId: "preprod",
        tailMs: 0,
        pinAttempts: 2,
      }),
    ),
    DustSeedError,
  );
});

test("seeder refuses quickly when the published tip will not stabilise", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  // Every light read reports a different commitment end index, so the tip never
  // settles. The seeder must refuse fast with the observed values, not chase.
  let reads = 0;
  const movingTip = async (_query) => {
    reads += 1;
    return {
      block: {
        height: GOLDEN.height + reads,
        dustCommitmentEndIndex: GOLDEN.commitmentEndExclusive + reads,
        dustGenerationEndIndex: GOLDEN.generationEndExclusive,
        dustCommitmentMerkleTreeRoot: GOLDEN.commitment.root,
        dustGenerationMerkleTreeRoot: GOLDEN.generation.root,
      },
    };
  };
  const started = Date.now();
  await assert.rejects(
    seedDustState({
      request: movingTip,
      publicKey: secretKey.publicKey,
      networkId: "preprod",
      tailMs: 0,
      stabiliseMs: 60,
      stabilisePollMs: 0,
      deadlineMs: 10_000,
    }),
    /did not stabilise/,
  );
  assert.ok(Date.now() - started < 5_000, "refusal was not quick");
  assert.ok(reads > 1);
});

test("seeder refuses to guess the tail cursor when no dust event is found", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer({ includeBatch: false });
  // Override the cutoff scan to return empty transaction lists. The pinned
  // request is delegated so the seeder still gets its collapsed updates.
  const emptyScan = async (query) => {
    if (query.includes("dustCommitmentMerkleTreeUpdate")) {
      return indexer.request(query);
    }
    if (query.includes("dustLedgerEvents")) {
      return { b0: { height: GOLDEN.height, transactions: [] } };
    }
    return indexer.request(query);
  };
  await assert.rejects(
    seedDustState(
      fastStabilise({
        request: emptyScan,
        publicKey: secretKey.publicKey,
        networkId: "preprod",
        tailMs: 0,
        maxScanBlocks: 4,
        scanBatchSize: 2,
      }),
    ),
    /refusing to guess the tail cursor/,
  );
});

test("tail replay guard applies a linearly resumable event", () => {
  const state = goldenState();
  const result = applyTailEventsLinear({
    state,
    publicKey: ledger.sampleDustSecretKey().publicKey,
    appliedIndex: 1539251,
    events: [{ id: 1539252, event: decodeEventFixture(1539252) }],
    secretKey: ledger.sampleDustSecretKey(),
    networkId: "preprod",
    timestamp: new Date(0),
  });
  assert.equal(result.appliedEvents, 1);
  assert.equal(result.lastAppliedEventId, 1539252);
  assert.notEqual(
    result.state.commitmentTreeRoot(),
    state.commitmentTreeRoot(),
    "the applied event should advance the commitment tree",
  );
});

test("tail replay guard surfaces the ledger non-linear error for a skipped event", () => {
  const state = goldenState();
  // Offset one too high: event 1539252 is covered by the tree but was skipped,
  // so inserting 1539253 is non-linear. This is the exact error the SDK's sync
  // loop swallows and retries forever.
  assert.throws(
    () =>
      applyTailEventsLinear({
        state,
        publicKey: ledger.sampleDustSecretKey().publicKey,
        appliedIndex: 1539252,
        events: [{ id: 1539253, event: decodeEventFixture(1539253) }],
        secretKey: ledger.sampleDustSecretKey(),
        networkId: "preprod",
        timestamp: new Date(0),
      }),
    /non-linearly into dust/,
  );
});

test("tail replay guard refuses a non-contiguous tail", () => {
  const state = goldenState();
  assert.throws(
    () =>
      applyTailEventsLinear({
        state,
        publicKey: ledger.sampleDustSecretKey().publicKey,
        appliedIndex: 1539251,
        events: [{ id: 1539254, event: decodeEventFixture(1539254) }],
        secretKey: ledger.sampleDustSecretKey(),
        networkId: "preprod",
        timestamp: new Date(0),
      }),
    /not contiguous/,
  );
});

test("tail replay guard refuses an offset that re-applies a covered event", () => {
  const state = goldenState();
  // Offset one too low: event 1539251 is already in the tree, so re-inserting
  // it is non-linear.
  assert.throws(
    () =>
      applyTailEventsLinear({
        state,
        publicKey: ledger.sampleDustSecretKey().publicKey,
        appliedIndex: 1539250,
        events: [{ id: 1539251, event: decodeEventFixture(1539251) }],
        secretKey: ledger.sampleDustSecretKey(),
        networkId: "preprod",
        timestamp: new Date(0),
      }),
    /non-linearly into dust/,
  );
});

test("live indexer root verification succeeds with a stabilised comparison", async (t) => {
  if (!(await networkAvailable())) {
    t.skip("Preprod indexer unreachable");
    return;
  }
  const secretKey = ledger.sampleDustSecretKey();
  const successes = [];
  let instabilityReason = null;
  for (let attempt = 0; attempt < 4 && successes.length < 2; attempt++) {
    let result;
    try {
      result = await seedDustState({
        secretKey,
        networkId: "preprod",
        deadlineMs: 45_000,
        tailMs: 1_500,
      });
    } catch (error) {
      // An unsettled window is a legitimate refusal on a busy chain: skip with
      // the observed values rather than fail intermittently.
      if (/did not stabilise|moving target/.test(String(error?.message))) {
        instabilityReason = String(error.message);
        continue;
      }
      throw error;
    }
    const { receipt } = result;
    assert.ok(
      receipt.lag >= 0 && receipt.lag <= 4,
      `lag ${receipt.lag} outside the window`,
    );
    if (receipt.lag === 0) {
      assert.equal(receipt.chainCommitmentRoot, receipt.localCommitmentRoot);
      assert.equal(receipt.chainGenerationRoot, receipt.localGenerationRoot);
    }
    for (const root of [
      receipt.chainCommitmentRoot,
      receipt.localCommitmentRoot,
      receipt.chainGenerationRoot,
      receipt.localGenerationRoot,
    ]) {
      assert.match(root, /^73[0-9a-f]{64}$/);
    }
    assert.ok(Number.isSafeInteger(receipt.blockHeight));
    assert.ok(receipt.commitmentPayloadBytes > 0);
    assert.ok(receipt.generationPayloadBytes > 0);
    assert.ok(receipt.lastAppliedEventId >= receipt.cutoffEventId);
    assert.ok(
      receipt.cutoffSource === "pinned" || receipt.cutoffSource === "scan",
      `unexpected cutoff source ${receipt.cutoffSource}`,
    );
    assert.equal(typeof receipt.stabiliseWaitedMs, "number");
    const restored = await decodeDustSnapshot(result.snapshot);
    assert.ok(restored.state instanceof ledger.DustLocalState);
    if (!successes.some((entry) => entry.height === receipt.blockHeight)) {
      successes.push({ height: receipt.blockHeight, receipt });
    }
  }
  if (successes.length < 2) {
    t.skip(
      `could not obtain two stabilised verification windows (reason: ${
        instabilityReason ?? "none recorded"
      })`,
    );
    return;
  }
  assert.notEqual(successes[0].height, successes[1].height);
});
