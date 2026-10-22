import assert from "node:assert/strict";
import test from "node:test";
import {
  concurrentCeiling,
  driveInstance,
  dustCostModel,
  LIFECYCLE_CIRCUITS,
  planBatches,
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

test("the concurrency ceiling is the DUST UTXO count, not the balance", () => {
  // Building a transaction locks the DUST UTXOs that pay its fee until the
  // wallet applies the confirmation, so in-flight transactions cannot exceed
  // unlocked DUST UTXOs. Measured on the funded wallet: 5.
  assert.equal(concurrentCeiling({ dustUtxos: 5 }), 5);
  assert.equal(concurrentCeiling({ dustUtxos: 5, maxConcurrency: 3 }), 3);
  assert.equal(concurrentCeiling({ dustUtxos: 0 }), 0);
  // A fee that needs two UTXOs halves the ceiling.
  assert.equal(concurrentCeiling({ dustUtxos: 5, perTransaction: 2 }), 2);
  // A large balance with no UTXOs still cannot run anything concurrently.
  assert.equal(concurrentCeiling({ dustUtxos: 0, maxConcurrency: 8 }), 0);
  assert.throws(() => concurrentCeiling({ dustUtxos: -1 }));
  assert.throws(() => concurrentCeiling({ dustUtxos: 5, perTransaction: 0 }));
});

test("batches cover every instance exactly once", () => {
  assert.deepEqual(planBatches({ instances: 5, concurrency: 2 }), [
    { start: 0, end: 2, size: 2 },
    { start: 2, end: 4, size: 2 },
    { start: 4, end: 5, size: 1 },
  ]);
  assert.deepEqual(planBatches({ instances: 0, concurrency: 3 }), []);
  assert.deepEqual(planBatches({ instances: 3, concurrency: 5 }), [
    { start: 0, end: 3, size: 3 },
  ]);
  const total = planBatches({ instances: 17, concurrency: 4 }).reduce(
    (n, b) => n + b.size,
    0,
  );
  assert.equal(total, 17);
});

test("batching cannot reduce DUST cost, and a non-zero overhead makes it worse", () => {
  // Every circuit call is its own transaction and pays its own fee, so the total
  // is operations x per-transaction fee regardless of how they are submitted.
  const sequential = dustCostModel({
    operations: 200,
    feePerTransactionSpecks: 1,
  });
  const batched = dustCostModel({
    operations: 200,
    feePerTransactionSpecks: 1,
  });
  assert.equal(sequential.totalSpecks, batched.totalSpecks);
  assert.equal(sequential.totalSpecks, 200n);

  // additionalFeeOverhead is charged per fee and is not refunded, so it scales
  // with the transaction count. Fewer transactions would mean less of it;
  // batching does not reduce the count.
  const withOverhead = dustCostModel({
    operations: 200,
    feePerTransactionSpecks: 1,
    additionalFeeOverheadSpecks: 300_000_000_000_000n,
  });
  assert.equal(withOverhead.perTransactionSpecks, 300_000_000_000_001n);
  assert.equal(withOverhead.overheadSpecks, 60_000_000_000_000_000n);

  // The lane runs with overhead 0n, which is the only real DUST saving available.
  const zeroOverhead = dustCostModel({
    operations: 200,
    feePerTransactionSpecks: 1,
    additionalFeeOverheadSpecks: 0n,
  });
  assert.equal(zeroOverhead.overheadSpecks, 0n);
  assert.equal(zeroOverhead.totalSpecks, 200n);
});
