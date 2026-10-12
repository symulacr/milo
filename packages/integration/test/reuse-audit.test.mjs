import assert from "node:assert/strict";
import test from "node:test";
import {
  bestLowCost,
  bestPrototype,
  DEPENDENCY_WEIGHT,
  isLowCost,
  normalizePrototype,
  RISK_MULTIPLIER,
  RUN_PENALTY,
  rankPrototypes,
  rawYield,
  scorePrototype,
  summarize,
} from "../src/reuse-audit.mjs";

// The measured prototypes. Numbers come from the scratch copies under /tmp
// (wc -l deltas) and the dependency-copy counts from the integration lock.
// They are inputs, not assertions: the tests below check the arithmetic.
const MEASURED = [
  {
    id: "ws-global",
    name: "ws -> Node global WebSocket",
    linesRemoved: 8,
    dependencyCopiesRemoved: 0,
    risk: "high",
    gatesPass: true,
    needsRun: true,
  },
  {
    id: "graphql-ws-handrolled",
    name: "graphql-ws -> hand-rolled client",
    linesRemoved: -28,
    dependencyCopiesRemoved: 0,
    risk: "high",
    gatesPass: true,
    needsRun: true,
  },
  {
    id: "polkadot-removal",
    name: "@polkadot/api removal",
    linesRemoved: 0,
    dependencyCopiesRemoved: 0,
    risk: "high",
    gatesPass: true,
    needsRun: true,
  },
  {
    id: "sha256-consolidation",
    name: "26 sha256 helpers -> one per package",
    linesRemoved: 9,
    dependencyCopiesRemoved: 0,
    risk: "low",
    gatesPass: true,
    needsRun: false,
  },
  {
    id: "parseargs",
    name: "node:util.parseArgs for CLI parsing",
    linesRemoved: 2,
    dependencyCopiesRemoved: 0,
    risk: "low",
    gatesPass: true,
    needsRun: false,
  },
  {
    id: "dup-helpers",
    name: "duplicate graphql/withTimeout/AbortSignal helpers",
    linesRemoved: 23,
    dependencyCopiesRemoved: 0,
    risk: "low",
    gatesPass: true,
    needsRun: false,
  },
];

test("normalizePrototype rejects malformed input rather than scoring it zero", () => {
  assert.throws(() => normalizePrototype(null), TypeError);
  assert.throws(() => normalizePrototype({}), TypeError);
  assert.throws(
    () =>
      normalizePrototype({
        id: "x",
        name: "x",
        linesRemoved: 1.5,
        risk: "low",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      normalizePrototype({
        id: "x",
        name: "x",
        linesRemoved: 1,
        dependencyCopiesRemoved: -1,
        risk: "low",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      normalizePrototype({
        id: "x",
        name: "x",
        linesRemoved: 1,
        risk: "extreme",
      }),
    TypeError,
  );
  const ok = normalizePrototype({
    id: "x",
    name: "x",
    linesRemoved: 1,
    risk: "low",
    gatesPass: true,
    needsRun: true,
  });
  assert.equal(ok.dependencyCopiesRemoved, 0);
  assert.equal(ok.gatesPass, true);
  assert.equal(ok.needsRun, true);
});

test("rawYield values dependency copies and the run penalty", () => {
  assert.equal(
    rawYield({ id: "a", name: "a", linesRemoved: 10, risk: "low" }),
    10,
  );
  assert.equal(
    rawYield({
      id: "a",
      name: "a",
      linesRemoved: 10,
      dependencyCopiesRemoved: 2,
      risk: "low",
    }),
    10 + 2 * DEPENDENCY_WEIGHT,
  );
  assert.equal(
    rawYield({
      id: "a",
      name: "a",
      linesRemoved: 10,
      risk: "low",
      needsRun: true,
    }),
    10 - RUN_PENALTY,
  );
});

test("scorePrototype zeroes a prototype whose gates fail", () => {
  const failing = {
    id: "a",
    name: "a",
    linesRemoved: 100,
    risk: "low",
    gatesPass: false,
  };
  assert.equal(scorePrototype(failing), 0);
  const passing = { ...failing, gatesPass: true };
  assert.equal(scorePrototype(passing), 100);
});

test("risk multiplier orders low above medium above high for equal yield", () => {
  const base = { name: "n", linesRemoved: 100, gatesPass: true };
  const low = scorePrototype({ ...base, id: "low", risk: "low" });
  const medium = scorePrototype({ ...base, id: "med", risk: "medium" });
  const high = scorePrototype({ ...base, id: "high", risk: "high" });
  assert.equal(low, 100 * RISK_MULTIPLIER.low);
  assert.equal(medium, 100 * RISK_MULTIPLIER.medium);
  assert.equal(high, 100 * RISK_MULTIPLIER.high);
  assert.ok(low > medium && medium > high);
});

test("rankPrototypes is total and deterministic across ties", () => {
  const tied = [
    { id: "b", name: "b", linesRemoved: 5, risk: "low", gatesPass: true },
    { id: "a", name: "a", linesRemoved: 5, risk: "low", gatesPass: true },
  ];
  assert.deepEqual(
    rankPrototypes(tied).map((p) => p.id),
    ["a", "b"],
  );
});

test("bestPrototype of the measured set is the low-risk duplicate-helper collapse", () => {
  const best = bestPrototype(MEASURED);
  assert.equal(best.id, "dup-helpers");
  assert.equal(best.score, 23);
  assert.equal(best.risk, "low");
  assert.equal(best.needsRun, false);
});

test("bestLowCost skips anything risky or needing a run", () => {
  const best = bestLowCost(MEASURED);
  assert.equal(best.id, "dup-helpers");
  assert.equal(isLowCost(best), true);
  // A high-risk prototype is never low-cost even with the same lines.
  assert.equal(
    isLowCost({
      id: "x",
      name: "x",
      linesRemoved: 23,
      risk: "high",
      gatesPass: true,
    }),
    false,
  );
  // A low-risk prototype that needs a run is not settled either.
  assert.equal(
    isLowCost({
      id: "x",
      name: "x",
      linesRemoved: 23,
      risk: "low",
      gatesPass: true,
      needsRun: true,
    }),
    false,
  );
});

test("the measured set ranks low-risk reuse above high-risk dependency swaps", () => {
  const ranked = rankPrototypes(MEASURED);
  const order = ranked.map((p) => p.id);
  // dup-helpers (23) > sha256 (9) > parseargs (2) > ws-global (0.5*3=1.5)
  assert.deepEqual(order.slice(0, 4), [
    "dup-helpers",
    "sha256-consolidation",
    "parseargs",
    "ws-global",
  ]);
  // The hand-rolled client adds code, so it is last.
  assert.equal(order.at(-1), "graphql-ws-handrolled");
});

test("summarize reports totals, the best id, and a conservative gate flag", () => {
  const summary = summarize(MEASURED);
  assert.equal(summary.count, MEASURED.length);
  assert.equal(summary.linesRemoved, 8 - 28 + 0 + 9 + 2 + 23);
  assert.equal(summary.dependencyCopiesRemoved, 0);
  assert.equal(summary.bestId, "dup-helpers");
  assert.equal(summary.bestScore, 23);
  assert.equal(summary.gatesPass, true);
  // At least one prototype needs a run, so the set does.
  assert.equal(summary.needsRun, true);
});

test("summarize of an empty set is empty, not a crash", () => {
  const summary = summarize([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.bestId, null);
  assert.equal(summary.bestScore, 0);
  assert.equal(bestPrototype([]), null);
});
