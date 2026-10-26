import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { ownNativeProcess, provisioningPreamble } from "./native-processes";
import { fetchVerified } from "./sha256-file";

const removeSignalHandlers = provisioningPreamble();
const directory = ".tools/native-midnight";
const archive = `${directory}/downloads/node.tar.gz`;
await mkdir(`${directory}/node`, { recursive: true });
const expected =
  "a3cb2e00ad074cbdac2f9f7c01400f449ec05f54941d415be868ccaae1e737bf";
const checksum = "Native release checksum mismatch";
await fetchVerified(
  "https://github.com/midnightntwrk/midnight-node/releases/download/node-1.0.0/midnight-node-1.0.0-linux-amd64.tar.gz",
  archive,
  expected,
  checksum,
);
const extraction = ownNativeProcess(
  Bun.spawn(["tar", "-xzf", archive, "-C", `${directory}/node`]),
);
assert.equal(await extraction.exited, 0);
const version = Bun.spawnSync([`${directory}/node/midnight-node`, "--version"]);
assert.equal(version.exitCode, 0);
assert.equal(version.stdout.toString().trim(), "midnight-node 1.0.0");
console.log(
  "Verified official native Midnight node 1.0.0; no network started.",
);
removeSignalHandlers();
