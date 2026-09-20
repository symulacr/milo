import assert from "node:assert/strict";
import test from "node:test";
import { localConfig } from "../src/config.mjs";

const base = {
  MILO_LOCAL_ALLOW_TRANSACTIONS: "disposable-owned-local",
  MILO_LOCAL_NETWORK_ID: "undeployed",
  MILO_LOCAL_GENESIS_HASH: `0x${"a".repeat(64)}`,
  MILO_LOCAL_NODE_HTTP: "http://127.0.0.1:9944",
  MILO_LOCAL_NODE_WS: "ws://127.0.0.1:9944",
  MILO_LOCAL_INDEXER_HTTP: "http://127.0.0.1:8088/api/v4/graphql",
  MILO_LOCAL_INDEXER_WS: "ws://127.0.0.1:8088/api/v4/graphql/ws",
  MILO_LOCAL_PROOF_HTTP: "http://127.0.0.1:6300",
};

test("localConfig keeps the load-bearing wallet fields", () => {
  const config = localConfig(base);
  // Removing these two fields broke the real lane deterministically with a
  // mn_addr_undefined HRP while every static gate stayed green; the fields are
  // load-bearing even though no in-repo file names them.
  assert.equal(config.walletNetworkId, "undeployed");
  assert.ok("faucet" in config);
  assert.equal(config.faucet, undefined);
  assert.equal(config.networkId, "undeployed");
});
