import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ownNativeProcess, provisioningPreamble } from "./native-processes";
import { fetchVerified } from "./sha256-file";

const removeSignalHandlers = provisioningPreamble();
const directory = ".tools/node-runtime";
const archive = `${directory}/node-v26.11.1-linux-x64.tar.xz`;
const expected =
  "3883bfc73f9a680ca4eab04b196068aaaab1373ffa77d8fc1a4408222495b651";
await fetchVerified(
  "https://nodejs.org/dist/v26.11.1/node-v26.11.1-linux-x64.tar.xz",
  archive,
  expected,
);
assert.equal(
  await ownNativeProcess(Bun.spawn(["tar", "-xJf", archive, "-C", directory]))
    .exited,
  0,
);
export const integrationNode = resolve(
  `${directory}/node-v26.11.1-linux-x64/bin/node`,
);
const version = Bun.spawnSync([integrationNode, "--version"]);
assert.equal(version.exitCode, 0);
assert.equal(version.stdout.toString().trim(), "v26.11.1");
console.log("Verified plan-pinned isolated Node.js 26.11.1 runtime.");
removeSignalHandlers();

/** Installs the integration package from its lockfile with the pinned Node. */
export function installIntegration() {
  const prefix = "packages/integration";
  assert(
    existsSync(resolve(prefix, "package-lock.json")),
    "run from the repository root: packages/integration/package-lock.json not found",
  );
  const ci = spawnSync(
    resolve(dirname(integrationNode), "npm"),
    ["ci", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"],
    { stdio: "inherit" },
  );
  assert.equal(ci.status, 0, "npm ci failed for packages/integration");
  return integrationNode;
}
