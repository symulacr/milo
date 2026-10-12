import assert from "node:assert/strict";
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  installNativeSignalCleanup,
  ownNativeProcess,
} from "./native-processes";
import { sha256File } from "./sha256-file";

const removeSignalHandlers = import.meta.main
  ? installNativeSignalCleanup()
  : () => {};

assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
const directory = ".tools/node-runtime";
const archive = `${directory}/node-v24.20.0-linux-x64.tar.xz`;
const expected =
  "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2";
await mkdir(directory, { recursive: true });
if (
  !(await Bun.file(archive).exists()) ||
  (await sha256File(archive)) !== expected
) {
  const response = await fetch(
    "https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz",
  );
  assert(response.ok);
  const temporary = `${archive}.${crypto.randomUUID()}.part`;
  try {
    await Bun.write(temporary, response);
    assert.equal(await sha256File(temporary), expected);
    await rename(temporary, archive);
  } finally {
    await rm(temporary, { force: true });
  }
}
assert.equal(await sha256File(archive), expected);
assert.equal(
  await ownNativeProcess(Bun.spawn(["tar", "-xJf", archive, "-C", directory]))
    .exited,
  0,
);
export const integrationNode = resolve(
  `${directory}/node-v24.20.0-linux-x64/bin/node`,
);
const version = Bun.spawnSync([integrationNode, "--version"]);
assert.equal(version.exitCode, 0);
assert.equal(version.stdout.toString().trim(), "v24.20.0");
console.log("Verified plan-pinned isolated Node.js 24.20.0 runtime.");
removeSignalHandlers();
