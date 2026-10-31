// The dust sync batch size is the documented workaround for upstream #425.
//
// Maintainer: "if you increase the batch size this fixes the issue. In my tests, I set the
// batch size to 5000 and it avoided the above mentioned error." The knob is
// `DefaultSyncConfiguration.batchUpdates.size` (wallet-sdk-dust-wallet Sync.d.ts), read in
// Sync.js as `config.batchUpdates?.size ?? 10`. The default of 10 is what we were running.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const LANE = new URL("../src/preprod-lane.mjs", import.meta.url);
const VERIFY = new URL("../src/wallet-state-verify.mjs", import.meta.url);

describe("dust sync batch size", () => {
  test("the lane sets batchUpdates.size to 5000, not the SDK default of 10", () => {
    const src = readFileSync(LANE, "utf8");
    const m = src.match(/batchUpdates:\s*Object\.freeze\(\{\s*size:\s*(\d+)/);
    assert.ok(m, "the lane must define batchUpdates with an explicit size");
    assert.equal(Number(m[1]), 5000);
  });

  test("the lane passes that config to the wallet facade", () => {
    const src = readFileSync(LANE, "utf8");
    assert.match(
      src,
      /batchUpdates:\s*\{\s*\.\.\.SYNC_TUNING\.batchUpdates\s*\}/,
    );
  });

  test("the verify path also uses 5000, so a restore is exercised the same way", () => {
    const src = readFileSync(VERIFY, "utf8");
    const m = src.match(/batchUpdates:\s*\{\s*size:\s*(\d+)/);
    assert.ok(m, "wallet-state-verify must set batchUpdates.size");
    assert.equal(Number(m[1]), 5000);
  });

  test("spacing is 0 in the lane: injected delay is pure overhead on a genesis replay", () => {
    const src = readFileSync(LANE, "utf8");
    const m = src.match(
      /batchUpdates:\s*Object\.freeze\(\{[^}]*spacing:\s*(\d+)/,
    );
    assert.ok(m);
    assert.equal(Number(m[1]), 0);
  });
});
