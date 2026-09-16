import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MID-T02 source canary: bootstrap diagnostics expose no SDK circuit-call entrypoint", async () => {
  for (const file of [
    "local.mjs",
    "bootstrap.mjs",
    "admission-observation.mjs",
    "maintenance-audit.mjs",
    "maintenance-controls.mjs",
    "recovery-worker.mjs",
    "recovery-process.mjs",
  ]) {
    const source = await readFile(
      new URL(`../src/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\bcallTx\b|\bcreateCallTx\b|\bsubmitCallTx\b/);
    assert.match(source, /reservationExecuted:\s*false/);
  }
});
