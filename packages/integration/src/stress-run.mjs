/**
 * Cross-circuit stress harness for the Preprod order contract.
 *
 * What this proves that the 14/14 sweep does not: the sweep exercises every
 * circuit once, on one instance per scenario. This drives the same contract to a
 * configurable operation count across many instances, so it measures the things
 * that only appear at volume — sustained proving, fee accrual under load, and
 * whether the revision counter and phase machine hold across hundreds of
 * sequential transactions.
 *
 * Three constraints from the protocol shape the design, and none are optional:
 *
 * 1. `configuration` is a SEALED ledger field, so one deployed contract is one
 *    order with one fixed set of parties and deadlines. There is no way to run
 *    200 operations against a single instance: a full lifecycle is 4 calls and
 *    every terminal phase is final. Volume therefore means many instances, each
 *    driven through a complete lifecycle.
 *
 * 2. A wallet can only have as many transactions in flight as it has unlocked
 *    DUST UTXOs, and a built transaction locks the UTXOs that pay its fee until
 *    the wallet applies the confirmation. Calls are therefore strictly
 *    sequential per instance, and the harness waits for the wallet to settle
 *    between them rather than firing a batch that would fail to balance.
 *
 * 3. Cross-contract calls require ledger version 9. Preprod runs ledger 8, so a
 *    contract cannot call another contract on this network. "Cross-circuit" here
 *    means exercising different circuits of the same contract in one flow, not
 *    contract-to-contract calls. This harness does not claim the latter.
 *
 * The harness is bounded on three axes so a run cannot run away: a maximum
 * operation count, a wall-clock deadline, and a DUST floor below which it stops
 * rather than draining the wallet on a fee it cannot cover.
 */

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

/** A full happy-path lifecycle, in revision order. */
const LIFECYCLE = Object.freeze([
  { circuit: "reserve", actor: "buyer" },
  { circuit: "accept", actor: "merchant" },
  { circuit: "submitDelivery", actor: "merchant" },
  { circuit: "approve", actor: "buyer" },
]);

/** The four circuits a happy-path lifecycle touches, in order. */
export const LIFECYCLE_CIRCUITS = Object.freeze(
  LIFECYCLE.map((step) => step.circuit),
);

const bytes32 = () => new Uint8Array(randomBytes(32));

/**
 * The default budget. 200 operations at one transaction per 6-second block is a
 * 20-minute floor before proving time, so the deadline is generous; the DUST
 * floor is what actually stops a run that is consuming faster than expected.
 */
export const STRESS_DEFAULTS = Object.freeze({
  maxOperations: 200,
  maxInstances: 50,
  deadlineMs: 90 * 60 * 1000,
  dustFloorSpecks: 5n * 10n ** 15n,
  settleTimeoutMs: 180_000,
  settlePollMs: 2_000,
  // A staged deploy plus its proofs is the memory high-water mark of a run. Below
  // this much free memory the next instance is refused rather than attempted,
  // because the OOM killer leaves no receipt and no event.
  minFreeBytes: 1_500_000_000,
});

/**
 * Plan how many instances and operations a budget allows.
 *
 * Pure, so the arithmetic is testable without a network. It refuses to plan a
 * partial final instance: a lifecycle that stops halfway leaves an order in a
 * non-terminal phase, which is a worse artifact than one fewer complete order.
 */
export function planStressRun({
  maxOperations = STRESS_DEFAULTS.maxOperations,
  maxInstances = STRESS_DEFAULTS.maxInstances,
} = {}) {
  if (!Number.isInteger(maxOperations) || maxOperations < LIFECYCLE.length)
    throw new Error(
      `maxOperations must be an integer of at least ${LIFECYCLE.length} (one full lifecycle); received ${maxOperations}`,
    );
  if (!Number.isInteger(maxInstances) || maxInstances < 1)
    throw new Error(
      `maxInstances must be a positive integer; received ${maxInstances}`,
    );
  const perInstance = LIFECYCLE.length;
  const byOperations = Math.floor(maxOperations / perInstance);
  const instances = Math.min(byOperations, maxInstances);
  if (instances < 1)
    throw new Error(
      `budget of ${maxOperations} operations cannot complete one ${perInstance}-call lifecycle`,
    );
  return {
    instances,
    operations: instances * perInstance,
    perInstance,
    // What the budget could not spend, so a caller sees the rounding rather than
    // believing it ran the number it asked for.
    unusedOperations: maxOperations - instances * perInstance,
  };
}

