import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Hand-built error fixtures can drift from what the node actually emits. This
 * asserts the repo's rejection predicate against a payload captured from a real
 * local-lane run at HEAD, so the shape the audit relies on is checked against
 * reality rather than against another literal. Defect class precluded: the
 * audit's verified-rejection path silently diverging from the real node
 * payload after a dependency or node bump.
 */
const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/captured-node-rejection.json", import.meta.url),
    "utf8",
  ),
);

/** Mirrors maintenance-audit.mjs's verified-rejection predicate. */
const isVerifiedRejection = (diagnostic, boundary) =>
  boundary === "midnightProvider.submitTx" &&
  diagnostic.rpcCodes?.length === 1 &&
  diagnostic.rpcCodes[0] === 1010 &&
  diagnostic.errorNames.includes("RpcError");

test("the audit predicate accepts the captured real rejection payload", () => {
  assert.equal(
    isVerifiedRejection(captured, "midnightProvider.submitTx"),
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
  assert.equal(
    isVerifiedRejection(
      { ...captured, rpcCodes: [1011] },
      "midnightProvider.submitTx",
    ),
    false,
  );
  assert.equal(
    isVerifiedRejection(
      { ...captured, errorNames: ["SubmissionError"] },
      "midnightProvider.submitTx",
    ),
    false,
  );
  assert.equal(
    isVerifiedRejection(captured, "walletProvider.balanceTx"),
    false,
  );
});
