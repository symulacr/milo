import assert from "node:assert/strict";
import { mkdir, rename, rm } from "node:fs/promises";
import {
  installNativeSignalCleanup,
  ownNativeProcess,
} from "./native-processes";

const removeSignalHandlers = import.meta.main
  ? installNativeSignalCleanup()
  : () => {};

assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
const directory = ".tools/native-midnight";
const archive = `${directory}/downloads/node.tar.gz`;
await mkdir(`${directory}/downloads`, { recursive: true });
await mkdir(`${directory}/node`, { recursive: true });
const expected =
  "a3cb2e00ad074cbdac2f9f7c01400f449ec05f54941d415be868ccaae1e737bf";
const checksum = async (path: string) =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");
if (
  !(await Bun.file(archive).exists()) ||
  (await checksum(archive)) !== expected
) {
  const response = await fetch(
    "https://github.com/midnightntwrk/midnight-node/releases/download/node-1.0.0/midnight-node-1.0.0-linux-amd64.tar.gz",
  );
  assert(response.ok, `Native node download failed: ${response.status}`);
  const temporary = `${archive}.${crypto.randomUUID()}.part`;
  try {
    await Bun.write(temporary, response);
    assert.equal(
      await checksum(temporary),
      expected,
      "Native release checksum mismatch",
    );
    await rename(temporary, archive);
  } finally {
    await rm(temporary, { force: true });
  }
}
assert.equal(
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(archive).arrayBuffer())
    .digest("hex"),
  expected,
  "Native release checksum mismatch",
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
