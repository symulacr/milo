import assert from "node:assert/strict";
import test from "node:test";
import {
  observePreprod,
  PREPROD_INDEXER,
  PREPROD_RPC,
} from "../src/preprod-observation.mjs";

const hash = `0x${"a".repeat(64)}`;
// Explicit token-bearing endpoints, so the test never depends on process.env and never needs
// a real token. These mirror what blockfrostPreprodEndpoints produces.
const ENDPOINTS = Object.freeze({
  node: "https://rpc.midnight-preprod.blockfrost.io?project_id=nightpreprodTEST",
  nodeWS:
    "wss://rpc.midnight-preprod.blockfrost.io?project_id=nightpreprodTEST",
  indexer:
    "https://midnight-preprod.blockfrost.io/api/v0?project_id=nightpreprodTEST",
  indexerWS:
    "wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=nightpreprodTEST",
});
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
      assert([ENDPOINTS.node, ENDPOINTS.indexer].includes(url));
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
  const result = await observePreprod({ ...f, endpoints: ENDPOINTS });
  assert.equal(result.blockHeight, 32);
  assert.equal(result.contractObserved, false);
  assert.equal(result.admissionVerified, false);
  assert.equal(result.sdkCompatibilityVerified, false);
  assert.equal(result.transactionsSubmitted, 0);
  // The receipt never records the token: the endpoint URLs are redacted.
  assert.equal(result.endpoints.rpc.includes("nightpreprodTEST"), false);
  assert.match(result.endpoints.rpc, /project_id=%3Credacted%3E/);
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
    await assert.rejects(
      observePreprod({ ...fixture(overrides), endpoints: ENDPOINTS }),
    );
  });
}

test("HTTP failure never emits success", async () => {
  await assert.rejects(
    observePreprod({
      request: async () => ({ ok: false }),
      endpoints: ENDPOINTS,
    }),
  );
});

test("pinned genesis mismatch stops before inspecting finalized state", async () => {
  const f = fixture();
  await assert.rejects(
    observePreprod({
      ...f,
      endpoints: ENDPOINTS,
      expectedGenesisHash: `0x${"b".repeat(64)}`,
    }),
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
    observePreprod({
      ...f,
      endpoints: ENDPOINTS,
      expectedRuntimeSpecVersion: 2,
    }),
    /runtime mismatch/,
  );
  assert(!f.calls.some((call) => call.query));
});

test("the exported bare bases carry no token", () => {
  assert.equal(PREPROD_RPC, "https://rpc.midnight-preprod.blockfrost.io");
  assert.equal(
    PREPROD_INDEXER,
    "https://midnight-preprod.blockfrost.io/api/v0",
  );
  assert.equal(PREPROD_RPC.includes("project_id"), false);
  assert.equal(PREPROD_INDEXER.includes("project_id"), false);
});
