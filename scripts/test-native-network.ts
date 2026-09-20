// Runs the REAL local Midnight lane: the pinned Node 24.20.0 runtime, the
// integration package's own dependency set, the pinned native node/indexer/
// prover services, then local.mjs with the documented staged flags. This is
// the only automated path that exercises real proof generation and submission;
// the integration test lane uses stub submits by design.
//
// Usage: sh scripts/with-bun.sh scripts/test-native-network.ts [lane flags]
//   default flags: --with-services --transactions --staged-bootstrap
//   receipts also use: --maintenance-audit --maintenance-controls
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { integrationNode } from "./setup-integration-runtime";

const prefix = "packages/integration";
assert(
  existsSync(resolve(prefix, "package-lock.json")),
  "run from the repository root: packages/integration/package-lock.json not found",
);

// The lane's own runtime and dependency set (own lockfile, pinned Node).
const npm = resolve(dirname(integrationNode), "npm");
const ci = spawnSync(
  npm,
  ["ci", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"],
  { stdio: "inherit" },
);
assert.equal(ci.status, 0, "npm ci failed for packages/integration");

// Native services are provisioned once; the lane start verifies them.
if (!existsSync(".tools/native-midnight")) {
  const node = spawnSync(
    "sh",
    ["scripts/with-bun.sh", "scripts/setup-native-node.ts"],
    { stdio: "inherit" },
  );
  assert.equal(node.status, 0, "native node provisioning failed");
  const services = spawnSync("python3", ["scripts/setup-native-services.py"], {
    stdio: "inherit",
  });
  assert.equal(services.status, 0, "native service provisioning failed");
}

const flags = process.argv.slice(2);
const lane = flags.length
  ? flags
  : ["--with-services", "--transactions", "--staged-bootstrap"];
const run = spawnSync(
  integrationNode,
  ["packages/integration/src/local.mjs", ...lane],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
