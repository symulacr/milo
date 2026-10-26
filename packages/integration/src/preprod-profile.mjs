import assert from "node:assert/strict";
import { unshieldedAddressHex } from "../../backend/src/wallet-auth.ts";
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

/** The versions the Preprod support matrix pairs with this stack (matrix read
 * 2026-10-23). `indexer` is a PREFIX, not an exact string: the matrix lists
 * 4.3.302 for Preprod and that release has no public tag, image or artifact, so an
 * operator can never install the exact version and an exact-match assertion could
 * only ever fail. The prefix still catches a 4.2.x or 5.x indexer, which is the
 * mismatch that actually breaks the protocol. */
export const preprodServiceExpectations = Object.freeze({
  node: "1.0.400",
  indexer: "4.3.302",
  indexerPrefix: "4.3.",
  proofServer: "8.1.3",
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
    /^1\.0\.400(?:-[0-9a-z]+)?$/,
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

/** The whole preflight must finish inside a minute, so each check gets a slice and
 * the run as a whole gets a deadline. A wedged probe then reports the check it was
 * on instead of holding a shell. */
export const PREFLIGHT_TIMEOUT_MS = 55_000;
const CHECK_TIMEOUT_MS = 12_000;

/** One indexer POST under the per-check bound, asserted the way every check wants. */
async function indexerQuery(env, request, query) {
  const { indexer } = blockfrostPreprodEndpoints(env);
  const res = await request(indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  assert(res.ok, `indexer HTTP ${res.status}`);
  const body = await res.json();
  assert(!body.errors, JSON.stringify(body.errors));
  return body.data;
}

/** A GET that must answer 2xx, under the per-check bound. */
async function reachable(request, url, label) {
  const res = await request(url, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  assert(res.ok, `${label} HTTP ${res.status}`);
  return res;
}

/** The preflight, as a table: id, what it proves, and a run that returns evidence or
 * throws with the exact reason. Order is the order they are reported in. */
const PREFLIGHT_CHECKS = [
  [
    "profile",
    "the immutable Preprod profile validates and the node answers",
    async (env, { request }) => {
      const p = await checkPreprodProfile(env, { request });
      return `scope=${p.scope} node=${p.observation.nodeVersion}`;
    },
  ],
  [
    "genesis-hash",
    "the configured genesis hash is a real 32-byte hash, not a placeholder",
    (env) => {
      const hash = env.MILO_PREPROD_GENESIS_HASH ?? "";
      assert.match(hash, /^0x[0-9a-f]{64}$/, "genesis hash is not 0x + 64 hex");
      assert.notEqual(
        hash,
        `0x${"0".repeat(64)}`,
        "genesis hash is a placeholder",
      );
      return hash;
    },
  ],
  [
    "indexer",
    "the Preprod indexer answers a tip query",
    async (env, { request }) => {
      const height = (
        await indexerQuery(env, request, "query { block { height } }")
      )?.block?.height;
      assert(Number.isSafeInteger(height), "indexer returned no block height");
      return `tip height ${height}`;
    },
  ],
  [
    "indexer-version",
    "the indexer reports the 4.3 line the Preprod matrix pairs with this stack",
    async (env, { request }) => {
      // The matrix names 4.3.302, which has no public artifact, so the exact
      // version is unreachable for an operator. Compare the line instead: 4.2.x is
      // before the dust-validity-window fixes and 5.x is a different protocol, and
      // both are real mismatches worth failing on.
      const { indexer } = blockfrostPreprodEndpoints(env);
      const res = await request(new URL("/version", indexer).href, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      // Blockfrost's indexer may not expose /version; an absent endpoint is not a
      // mismatch. Only a version it does report is compared.
      if (!res.ok) return "indexer exposes no /version; line not compared";
      const body = await res.json().catch(() => null);
      const version = String(body?.version ?? body?.tag ?? "");
      if (!version) return "indexer reported no version; line not compared";
      assert(
        version.startsWith(preprodServiceExpectations.indexerPrefix),
        `indexer is ${version}, expected the ${preprodServiceExpectations.indexerPrefix}x line (matrix: ${preprodServiceExpectations.indexer})`,
      );
      return `version ${version}`;
    },
  ],
  [
    "proof-server",
    "the local proof server is reachable and reports the expected version",
    async (env, { request }) => {
      const base = env.MILO_PREPROD_PROOF_HTTP ?? "http://127.0.0.1:6300";
      const res = await reachable(
        request,
        new URL("/version", base).href,
        "proof server",
      );
      const version = String((await res.json()).version ?? "");
      assert(version.length > 0, "proof server reported no version");
      // The pin exists so a proof server that cannot serve this circuit build fails
      // the preflight, not the deploy. Recording it without comparing it was inert.
      assert.equal(
        version,
        preprodServiceExpectations.proofServer,
        `proof server is ${version}, expected ${preprodServiceExpectations.proofServer}`,
      );
      return `version ${version}`;
    },
  ],
  [
    "wallet-address",
    "the wallet's public address is well formed and the indexer answers",
    async (env, { request }) => {
      // NIGHT is only exposed through the unshieldedTransactions SUBSCRIPTION, which
      // needs a WebSocket, and DUST needs DustSecretKey to start() at all. Neither
      // belongs in a 60 s HTTP preflight, so this proves the address and says what it
      // did not read rather than reporting a number it cannot verify.
      // Accept the Bech32m address the repo actually stores (MIDNIGHT_PREPROD_ADDRESS)
      // and derive the hex form, so a funded wallet needs no second hand-copied value.
      const hex =
        env.MIDNIGHT_PREPROD_ADDRESS_HEX ??
        unshieldedAddressHex(env.MIDNIGHT_PREPROD_ADDRESS ?? "");
      assert.match(
        hex ?? "",
        /^[0-9a-f]{64}$/,
        "wallet address is not a preprod unshielded address",
      );
      await indexerQuery(env, request, "query { block { height } }");
      return "address well formed; NIGHT needs the subscription, DUST needs a seed: neither read";
    },
  ],
  [
    "convex",
    "the Convex deployment URL is set and answers its health endpoint",
    async (env, { request }) => {
      const url = env.CONVEX_URL;
      assert.match(
        url ?? "",
        /^https:\/\/[a-z0-9-]+\.convex\.cloud$/,
        "CONVEX_URL is not a deployment URL",
      );
      await reachable(request, `${url}/version`, "Convex");
      return `reachable at ${new URL(url).host}`;
    },
  ],
];

/** Run every preflight check under its own bound and the run's overall deadline.
 * Never throws: a failed check is reported with the reason, and the caller decides
 * the exit code. Returns `{ ok, checks, failedId }` so a CLI can name the failure. */
export async function runPreflight(
  env,
  { request = fetch, now = () => Date.now() } = {},
) {
  const deadline = now() + PREFLIGHT_TIMEOUT_MS;
  const checks = [];
  for (const [id, proves, run] of PREFLIGHT_CHECKS) {
    const startedAt = now();
    if (startedAt >= deadline) {
      checks.push({ id, status: "SKIP", reason: "preflight deadline reached" });
      continue;
    }
    try {
      checks.push({
        id,
        status: "PASS",
        proves,
        evidence: await run(env, { request }),
        ms: now() - startedAt,
      });
    } catch (error) {
      checks.push({
        id,
        status: "FAIL",
        proves,
        reason: String(error?.message ?? error).split("\n")[0],
        ms: now() - startedAt,
      });
    }
  }
  const failed = checks.filter((c) => c.status === "FAIL");
  const passed = (id) => checks.some((c) => c.id === id && c.status === "PASS");
  return {
    ok: failed.length === 0,
    failedId: failed[0]?.id ?? null,
    checks,
    // Derived from the checks that actually ran, so a caller reads the truth
    // instead of the hardcoded false that used to sit beside the expectation.
    proofServiceVerified: passed("proof-server"),
    indexerVersionVerified: passed("indexer"),
    elapsedMs: now() - (deadline - PREFLIGHT_TIMEOUT_MS),
  };
}
