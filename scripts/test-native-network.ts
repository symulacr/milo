import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { installIntegration } from "./setup-integration-runtime";

installIntegration();
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
