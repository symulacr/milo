// Tests for the DUST start-late seeder.
//
// Offline tests are hermetic: they use captured-and-verified collapsed-update
// payloads plus injected indexer responses. The two network tests run against
// the live Preprod indexer when it is reachable and are skipped otherwise.

import assert from "node:assert/strict";
import test from "node:test";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  applyCollapsedUpdates,
  assertSeedRootsMatch,
  DustSeedError,
  decodeDustSnapshot,
  encodeDustSnapshot,
  encodeMerkleRoot,
  rootMatches,
  seedDustState,
} from "../src/dust-seed.mjs";

// Captured at Preprod height 2633333 and verified in the same pinned indexer
// request: applying these two payloads to a fresh DustLocalState reproduces the
// exact commitment/generation roots the chain published. They are public data.
const GOLDEN = {
  height: 2633333,
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

const INDEXER_HTTP = "https://indexer.preprod.midnight.network/api/v4/graphql";
const APPLIED_INDEX = 1539228;

function goldenState() {
  return applyCollapsedUpdates({
    commitmentUpdate: GOLDEN.commitment.payload,
    generationUpdate: GOLDEN.generation.payload,
  });
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
 * Injected indexer transport. The seeder issues three kinds of read: the tip
 * end indices, the pinned block + collapsed updates, and the cutoff scan.
 */
function fakeIndexer({
  height = GOLDEN.height,
  commitmentEndExclusive = 1143241,
  generationEndExclusive = 394976,
  commitmentRoot = GOLDEN.commitment.root,
  generationRoot = GOLDEN.generation.root,
  commitmentPayload = GOLDEN.commitment.payload,
  generationPayload = GOLDEN.generation.payload,
  cutoffEventId = 77,
} = {}) {
  const calls = [];
  return {
    calls,
    request: async (query) => {
      calls.push(query);
      if (query.includes("dustCommitmentMerkleTreeUpdate")) {
        return {
          block: {
            height,
            dustCommitmentEndIndex: commitmentEndExclusive,
            dustGenerationEndIndex: generationEndExclusive,
            dustCommitmentMerkleTreeRoot: commitmentRoot,
            dustGenerationMerkleTreeRoot: generationRoot,
          },
          c: {
            endIndex: commitmentEndExclusive - 1,
            update: commitmentPayload,
          },
          g: {
            endIndex: generationEndExclusive - 1,
            update: generationPayload,
          },
        };
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
        },
      };
    },
  };
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

test("a root mismatch aborts, with a one-state lag window", () => {
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
      }),
    /root verification failed/,
  );

  // A chain root that matches only the previous collapse state is accepted and
  // recorded as a lag of one.
  const previousCommitment = 0x1111n;
  const previousGeneration = 0x2222n;
  const lagged = assertSeedRootsMatch({
    chainCommitmentRoot: encodeMerkleRoot(previousCommitment),
    chainGenerationRoot: encodeMerkleRoot(previousGeneration),
    localCommitmentRoot: commitmentRoot,
    localGenerationRoot: generationRoot,
    previousCommitmentRoot: previousCommitment,
    previousGenerationRoot: previousGeneration,
    maxLag: 1,
  });
  assert.equal(lagged.lag, 1);
  assert.equal(lagged.commitmentLag, 1);
  assert.equal(lagged.generationLag, 1);

  // Beyond the window it must abort even with a previous state available.
  assert.throws(
    () =>
      assertSeedRootsMatch({
        chainCommitmentRoot: encodeMerkleRoot(previousCommitment),
        chainGenerationRoot: encodeMerkleRoot(previousGeneration),
        localCommitmentRoot: commitmentRoot,
        localGenerationRoot: generationRoot,
        previousCommitmentRoot: previousCommitment,
        previousGenerationRoot: previousGeneration,
        maxLag: 0,
      }),
    DustSeedError,
  );
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
  const { snapshot, receipt } = await seedDustState({
    request: indexer.request,
    publicKey: secretKey.publicKey,
    networkId: "preprod",
    tailMs: 0,
    emit: (event, fields) => events.push({ event, ...fields }),
  });

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
  assert.equal(receipt.tailStartEventId, 78);
  assert.equal(receipt.lastAppliedEventId, 77);
  assert.equal(receipt.tailEventsApplied, 0);
  assert.equal(receipt.tailSkippedReason, "no-secret-key-supplied");
  assert.ok(events.some((entry) => entry.event === "dust-seed-roots-verified"));

  const restored = await decodeDustSnapshot(snapshot);
  assert.equal(restored.publicKey.publicKey, secretKey.publicKey);
  assert.equal(BigInt(restored.progress.appliedIndex), 77n);
});

test("seeder refuses to emit when the published root does not match", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer({ commitmentRoot: `73${"b".repeat(64)}` });
  await assert.rejects(
    seedDustState({
      request: indexer.request,
      publicKey: secretKey.publicKey,
      networkId: "preprod",
      tailMs: 0,
      pinAttempts: 2,
    }),
    DustSeedError,
  );
});

test("seeder refuses to emit when the collapsed update is corrupted", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer({
    commitmentPayload: corruptPayload(GOLDEN.commitment.payload),
  });
  await assert.rejects(
    seedDustState({
      request: indexer.request,
      publicKey: secretKey.publicKey,
      networkId: "preprod",
      tailMs: 0,
      pinAttempts: 2,
    }),
    DustSeedError,
  );
});

test("seeder refuses to guess the tail cursor when no dust event is found", async () => {
  const secretKey = ledger.sampleDustSecretKey();
  const indexer = fakeIndexer();
  // Override the cutoff scan to return empty transaction lists.
  const emptyScan = async (query) => {
    if (query.includes("dustLedgerEvents")) {
      return { b0: { height: GOLDEN.height, transactions: [] } };
    }
    return indexer.request(query);
  };
  await assert.rejects(
    seedDustState({
      request: emptyScan,
      publicKey: secretKey.publicKey,
      networkId: "preprod",
      tailMs: 0,
      maxScanBlocks: 4,
      scanBatchSize: 2,
    }),
    /refusing to guess the tail cursor/,
  );
});

test("live indexer root verification matches at two heights", async (t) => {
  if (!(await networkAvailable())) {
    t.skip("Preprod indexer unreachable");
    return;
  }
  const secretKey = ledger.sampleDustSecretKey();
  const results = [];
  for (let attempt = 0; attempt < 4 && results.length < 2; attempt++) {
    const { snapshot, receipt } = await seedDustState({
      secretKey,
      networkId: "preprod",
      deadlineMs: 45_000,
      tailMs: 1_500,
    });
    assert.ok(receipt.lag <= 1, `lag ${receipt.lag} exceeded the window`);
    // A lag-0 match means the published root and the seeded root are identical.
    // At lag 1 the published field trails the collapsed-update endpoint, so the
    // seeder verifies against the previous state instead; the recorded strings
    // legitimately differ there.
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
    const restored = await decodeDustSnapshot(snapshot);
    assert.ok(restored.state instanceof ledger.DustLocalState);
    if (results.length === 0 || results[0].height !== receipt.blockHeight) {
      results.push({ height: receipt.blockHeight, receipt });
    }
  }
  assert.equal(
    results.length,
    2,
    `expected verification at two distinct heights, saw ${results
      .map((entry) => entry.height)
      .join(", ")}`,
  );
  assert.notEqual(results[0].height, results[1].height);
});