/**
 * Decide whether the run may continue.
 *
 * Separate from the loop so the stopping conditions are explicit and testable.
 * Every reason is a refusal, never a silent break: a stress run that stops early
 * must say why, or its operation count is a lie.
 *
 * `freeBytes` and `minFreeBytes` exist because the first real run on this host was
 * killed by the OOM killer after two operations, with no event and no receipt: the
 * process simply vanished. A memory floor turns that into a recorded stop, which is
 * the difference between "the harness refused to continue" and "the harness is
 * broken". Callers that cannot read memory pass `undefined` and the check is skipped.
 */
export function stressStopReason({
  operationsDone,
  maxOperations,
  elapsedMs,
  deadlineMs,
  dustSpecks,
  dustFloorSpecks,
  failures,
  maxFailures = 0,
  freeBytes,
  minFreeBytes,
}) {
  if (operationsDone >= maxOperations) return "operation-budget-reached";
  if (elapsedMs >= deadlineMs) return "deadline-reached";
  if (failures > maxFailures) return "failure-threshold-reached";
  if (dustSpecks < dustFloorSpecks) return "dust-floor-reached";
  if (
    typeof freeBytes === "number" &&
    typeof minFreeBytes === "number" &&
    freeBytes < minFreeBytes
  )
    return "memory-floor-reached";
  return null;
}

/**
 * Summarise a run from its per-operation records.
 *
 * Counts are derived from the records rather than incremented alongside them, so
 * a summary cannot drift from the evidence it claims to describe.
 */
export function summariseStressRun(records) {
  const byCircuit = {};
  let succeeded = 0;
  let failed = 0;
  for (const record of records) {
    const bucket = byCircuit[record.circuit] ?? { ok: 0, failed: 0 };
    if (record.ok) {
      bucket.ok += 1;
      succeeded += 1;
    } else {
      bucket.failed += 1;
      failed += 1;
    }
    byCircuit[record.circuit] = bucket;
  }
  const instances = new Set(records.map((r) => r.instance)).size;
  return {
    operations: records.length,
    succeeded,
    failed,
    instances,
    byCircuit,
    complete: failed === 0 && records.length > 0,
  };
}

/**
 * How many instances can be driven concurrently, given the wallet's DUST UTXOs.
 *
 * This is the hard ceiling and it is not a tuning knob. Building a transaction
 * locks the DUST UTXOs that pay its fee until the wallet applies that
 * transaction's confirmation, so a wallet with N unlocked DUST UTXOs can have at
 * most N transactions in flight. Concurrency above that does not fail politely:
 * the extra builds reject with `Insufficient Funds: could not balance dust`.
 *
 * `perTransaction` exists because one fee can lock more than one DUST UTXO when a
 * single UTXO cannot cover it. Assuming one UTXO per transaction would overstate
 * the ceiling and produce a batch that rejects partway through.
 */
export function concurrentCeiling({
  dustUtxos,
  perTransaction = 1,
  maxConcurrency = 8,
}) {
  if (!Number.isInteger(dustUtxos) || dustUtxos < 0)
    throw new Error(
      `dustUtxos must be a non-negative integer; got ${dustUtxos}`,
    );
  if (!Number.isInteger(perTransaction) || perTransaction < 1)
    throw new Error(
      `perTransaction must be a positive integer; got ${perTransaction}`,
    );
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)
    throw new Error(
      `maxConcurrency must be a positive integer; got ${maxConcurrency}`,
    );
  const byUtxos = Math.floor(dustUtxos / perTransaction);
  return Math.max(0, Math.min(byUtxos, maxConcurrency));
}

