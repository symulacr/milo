import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifiedAuthorityRejection } from "../src/maintenance-audit.mjs";

/**
 * Hand-built error fixtures can drift from what the node actually emits. This
 * asserts the audit's OWN predicate - imported, not re-implemented - against a
 * payload captured from a real local-lane run, so the shape the audit relies on
 * is checked against reality rather than against another literal. Defect class
 * precluded: the audit's verified-rejection gate silently diverging from the
 * real node payload after a dependency or node bump.
 */
const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/captured-node-rejection.json", import.meta.url),
    "utf8",
  ),
);

test("the audit predicate accepts the captured real rejection payload", () => {
  assert.equal(
    verifiedAuthorityRejection(captured, "midnightProvider.submitTx"),
    true,
  );
});

test("the captured payload carries the exact fields the audit reads", () => {
  assert.deepEqual(captured.rpcCodes, [1010]);
  assert.deepEqual(captured.runtimeCustomCodes, [134]);
  assert.equal(captured.conclusion, "KeyNotInCommittee");
  assert.equal(captured.unchanged, true);
  assert.match(captured.stateSha256, /^[a-f0-9]{64}$/);
});

test("the predicate rejects near-miss variants of the captured payload", () => {
  const boundary = "midnightProvider.submitTx";
  assert.equal(
    verifiedAuthorityRejection({ ...captured, rpcCodes: [1011] }, boundary),
    false,
  );
  assert.equal(
    verifiedAuthorityRejection(
      { ...captured, errorNames: ["SubmissionError"] },
      boundary,
    ),
    false,
  );
  assert.equal(
    verifiedAuthorityRejection(
      { ...captured, runtimeCustomCodes: [108] },
      boundary,
    ),
    false,
  );
  assert.equal(
    verifiedAuthorityRejection(captured, "walletProvider.balanceTx"),
    false,
  );
});
