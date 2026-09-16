import assert from "node:assert/strict";
import test from "node:test";
import { localConfig } from "../src/config.mjs";
import {
  assertPreprodArtifactExpectations,
  checkPreprodProfile,
  preprodConfig,
  preprodEndpoints,
} from "../src/preprod-profile.mjs";

const hash = "a".repeat(64);
const env = {
  MILO_PREPROD_NETWORK_ID: "preprod",
  MILO_PREPROD_GENESIS_HASH: `0x${hash}`,
  MILO_PREPROD_RUNTIME_SPEC_VERSION: "1000000",
};
const deployEnv = {
  ...env,
  MILO_PREPROD_MODE: "deployment-preflight",
  MILO_PREPROD_ALLOW_PREFLIGHT: "owned-preprod-test-only",
  MILO_PREPROD_ARTIFACT_SET_SHA256: hash,
  MILO_PREPROD_COMPILE_RECEIPT_SHA256: hash,
  MILO_PREPROD_PROOF_HTTP: "http://127.0.0.1:6300",
};

test("separate immutable preprod profile does not authorize local harness", () => {
  const config = preprodConfig(env);
  assert(Object.isFrozen(config));
  assert.equal(config.mode, "observe");
  assert.equal(config.networkId, "preprod");
  for (const [key, value] of Object.entries(preprodEndpoints))
    assert.equal(config[key], value);
  assert.throws(() => localConfig(env));
  assert.equal(preprodConfig(deployEnv).proofServer, "http://127.0.0.1:6300/");
});

for (const [name, overrides] of Object.entries({
  missingNetwork: { MILO_PREPROD_NETWORK_ID: undefined },
  mainnet: { MILO_PREPROD_NETWORK_ID: "mainnet" },
  local: { MILO_PREPROD_NETWORK_ID: "undeployed" },
  mixed: { MILO_LOCAL_ALLOW_TRANSACTIONS: "disposable-owned-local" },
  badGenesis: { MILO_PREPROD_GENESIS_HASH: "0x123" },
  zeroGenesis: { MILO_PREPROD_GENESIS_HASH: `0x${"0".repeat(64)}` },
  missingSpec: { MILO_PREPROD_RUNTIME_SPEC_VERSION: undefined },
  unsafeSpec: { MILO_PREPROD_RUNTIME_SPEC_VERSION: "9007199254740992" },
  zeroSpec: { MILO_PREPROD_RUNTIME_SPEC_VERSION: "0" },
  nodeOverride: {
    MILO_PREPROD_NODE_HTTP: "https://rpc.mainnet.midnight.network",
  },
  indexerOverride: { MILO_PREPROD_INDEXER_HTTP: "https://attacker.example" },
  submitMode: { MILO_PREPROD_MODE: "deploy" },
  noConsent: { MILO_PREPROD_ALLOW_PREFLIGHT: undefined },
  noArtifacts: { MILO_PREPROD_ARTIFACT_SET_SHA256: undefined },
  noReceipt: { MILO_PREPROD_COMPILE_RECEIPT_SHA256: undefined },
  placeholderArtifacts: { MILO_PREPROD_ARTIFACT_SET_SHA256: "0".repeat(64) },
  placeholderReceipt: { MILO_PREPROD_COMPILE_RECEIPT_SHA256: "0".repeat(64) },
  remoteProof: { MILO_PREPROD_PROOF_HTTP: "https://proof.example" },
  localhostProof: { MILO_PREPROD_PROOF_HTTP: "http://localhost:6300" },
  proofCredentials: {
    MILO_PREPROD_PROOF_HTTP: "http://user:secret@127.0.0.1:6300",
  },
  proofQuery: { MILO_PREPROD_PROOF_HTTP: "http://127.0.0.1:6300/?secret=x" },
  proofPath: { MILO_PREPROD_PROOF_HTTP: "http://127.0.0.1:6300/other" },
})) {
  test(`profile rejects ${name} before network access`, async () => {
    let calls = 0;
    await assert.rejects(
      checkPreprodProfile(
        { ...deployEnv, ...overrides },
        {
          request: async () => {
            calls++;
            throw new Error("unexpected request");
          },
        },
      ),
    );
    assert.equal(calls, 0);
  });
}

test("artifact approval binds the exact validated compiler receipt and complete inventory", () => {
  const config = preprodConfig(deployEnv);
  const artifacts = {
    compiler: "0.31.1",
    language: "0.23.0",
    runtime: "0.16.0",
    artifactCount: 60,
    artifactSetSha256: hash,
    compileReceiptSha256: hash,
  };
  assertPreprodArtifactExpectations(config, artifacts);
  for (const [key, value] of Object.entries(artifacts)) {
    assert.throws(() =>
      assertPreprodArtifactExpectations(config, {
        ...artifacts,
        [key]: typeof value === "number" ? value - 1 : "bad",
      }),
    );
  }
});

test("profile observation binds genesis and runtime without deployment acceptance", async () => {
  const result = await checkPreprodProfile(env, {
    request: async (_url, options) => {
      const body = JSON.parse(options.body);
      const result = {
        system_chain: "Midnight Preprod",
        chain_getBlockHash: `0x${hash}`,
        system_version: "1.0.2-test",
        chain_getFinalizedHead: `0x${hash}`,
        chain_getHeader: { number: "0x20" },
        state_getRuntimeVersion: { specName: "midnight", specVersion: 1000000 },
      }[body.method];
      return {
        ok: true,
        json: async () =>
          body.method
            ? { jsonrpc: "2.0", id: 1, result }
            : { data: { block: { height: 32, hash } } },
      };
    },
  });
  assert.equal(result.profileVerified, true);
  for (const key of [
    "proofServiceVerified",
    "sdkCompatibilityVerified",
    "deploymentVerified",
    "admissionVerified",
  ]) {
    assert.equal(result[key], false);
  }
  assert.equal(result.transactionsSubmitted, 0);
});
