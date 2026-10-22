import assert from "node:assert/strict";
import test from "node:test";
import {
  driveInstance,
  LIFECYCLE_CIRCUITS,
  planStressRun,
  STRESS_DEFAULTS,
  stressStopReason,
  summariseStressRun,
} from "../src/stress-run.mjs";

test("a full lifecycle touches four circuits in revision order", () => {
  assert.deepEqual(LIFECYCLE_CIRCUITS, [
    "reserve",
    "accept",
    "submitDelivery",
    "approve",
  ]);
});

test("the plan spends the budget in whole lifecycles and reports the remainder", () => {
  const plan = planStressRun({ maxOperations: 200, maxInstances: 50 });
  assert.equal(plan.perInstance, 4);
  assert.equal(plan.instances, 50);
  assert.equal(plan.operations, 200);
  assert.equal(plan.unusedOperations, 0);

  const ragged = planStressRun({ maxOperations: 202, maxInstances: 50 });
  assert.equal(ragged.instances, 50);
  assert.equal(ragged.operations, 200);
  assert.equal(ragged.unusedOperations, 2);
});

test("the plan caps at maxInstances when the operation budget is larger", () => {
  const plan = planStressRun({ maxOperations: 400, maxInstances: 10 });
  assert.equal(plan.instances, 10);
  assert.equal(plan.operations, 40);
  assert.equal(plan.unusedOperations, 360);
});

test("the plan refuses a budget that cannot complete one lifecycle", () => {
  assert.throws(() => planStressRun({ maxOperations: 3 }), /at least 4/);
  assert.throws(() => planStressRun({ maxOperations: 4, maxInstances: 0 }));
  assert.throws(() => planStressRun({ maxOperations: 4.5 }));
});

test("a stop reason is always explicit, never a silent break", () => {
  const base = {
    operationsDone: 0,
    maxOperations: 200,
    elapsedMs: 0,
    deadlineMs: 1000,
    dustSpecks: STRESS_DEFAULTS.dustFloorSpecks,
    dustFloorSpecks: STRESS_DEFAULTS.dustFloorSpecks,
    failures: 0,
  };
  assert.equal(stressStopReason(base), null);
  assert.equal(
    stressStopReason({ ...base, operationsDone: 200 }),
    "operation-budget-reached",
  );
  assert.equal(
    stressStopReason({ ...base, elapsedMs: 1000 }),
    "deadline-reached",
  );
  assert.equal(
    stressStopReason({ ...base, failures: 1 }),
    "failure-threshold-reached",
  );
  assert.equal(
    stressStopReason({ ...base, dustSpecks: 1n }),
    "dust-floor-reached",
  );
});

test("the memory floor turns an OOM kill into a recorded stop", () => {
  // The first real run on this host was killed by the OOM killer after two
  // operations, with no event and no receipt. A floor makes that a refusal the
  // harness reports instead of a process that silently vanished.
  const base = {
    operationsDone: 2,
    maxOperations: 200,
    elapsedMs: 1000,
    deadlineMs: 10_000,
    dustSpecks: STRESS_DEFAULTS.dustFloorSpecks,
    dustFloorSpecks: STRESS_DEFAULTS.dustFloorSpecks,
    failures: 0,
  };
  assert.equal(
    stressStopReason({
      ...base,
      freeBytes: STRESS_DEFAULTS.minFreeBytes - 1,
      minFreeBytes: STRESS_DEFAULTS.minFreeBytes,
    }),
    "memory-floor-reached",
  );
  assert.equal(
    stressStopReason({
      ...base,
      freeBytes: STRESS_DEFAULTS.minFreeBytes,
      minFreeBytes: STRESS_DEFAULTS.minFreeBytes,
    }),
    null,
  );
  // Unknown memory skips the check rather than guessing.
  assert.equal(
    stressStopReason({
      ...base,
      freeBytes: undefined,
      minFreeBytes: STRESS_DEFAULTS.minFreeBytes,
    }),
    null,
  );
});

test("the summary is derived from records, not counted alongside them", () => {
  const records = [
    { instance: 0, circuit: "reserve", ok: true },
    { instance: 0, circuit: "accept", ok: true },
    { instance: 0, circuit: "submitDelivery", ok: true },
    { instance: 0, circuit: "approve", ok: true },
    { instance: 1, circuit: "reserve", ok: true },
    { instance: 1, circuit: "accept", ok: false },
  ];
  const summary = summariseStressRun(records);
  assert.equal(summary.operations, 6);
  assert.equal(summary.succeeded, 5);
  assert.equal(summary.failed, 1);
  assert.equal(summary.instances, 2);
  assert.equal(summary.byCircuit.reserve.ok, 2);
  assert.equal(summary.byCircuit.accept.failed, 1);
  assert.equal(summary.complete, false);
});

test("an empty run is not complete", () => {
  assert.equal(summariseStressRun([]).complete, false);
});

test("driveInstance drives all four circuits with ascending revisions", async () => {
  const seen = [];
  const { records, abandoned } = await driveInstance({
    index: 3,
    call: async (step) => {
      seen.push([step.circuit, step.revision, step.actor]);
      return { txId: `tx-${step.circuit}` };
    },
  });
  assert.equal(abandoned, false);
  assert.equal(records.length, 4);
  assert.deepEqual(seen, [
    ["reserve", 0n, "buyer"],
    ["accept", 1n, "merchant"],
    ["submitDelivery", 2n, "merchant"],
    ["approve", 3n, "buyer"],
  ]);
  assert.ok(records.every((r) => r.ok));
});

test("driveInstance passes the same delivery commitment to submit and approve", async () => {
  const seen = [];
  await driveInstance({
    index: 0,
    call: async (step) => {
      if (step.circuit === "submitDelivery" || step.circuit === "approve")
        seen.push(step.args[0]);
      return {};
    },
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
});

test("a failed step abandons the instance and does not count untaken steps", async () => {
  const { records, abandoned } = await driveInstance({
    index: 0,
    call: async (step) => {
      if (step.circuit === "accept") throw new Error("revision mismatch");
      return {};
    },
  });
  assert.equal(abandoned, true);
  assert.equal(records.length, 2);
  assert.equal(records[0].ok, true);
  assert.equal(records[1].ok, false);
  assert.match(records[1].message, /revision mismatch/);
});

test("driveInstance reports each operation as it happens", async () => {
  const events = [];
  await driveInstance({
    index: 0,
    call: async () => ({ txId: "t" }),
    emit: (event, fields) => events.push([event, fields.circuit, fields.ok]),
  });
  assert.equal(events.length, 4);
  assert.ok(events.every(([event]) => event === "stress-operation"));
});
