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
const archive = `${directory}/node-v26.11.1-linux-x64.tar.xz`;
const expected =
  "3883bfc73f9a680ca4eab04b196068aaaab1373ffa77d8fc1a4408222495b651";
await mkdir(directory, { recursive: true });
if (
  !(await Bun.file(archive).exists()) ||
  (await sha256File(archive)) !== expected
) {
  const response = await fetch(
    "https://nodejs.org/dist/v26.11.1/node-v26.11.1-linux-x64.tar.xz",
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
  `${directory}/node-v26.11.1-linux-x64/bin/node`,
);
const version = Bun.spawnSync([integrationNode, "--version"]);
assert.equal(version.exitCode, 0);
assert.equal(version.stdout.toString().trim(), "v26.11.1");
console.log("Verified plan-pinned isolated Node.js 26.11.1 runtime.");
removeSignalHandlers();
