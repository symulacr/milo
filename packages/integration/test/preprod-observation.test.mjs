import assert from "node:assert/strict";
import test from "node:test";
import {
  observePreprod,
  PREPROD_INDEXER,
  PREPROD_RPC,
} from "../src/preprod-observation.mjs";

const hash = `0x${"a".repeat(64)}`;
function fixture(overrides = {}) {
  const calls = [];
  const values = {
    system_chain: "Midnight Preprod",
    chain_getBlockHash: hash,
    system_version: "test-only",
    chain_getFinalizedHead: hash,
    chain_getHeader: { number: "0x20" },
    state_getRuntimeVersion: { specName: "midnight", specVersion: 1000000 },
    indexer: { data: { block: { height: 32, hash: hash.slice(2) } } },
    ...overrides,
  };
  return {
    calls,
    request: async (url, options) => {
      assert([PREPROD_RPC, PREPROD_INDEXER].includes(url));
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      calls.push(body);
      return {
        ok: true,
        json: async () =>
          body.method
            ? { jsonrpc: "2.0", id: 1, result: values[body.method] }
            : values.indexer,
      };
    },
  };
}

test("preprod health is block-pinned and cannot claim contract acceptance", async () => {
  const f = fixture();
  const result = await observePreprod(f);
  assert.equal(result.blockHeight, 32);
  assert.equal(result.contractObserved, false);
  assert.equal(result.admissionVerified, false);
  assert.equal(result.sdkCompatibilityVerified, false);
  assert.equal(result.transactionsSubmitted, 0);
  assert.deepEqual(f.calls.find((c) => c.method === "chain_getHeader").params, [
    hash,
  ]);
  assert.deepEqual(
    f.calls.find((c) => c.method === "state_getRuntimeVersion").params,
    [hash],
  );
});

for (const [name, overrides] of Object.entries({
  mainnet: { system_chain: "Midnight Mainnet" },
  malformedHash: { chain_getFinalizedHead: "bad" },
  unsafeHeight: { chain_getHeader: { number: "0xffffffffffffffff" } },
  wrongRuntime: {
    state_getRuntimeVersion: { specName: "other", specVersion: 1 },
  },
  indexerError: { indexer: { errors: [{ message: "unavailable" }] } },
  indexerLag: { indexer: { data: { block: null } } },
  wrongHeight: { indexer: { data: { block: { height: 31, hash } } } },
  wrongHash: {
    indexer: { data: { block: { height: 32, hash: "b".repeat(64) } } },
  },
})) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(observePreprod(fixture(overrides)));
  });
}

test("HTTP failure never emits success", async () => {
  await assert.rejects(
    observePreprod({ request: async () => ({ ok: false }) }),
  );
});

test("pinned genesis mismatch stops before inspecting finalized state", async () => {
  const f = fixture();
  await assert.rejects(
    observePreprod({ ...f, expectedGenesisHash: `0x${"b".repeat(64)}` }),
    /genesis mismatch/,
  );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["system_chain", "chain_getBlockHash"],
  );
});

test("pinned runtime mismatch cannot claim indexer agreement", async () => {
  const f = fixture();
  await assert.rejects(
    observePreprod({ ...f, expectedRuntimeSpecVersion: 2 }),
    /runtime mismatch/,
  );
  assert(!f.calls.some((call) => call.query));
});
