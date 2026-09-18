// Runs packages/integration under its own pinned runtime: the suite's package
// set is provisioned by `npm ci` from its own lockfile (its order.mjs Node hook
// exists to prevent duplicate ledger-WASM identities with the root graph), and
// artifacts.mjs hard-asserts the plan-pinned Node 24.20.0 that
// setup-integration-runtime provisions and verifies.
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

// npm ci is idempotent: it removes node_modules and reinstalls exactly from
// package-lock.json, failing if the lockfile is out of sync with package.json.
const npm = resolve(dirname(integrationNode), "npm");
const install = spawnSync(
  npm,
  ["ci", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"],
  { stdio: "inherit" },
);
assert.equal(install.status, 0, "npm ci failed for packages/integration");

// The literal glob is expanded natively by the Node 24 test runner, so no
// shell is spawned and glob semantics are independent of the invoking shell.
const test = spawnSync(
  integrationNode,
  ["--test", `${prefix}/test/*.test.mjs`, "--test-reporter=dot"],
  { stdio: "inherit" },
);
process.exit(test.status ?? 1);
