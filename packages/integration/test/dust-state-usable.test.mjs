// G14: a dust snapshot that restores can still be unusable.
//
// Upstream #425: a sync that exhausted WASM memory "corrupts DustLocalState; the next
// walletBalance() call hits RuntimeError: unreachable in the ledger WASM". `serializeState()`
// does not validate (Serialization.js calls `state.serialize()` directly) and
// `isStrictlyComplete()` is only a cursor comparison (SyncProgress.js), so a corrupted state
// reports itself synced and gets written to disk. This gate walks the restored trees, which is
// the only thing that catches it before the first fee payment.
//
// These tests import the SHIPPED `probeDustState`, not a copy of it: a test that re-implements
// the probe proves only that the copy works.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GATE_DEFINITION,
  probeDustState,
} from "../src/wallet-state-verify.mjs";

/** The exact error the ledger WASM throws on a corrupted DustLocalState (#425). */
const wasmUnreachable = () => {
  throw new Error("RuntimeError: unreachable");
};

/** A healthy dust wallet: both tree-walking calls return. */
const healthyDust = () => ({
  utxos: () => [{}, {}, {}],
  walletBalance: () => 175_000_000_000_000_000_000n,
});

/** A wallet whose WASM is corrupt: restores fine, then every tree walk traps. */
const corruptDust = () => ({
  utxos: wasmUnreachable,
  walletBalance: wasmUnreachable,
});

/**
 * The gate's own verdict rule, so the FAIL/PASS mapping is asserted rather than assumed.
 * Mirrors the `probe.status === "ok" ? "PASS" : "FAIL"` in checkBoundedRestore.
 */
const verdictOf = async (dust) => {
  try {
    const value = await probeDustState(dust);
    return { status: "PASS", value };
  } catch (error) {
    return { status: "FAIL", error: String(error?.message ?? error) };
  }
};

describe("G14 dust state usable", () => {
  // ---- fail-before / pass-after ------------------------------------------------
  // Before G14 existed, nothing read the restored state, so a corrupt snapshot passed every
  // gate and was saved. These two cases are the whole point of the guard.
  test("a healthy state PASSES and reports a real utxo count and balance", async () => {
    const v = await verdictOf(healthyDust());
    assert.equal(v.status, "PASS");
    assert.equal(v.value.utxoCount, 3);
    assert.equal(v.value.balance, "175000000000000000000");
  });

  test("a state whose WASM traps is REJECTED with the #425 error, not reported usable", async () => {
    const v = await verdictOf(corruptDust());
    assert.equal(v.status, "FAIL");
    assert.match(v.error, /RuntimeError: unreachable/);
  });

  // ---- the trap must not be swallowed into a false PASS ------------------------
  test("a utxos() that returns garbage is rejected, not silently treated as healthy", async () => {
    // Corruption can surface as a wrong shape rather than a trap. `utxos()` returning
    // undefined makes the walk throw, which is the safe outcome: the gate must not read a
    // missing tree as "zero utxos, all good".
    const v = await verdictOf({
      utxos: () => undefined,
      walletBalance: () => 0n,
    });
    assert.equal(v.status, "FAIL");
    assert.match(v.error, /undefined|length/i);
  });

  test("a state with no utxos accessor at all reports a null count rather than throwing", async () => {
    // The one shape that is legitimately not a tree walk: nothing to walk.
    const v = await verdictOf({ walletBalance: () => 0n });
    assert.equal(v.status, "PASS");
    assert.equal(v.value.utxoCount, null);
  });

  test("a state that only fails on the balance walk is still rejected", async () => {
    // utxos() succeeds, walletBalance() traps: the second walk is what #425 names, so a
    // probe that stopped after utxos() would miss this.
    const v = await verdictOf({
      utxos: () => [{}],
      walletBalance: wasmUnreachable,
    });
    assert.equal(v.status, "FAIL");
    assert.match(v.error, /unreachable/);
  });

  test("a state that only fails on the utxo walk is still rejected", async () => {
    const v = await verdictOf({
      utxos: wasmUnreachable,
      walletBalance: () => 1n,
    });
    assert.equal(v.status, "FAIL");
    assert.match(v.error, /unreachable/);
  });

  test("a state exposing utxos on .state is read too", async () => {
    // The wallet exposes utxos() at the top level today; the probe also accepts the
    // nested shape so an SDK reshuffle does not silently turn the gate into a no-op.
    const v = await verdictOf({
      state: { utxos: [{}, {}] },
      walletBalance: () => 5n,
    });
    assert.equal(v.status, "PASS");
    assert.equal(v.value.utxoCount, 2);
  });

  // ---- the gate is declared, and the count is pinned ---------------------------
  test("is a declared gate condition with the #425 wording", () => {
    const g14 = GATE_DEFINITION.conditions.find((c) => c.id === "G14");
    assert.ok(g14, "G14 must be in GATE_DEFINITION");
    assert.equal(g14.check, "dust-state-usable");
    assert.match(g14.text, /walletBalance/);
    assert.match(g14.text, /#425/);
    assert.match(g14.text, /WASM/);
  });

  test("names the batch knob and its documented value", () => {
    const g14 = GATE_DEFINITION.conditions.find((c) => c.id === "G14");
    assert.match(g14.text, /batchUpdates\.size/);
    assert.match(g14.text, /5000/);
  });

  test("G13 is still present: this adds a gate, it does not replace one", () => {
    const ids = GATE_DEFINITION.conditions.map((c) => c.id);
    assert.ok(ids.includes("G14"));
    assert.ok(ids.includes("G13"));
  });
});
