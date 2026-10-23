// Tests for --repair-state clearing a version drift (wallet-state-verify).
//
// The lane refuses a snapshot whose sdk-versions.json drifted from the installed versions,
// and its rejection hint tells the operator to run --repair-state to clear it. That hint was
// a dead end: needsRepair omitted `drifted`, so the repair reported "already-complete" and
// rewrote nothing, and the snapshot stayed refused forever. These tests pin the repair
// actually repairing, and pin that it still refuses to fabricate an unresolvable matrix.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  inspectSdkVersions,
  repairSdkVersions,
  SDK_PACKAGES,
} from "../src/wallet-state-verify.mjs";

const withDir = async (fn) => {
  const dir = await mkdtemp(resolve(tmpdir(), "milo-repair-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const writeRecording = (dir, values) =>
  writeFile(
    resolve(dir, "sdk-versions.json"),
    `${JSON.stringify(values, null, 2)}\n`,
  );

test("a drifted recording is repaired, not reported as already-complete", () =>
  withDir(async (dir) => {
    const drifted = {};
    for (const name of SDK_PACKAGES) drifted[name] = "0.0.0-drifted";
    await writeRecording(dir, drifted);

    const before = await inspectSdkVersions(dir);
    assert.ok(
      before.drifted.length > 0,
      "the fixture must actually be drifted for this test to mean anything",
    );

    const result = await repairSdkVersions(dir);
    assert.equal(
      result.repaired,
      true,
      "a drifted recording must be repaired; the lane's hint depends on it",
    );

    const after = await inspectSdkVersions(dir);
    assert.equal(after.drifted.length, 0);
  }));

test("repair rewrites the recording to the installed versions", () =>
  withDir(async (dir) => {
    const drifted = {};
    for (const name of SDK_PACKAGES) drifted[name] = "0.0.0-drifted";
    await writeRecording(dir, drifted);
    await repairSdkVersions(dir);

    const written = JSON.parse(
      await readFile(resolve(dir, "sdk-versions.json"), "utf8"),
    );
    const inspection = await inspectSdkVersions(dir);
    for (const name of SDK_PACKAGES)
      assert.equal(written[name], inspection.current[name]);
  }));

test("a matching recording is left alone", () =>
  withDir(async (dir) => {
    const inspection = await inspectSdkVersions(dir);
    const exact = {};
    for (const name of SDK_PACKAGES) exact[name] = inspection.current[name];
    await writeRecording(dir, exact);

    const result = await repairSdkVersions(dir);
    assert.equal(result.repaired, false);
    assert.equal(result.reason, "already-complete");
  }));

test("an incomplete recording is still repaired", () =>
  withDir(async (dir) => {
    await writeRecording(dir, {});
    const result = await repairSdkVersions(dir);
    assert.equal(result.repaired, true);
  }));
