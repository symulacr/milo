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
const TOKEN = `nightpreprod${"a".repeat(24)}`;
const env = {
  MILO_PREPROD_NETWORK_ID: "preprod",
  MILO_PREPROD_GENESIS_HASH: `0x${hash}`,
  MILO_PREPROD_RUNTIME_SPEC_VERSION: "1000000",
  MILO_PREPROD_BLOCKFROST_PROJECT_ID: TOKEN,
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
  // Endpoints are the Blockfrost bases with the token appended exactly once. Compare on the
  // parsed URL, since a bare-host base canonicalises to a trailing slash.
  for (const [key, base] of Object.entries(preprodEndpoints)) {
    const expected = new URL(base);
    expected.searchParams.set("project_id", TOKEN);
    assert.equal(
      config[key],
      expected.href,
      `endpoint ${key} must be the Blockfrost base plus the token`,
    );
    assert.equal(
      new URL(config[key]).searchParams.getAll("project_id").length,
      1,
    );
  }
  assert.throws(() => localConfig(env));
  assert.equal(preprodConfig(deployEnv).proofServer, "http://127.0.0.1:6300/");
});

test("preprod endpoints honour an explicit base override and still carry the token once", () => {
  const config = preprodConfig({
    ...env,
    MILO_PREPROD_INDEXER_HTTP: "http://127.0.0.1:9999/api/v4/graphql",
  });
  assert.equal(
    config.indexer,
    `http://127.0.0.1:9999/api/v4/graphql?project_id=${TOKEN}`,
  );
  // The non-overridden endpoints stay on the Blockfrost base.
  const expectedNode = new URL(preprodEndpoints.node);
  expectedNode.searchParams.set("project_id", TOKEN);
  assert.equal(config.node, expectedNode.href);
});

// The same 26 rejection cases, one test each. `node:test` has no `test.each`, so the
// loop is the table: every case keeps its own named test and its own two assertions.
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
  missingToken: { MILO_PREPROD_BLOCKFROST_PROJECT_ID: undefined },
  emptyToken: { MILO_PREPROD_BLOCKFROST_PROJECT_ID: "   " },
  mainnetToken: {
    MILO_PREPROD_BLOCKFROST_PROJECT_ID: `nightmainnet${"a".repeat(24)}`,
  },
  wrongPrefixToken: {
    MILO_PREPROD_BLOCKFROST_PROJECT_ID: `preprod${"a".repeat(24)}`,
  },
  malformedToken: { MILO_PREPROD_BLOCKFROST_PROJECT_ID: "nightpreprod!!" },
  tokenWithSpace: { MILO_PREPROD_BLOCKFROST_PROJECT_ID: "nightpreprod abc" },
  unknownSetting: { MILO_PREPROD_TYPO: "x" },
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
        system_version: "1.0.400-test",
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

test("the wallet-address check accepts the bech32 address the repo stores", async () => {
  // MIDNIGHT_PREPROD_ADDRESS is what .env.preprod holds; the hex form is derived,
  // so a funded wallet needs no second hand-copied value. Assert the derivation.
  const { unshieldedAddressHex } = await import(
    "../../backend/src/wallet-auth.ts"
  );
  const bech32 =
    "mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7";
  assert.match(unshieldedAddressHex(bech32) ?? "", /^[0-9a-f]{64}$/);
  // A mainnet or truncated address must not pass as a Preprod unshielded address.
  assert.equal(
    unshieldedAddressHex(bech32.replace("preprod", "mainnet")),
    null,
  );
  assert.equal(unshieldedAddressHex(bech32.slice(0, -1)), null);
});

// C-10: the proof-server pin existed but was never compared, so a wrong version
// passed the preflight and failed deep inside the deploy instead.
test("the preflight compares the proof server version against the pin", async () => {
  const { runPreflight, preprodServiceExpectations } = await import(
    "../src/preprod-profile.mjs"
  );
  const proofEnv = {
    ...env,
    MILO_PREPROD_PROOF_HTTP: "http://127.0.0.1:6300",
  };
  const request = async (url) => {
    if (String(url).includes("/version"))
      return { ok: true, json: async () => ({ version: "0.0.1-wrong" }) };
    return {
      ok: true,
      json: async () => ({ data: { block: { height: 32, hash } } }),
    };
  };
  const wrong = await runPreflight(proofEnv, { request });
  const proof = wrong.checks.find((check) => check.id === "proof-server");
  assert.equal(proof.status, "FAIL");
  assert.match(proof.reason, /expected/);
  assert.equal(wrong.proofServiceVerified, false);

  const right = await runPreflight(proofEnv, {
    request: async (url) =>
      String(url).includes("/version")
        ? {
            ok: true,
            json: async () => ({
              version: preprodServiceExpectations.proofServer,
            }),
          }
        : {
            ok: true,
            json: async () => ({ data: { block: { height: 32, hash } } }),
          },
  });
  assert.equal(
    right.checks.find((check) => check.id === "proof-server").status,
    "PASS",
  );
  assert.equal(right.proofServiceVerified, true);
});

// The Preprod matrix (2026-10-23) pairs node 1.0.400 / indexer 4.3.302 / proof server
// 8.1.3 with this stack. The old pins were 1.0.2 / 4.3.3-hotfix / 8.1.0, and
// 4.3.3-hotfix is marked superseded upstream, so a preflight accepting it was
// certifying a tag the vendor says not to deploy on.
test("the version pins match the Preprod support matrix", async () => {
  const { preprodServiceExpectations } = await import(
    "../src/preprod-profile.mjs"
  );
  assert.equal(preprodServiceExpectations.node, "1.0.400");
  assert.equal(preprodServiceExpectations.indexer, "4.3.302");
  assert.equal(preprodServiceExpectations.proofServer, "8.1.3");
  // The indexer is compared by line, because 4.3.302 has no public artifact.
  assert.equal(preprodServiceExpectations.indexerPrefix, "4.3.");
  assert(
    preprodServiceExpectations.indexer.startsWith(
      preprodServiceExpectations.indexerPrefix,
    ),
  );
});

// The indexer check must compare the line when a version is reported and stay
// silent when the endpoint has none: Blockfrost does not have to expose /version,
// and an absent endpoint is not a protocol mismatch.
test("the indexer check compares the 4.3 line and tolerates no /version", async () => {
  const { runPreflight } = await import("../src/preprod-profile.mjs");
  const indexerEnv = {
    ...env,
    MILO_PREPROD_PROOF_HTTP: "http://127.0.0.1:6300",
  };
  const withVersion = (version, ok = true) =>
    runPreflight(indexerEnv, {
      request: async (url) => {
        if (String(url).includes("/version")) {
          if (version === undefined) return { ok: false, status: 404 };
          return { ok, json: async () => ({ version }) };
        }
        return {
          ok: true,
          json: async () => ({ data: { block: { height: 32, hash } } }),
        };
      },
    });
  const check = (result) =>
    result.checks.find((entry) => entry.id === "indexer-version");

  assert.equal(check(await withVersion("4.3.302")).status, "PASS");
  assert.equal(check(await withVersion("4.3.5")).status, "PASS");
  // A 4.2 indexer predates the dust-validity-window fixes; 5.x is a new protocol.
  for (const wrong of ["4.2.9", "5.0.0"]) {
    const failed = check(await withVersion(wrong));
    assert.equal(failed.status, "FAIL");
    assert.match(failed.reason, /expected the 4\.3\.x line/);
  }
  // No /version endpoint is not a mismatch.
  assert.equal(check(await withVersion(undefined)).status, "PASS");
});
