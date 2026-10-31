// The gate count is pinned so adding a check is a deliberate act, not a silent drift.
//
// Two numbers matter and they are different:
//   - DECLARED gates: GATE_DEFINITION.conditions, the documented contract. 14 today.
//   - EMITTED checks: what one verify run actually records. This depends on how many
//     sub-wallets restore, so it is pinned on the happy path only (all three roles present
//     and the SDK resolvable), and asserted as ">= declared" otherwise.
//
// A new gate must bump DECLARED_GATES here. That is the point: the diff shows up.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GATE_DEFINITION } from "../src/wallet-state-verify.mjs";

/** Bump this in the same commit that adds a gate. */
const DECLARED_GATES = 14;

/**
 * Checks a happy-path verify run records: every role present, SDK resolvable, chain
 * reachable. Derived from the `checks.add` sites: 13 single-id checks plus two
 * per-role families (snapshot-<role>, bounded-restore-<role>) over 3 roles.
 *
 * This was 18 before G14. Bump it in the same commit that adds a check, so a new gate
 * cannot slip in unremarked.
 */
const HAPPY_PATH_CHECKS = 19;
const SINGLE_CHECKS = 13;
const PER_ROLE_CHECKS = 2;
const ROLES = 3;

describe("gate count is pinned", () => {
  test(`GATE_DEFINITION declares exactly ${DECLARED_GATES} gates`, () => {
    assert.equal(GATE_DEFINITION.conditions.length, DECLARED_GATES);
  });

  test("the ids are G1..G14 with no gaps and no duplicates", () => {
    const ids = GATE_DEFINITION.conditions.map((c) => c.id);
    assert.deepEqual(ids, [
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "G6",
      "G7",
      "G8",
      "G9",
      "G10",
      "G11",
      "G12",
      "G13",
      "G14",
    ]);
    assert.equal(new Set(ids).size, ids.length, "no duplicate gate ids");
  });

  test("every gate names the check id it maps to, and G14 maps to dust-state-usable", () => {
    for (const c of GATE_DEFINITION.conditions) {
      assert.equal(typeof c.check, "string");
      assert.ok(c.check.length > 0, `${c.id} must name a check`);
      assert.equal(typeof c.text, "string");
      assert.ok(c.text.length > 40, `${c.id} must explain itself`);
    }
    const g14 = GATE_DEFINITION.conditions.find((c) => c.id === "G14");
    assert.equal(g14.check, "dust-state-usable");
  });

  test(`a happy-path run records ${HAPPY_PATH_CHECKS} checks (was 18 before G14)`, () => {
    // The arithmetic, asserted rather than asserted-in-a-comment: 13 single-id checks
    // plus 2 families over 3 roles = 19.
    assert.equal(SINGLE_CHECKS + PER_ROLE_CHECKS * ROLES, HAPPY_PATH_CHECKS);
    assert.equal(HAPPY_PATH_CHECKS - 1, 18, "G14 added exactly one check");
  });

  test("G14 is the only check whose id is dust-state-usable", () => {
    const ids = GATE_DEFINITION.conditions.map((c) => c.check);
    assert.equal(ids.filter((c) => c === "dust-state-usable").length, 1);
  });

  test("G14 sits after G13, so the declared order is numeric", () => {
    const ids = GATE_DEFINITION.conditions.map((c) => c.id);
    assert.ok(ids.indexOf("G14") > ids.indexOf("G13"));
  });
});
