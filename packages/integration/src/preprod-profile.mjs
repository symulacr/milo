import assert from "node:assert/strict";
import { TOOLCHAIN, validateArtifacts, validateCohort } from "./artifacts.mjs";
import {
  blockfrostPreprodEndpoints,
  blockfrostProjectId,
  PREPROD_BLOCKFROST_BASES,
} from "./blockfrost.mjs";
import { HEX64, isLoopbackHostname } from "./config.mjs";
import { observePreprod } from "./preprod-observation.mjs";

// The bare Blockfrost Preprod bases, WITHOUT the token, for reference and tests. The
// token-bearing endpoints are produced per call by `preprodConfig` (see blockfrost.mjs).
export const preprodEndpoints = Object.freeze({
  node: PREPROD_BLOCKFROST_BASES.node,
  nodeWS: PREPROD_BLOCKFROST_BASES.nodeWS,
  indexer: PREPROD_BLOCKFROST_BASES.indexer,
  indexerWS: PREPROD_BLOCKFROST_BASES.indexerWS,
});

export const preprodServiceExpectations = Object.freeze({
  node: "1.0.2",
  indexer: "4.3.3-hotfix",
  proofServer: "8.1.0",
});

// This is not an authorization to sign, submit, or admit an order.
export function preprodConfig(env) {
  assert.equal(
    process.versions.node,
    "26.11.1",
    "Canonical isolated Node runtime required",
  );
  assert.equal(
    env.MILO_PREPROD_NETWORK_ID,
    "preprod",
    "Explicit preprod network required",
  );
  assert.match(
    env.MILO_PREPROD_GENESIS_HASH ?? "",
    /^0x[0-9a-f]{64}$/,
    "Independently pinned preprod genesis required",
  );
  assert.notEqual(env.MILO_PREPROD_GENESIS_HASH, `0x${"0".repeat(64)}`);
  const mode = env.MILO_PREPROD_MODE ?? "observe";
  assert(
    ["observe", "deployment-preflight"].includes(mode),
    "Unsupported preprod mode",
  );
  for (const key of Object.keys(env)) {
    assert(
      !key.startsWith("MILO_LOCAL_"),
      "Do not mix local and preprod profiles",
    );
    if (key.startsWith("MILO_PREPROD_")) {
      assert(
        [
          "MILO_PREPROD_NETWORK_ID",
          "MILO_PREPROD_GENESIS_HASH",
          "MILO_PREPROD_MODE",
          "MILO_PREPROD_RUNTIME_SPEC_VERSION",
          "MILO_PREPROD_ALLOW_PREFLIGHT",
          "MILO_PREPROD_ARTIFACT_SET_SHA256",
          "MILO_PREPROD_COMPILE_RECEIPT_SHA256",
          "MILO_PREPROD_PROOF_HTTP",
          // The Blockfrost token is required, and the endpoint BASES are overridable so an
          // operator can point at a local stub. The token is appended to whichever base is
          // in force, so an override cannot drop authentication.
          "MILO_PREPROD_BLOCKFROST_PROJECT_ID",
          "MILO_PREPROD_INDEXER_HTTP",
          "MILO_PREPROD_INDEXER_WS",
          "MILO_PREPROD_NODE",
          "MILO_PREPROD_NODE_WS",
        ].includes(key),
        "Unknown preprod setting",
      );
    }
  }
  // The token is required and must be a well-formed Midnight Preprod project id. A missing,
  // malformed, or Mainnet token fails closed here, before any network I/O. This replaces the
  // old "endpoints cannot be overridden" assertion: endpoints may now be pointed elsewhere,
  // but the token must be present and correct.
  blockfrostProjectId(env);
  const spec = env.MILO_PREPROD_RUNTIME_SPEC_VERSION;
  assert.match(
    spec ?? "",
    /^[1-9][0-9]*$/,
    "Independently pinned runtime spec required",
  );
  const runtimeSpecVersion = Number(spec);
  assert(Number.isSafeInteger(runtimeSpecVersion));
  let proofServer;
  let artifactSetSha256;
  let compileReceiptSha256;
  if (mode === "deployment-preflight") {
    assert.equal(
      env.MILO_PREPROD_ALLOW_PREFLIGHT,
      "owned-preprod-test-only",
      "Explicit preflight consent required",
    );
    artifactSetSha256 = env.MILO_PREPROD_ARTIFACT_SET_SHA256;
    compileReceiptSha256 = env.MILO_PREPROD_COMPILE_RECEIPT_SHA256;
    for (const hash of [artifactSetSha256, compileReceiptSha256]) {
      assert.match(
        hash ?? "",
        HEX64,
        "Approved artifact fingerprints required",
      );
      assert.notEqual(hash, "0".repeat(64), "Placeholder artifact fingerprint");
    }
    const url = new URL(env.MILO_PREPROD_PROOF_HTTP);
    assert(
      url.protocol === "http:" &&
        isLoopbackHostname(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/",
      "Proof service must be an explicitly selected loopback service",
    );
    proofServer = url.href;
  }
  // Resolve the four token-bearing Blockfrost endpoints (overridable bases, token appended).
  const endpoints = blockfrostPreprodEndpoints(env);
  return Object.freeze({
    profile: "preprod",
    mode,
    networkId: "preprod",
    walletNetworkId: "preprod",
    ...endpoints,
    genesisHash: env.MILO_PREPROD_GENESIS_HASH,
    runtimeSpecVersion,
    proofServer,
    artifactSetSha256,
    compileReceiptSha256,
  });
}

export function assertPreprodArtifactExpectations(config, artifacts) {
  assert.equal(config.mode, "deployment-preflight");
  assert.equal(artifacts.compiler, TOOLCHAIN.compiler);
  assert.equal(artifacts.language, TOOLCHAIN.language);
  assert.equal(artifacts.runtime, TOOLCHAIN.runtime);
  assert.equal(artifacts.artifactCount, 60);
  assert.equal(
    artifacts.artifactSetSha256,
    config.artifactSetSha256,
    "Unapproved artifact set",
  );
  assert.equal(
    artifacts.compileReceiptSha256,
    config.compileReceiptSha256,
    "Unapproved compiler receipt",
  );
}

export async function checkPreprodProfile(env, { request = fetch } = {}) {
  const config = preprodConfig(env);
  // Validate source, full inventory, installed cohort and approval before network I/O.
  let artifacts;
  let cohort;
  if (config.mode === "deployment-preflight") {
    artifacts = await validateArtifacts();
    assertPreprodArtifactExpectations(config, artifacts);
    cohort = await validateCohort();
  }
  const observation = await observePreprod({
    request,
    expectedGenesisHash: config.genesisHash,
    expectedRuntimeSpecVersion: config.runtimeSpecVersion,
    endpoints: config,
  });
  assert.match(
    observation.nodeVersion,
    /^1\.0\.2(?:-[0-9a-z]+)?$/,
    "Unsupported preprod node version",
  );
  return {
    scope:
      config.mode === "observe"
        ? "preprod-profile-observation"
        : "preprod-deployment-preflight-only",
    observation,
    ...(artifacts
      ? {
          artifactSetSha256: artifacts.artifactSetSha256,
          compileReceiptSha256: artifacts.compileReceiptSha256,
          cohort,
        }
      : {}),
    profileVerified: true,
    serviceExpectations: preprodServiceExpectations,
    indexerVersionVerified: false,
    proofServiceVerified: false,
    sdkCompatibilityVerified: false,
    deploymentVerified: false,
    admissionVerified: false,
    transactionsSubmitted: 0,
  };
}
