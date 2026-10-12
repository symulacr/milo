import assert from "node:assert/strict";
import {
  blockfrostPreprodEndpoints,
  PREPROD_BLOCKFROST_BASES,
  redactBlockfrostUrl,
} from "./blockfrost.mjs";

// Bare Blockfrost Preprod bases, WITHOUT the token. The token is appended at call time by
// observePreprod, so importing this module never requires a token and never throws.
export const PREPROD_RPC = PREPROD_BLOCKFROST_BASES.node;
export const PREPROD_INDEXER = PREPROD_BLOCKFROST_BASES.indexer;

// Public-chain health evidence only: never an admission or contract-state record.
export async function observePreprod({
  request = fetch,
  expectedGenesisHash,
  expectedRuntimeSpecVersion,
  endpoints,
} = {}) {
  // Resolve the token-bearing endpoints from the environment unless the caller pins them.
  const ep = endpoints ?? blockfrostPreprodEndpoints(process.env);
  if (expectedGenesisHash !== undefined)
    assert.match(expectedGenesisHash, /^0x[0-9a-f]{64}$/);
  if (expectedRuntimeSpecVersion !== undefined)
    assert(
      Number.isSafeInteger(expectedRuntimeSpecVersion) &&
        expectedRuntimeSpecVersion > 0,
    );
  async function post(url, body) {
    const response = await request(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert(response.ok, "Preprod service HTTP failure");
    return response.json();
  }
  async function rpc(method, params = []) {
    const result = await post(ep.node, {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });
    assert.equal(result.jsonrpc, "2.0");
    assert.equal(result.id, 1);
    assert.equal(result.error, undefined, "Preprod RPC error");
    return result.result;
  }
  const chain = await rpc("system_chain");
  assert.equal(chain, "Midnight Preprod", "Unexpected chain identity");
  const genesisHash = await rpc("chain_getBlockHash", [0]);
  assert.match(genesisHash, /^0x[0-9a-f]{64}$/);
  if (expectedGenesisHash !== undefined)
    assert.equal(genesisHash, expectedGenesisHash, "Preprod genesis mismatch");
  const nodeVersion = await rpc("system_version");
  assert.equal(typeof nodeVersion, "string");
  const blockHash = await rpc("chain_getFinalizedHead");
  assert.match(blockHash, /^0x[0-9a-f]{64}$/);
  const header = await rpc("chain_getHeader", [blockHash]);
  assert.match(header.number, /^0x[0-9a-f]+$/);
  const blockHeight = Number(BigInt(header.number));
  assert(Number.isSafeInteger(blockHeight) && blockHeight >= 0);
  const runtime = await rpc("state_getRuntimeVersion", [blockHash]);
  assert.equal(runtime.specName, "midnight");
  assert(Number.isSafeInteger(runtime.specVersion));
  if (expectedRuntimeSpecVersion !== undefined)
    assert.equal(
      runtime.specVersion,
      expectedRuntimeSpecVersion,
      "Preprod runtime mismatch",
    );
  const indexed = await post(ep.indexer, {
    query: `query { block(offset: {height: ${blockHeight}}) { height hash } }`,
  });
  assert.equal(indexed.errors, undefined, "Preprod indexer error");
  assert.equal(indexed.data?.block?.height, blockHeight);
  assert.equal(indexed.data.block.hash.replace(/^0x/, ""), blockHash.slice(2));
  return {
    scope: "preprod-finalized-block-health-only",
    observedAt: new Date().toISOString(),
    // Redacted: the endpoint URLs carry the Blockfrost token as a query parameter.
    endpoints: {
      rpc: redactBlockfrostUrl(ep.node),
      indexer: redactBlockfrostUrl(ep.indexer),
    },
    chain,
    genesisHash,
    nodeVersion,
    runtime: { specName: runtime.specName, specVersion: runtime.specVersion },
    blockHeight,
    blockHash,
    nodeIndexerAgreement: true,
    sdkCompatibilityVerified: false,
    contractObserved: false,
    admissionVerified: false,
    transactionsSubmitted: 0,
  };
}
