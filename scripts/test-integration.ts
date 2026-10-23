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
const npm = resolve(dirname(integrationNode), "npm");
const install = spawnSync(
  npm,
  ["ci", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"],
  { stdio: "inherit" },
);
assert.equal(install.status, 0, "npm ci failed for packages/integration");
const test = spawnSync(
  integrationNode,
  ["--test", `${prefix}/test/*.test.mjs`, "--test-reporter=dot"],
  { stdio: "inherit" },
);
process.exit(test.status ?? 1);
