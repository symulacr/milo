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
const ci = spawnSync(
  npm,
  ["ci", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"],
  { stdio: "inherit" },
);
assert.equal(ci.status, 0, "npm ci failed for packages/integration");
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
  "sh",
  ["scripts/with-bun.sh", "scripts/native-node-smoke.ts", ...lane],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