/**
 * Split a planned instance count into batches of at most `concurrency`.
 *
 * Batching changes wall clock, not cost: every circuit call is its own
 * transaction with its own fee, so a batch of N costs the same DUST as N
 * sequential calls. What it buys is overlap — N proofs run at once and N
 * transactions can land in the same or adjacent blocks instead of one per block.
 */
export function planBatches({ instances, concurrency }) {
  if (!Number.isInteger(instances) || instances < 0)
    throw new Error(
      `instances must be a non-negative integer; got ${instances}`,
    );
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error(
      `concurrency must be a positive integer; got ${concurrency}`,
    );
  const batches = [];
  for (let start = 0; start < instances; start += concurrency) {
    const end = Math.min(start + concurrency, instances);
    batches.push({ start, end, size: end - start });
  }
  return batches;
}

/**
 * Drive one instance through the full lifecycle.
 *
 * `call` is injected so the sequencing is testable without a chain: it receives
 * the step, the expected revision and the arguments, and resolves when the
 * transaction has been observed. The harness never assumes a call succeeded
 * because the promise resolved — the caller's `call` is responsible for
 * observing the transition, and a rejection here is recorded as a failure.
 */
export async function driveInstance({
  index,
  call,
  emit = () => {},
  delivery = bytes32(),
}) {
  const records = [];
  for (let revision = 0; revision < LIFECYCLE.length; revision += 1) {
    const step = LIFECYCLE[revision];
    const args =
      step.circuit === "submitDelivery"
        ? [delivery]
        : step.circuit === "approve"
          ? [delivery]
          : [];
    try {
      const result = await call({
        instance: index,
        circuit: step.circuit,
        actor: step.actor,
        revision: BigInt(revision),
        args,
      });
      records.push({
        instance: index,
        circuit: step.circuit,
        revision,
        ok: true,
        txId: result?.txId ?? null,
        blockHeight: result?.blockHeight ?? null,
      });
      await emit("stress-operation", {
        instance: index,
        circuit: step.circuit,
        revision,
        ok: true,
        txId: result?.txId ?? null,
      });
    } catch (error) {
      records.push({
        instance: index,
        circuit: step.circuit,
        revision,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
      await emit("stress-operation", {
        instance: index,
        circuit: step.circuit,
        revision,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
      // A failed step leaves the order in a phase the remaining steps cannot
      // reach, so the instance is abandoned rather than driven further. Counting
      // the untaken steps as successes would inflate the operation total.
      return { records, abandoned: true };
    }
  }
  return { records, abandoned: false };
}

/** Where a run writes its evidence, so a partial run still leaves a record. */
export function stressReceiptPath(runDir) {
  return resolve(runDir, "stress-run.json");
}

/**
 * What a run costs in DUST, and what batching does to that cost.
 *
 * The answer is nothing. Every circuit call is its own transaction and pays its
 * own fee; the ledger charges per transaction, and `additionalFeeOverhead` is
 * added to *each* fee and is not refunded. Batching therefore cannot reduce the
 * total, and with a non-zero overhead it increases it, because more fee-paying
 * transactions means more overhead charged.
 *
 * This is computed rather than asserted so the claim in the docs stays tied to
 * arithmetic a reader can check.
 */
export function dustCostModel({
  operations,
  feePerTransactionSpecks,
  additionalFeeOverheadSpecks = 0n,
}) {
  if (!Number.isInteger(operations) || operations < 0)
    throw new Error(
      `operations must be a non-negative integer; got ${operations}`,
    );
  const fee = BigInt(feePerTransactionSpecks);
  const overhead = BigInt(additionalFeeOverheadSpecks);
  const perTransaction = fee + overhead;
  return {
    perTransactionSpecks: perTransaction,
    totalSpecks: perTransaction * BigInt(operations),
    // The overhead is the only part batching could ever influence, and it moves
    // the wrong way: it is charged per transaction, so fewer transactions would
    // mean less of it. Batching does not reduce the transaction count.
    overheadSpecks: overhead * BigInt(operations),
    note: "batching changes wall clock only; every call is its own transaction and pays its own fee",
  };
}
