import assert from "node:assert/strict";
import test from "node:test";
import { deliveryCommitment } from "../../backend/src/delivery-commitment.mjs";
import {
  deliveryOf,
  finishRecord,
  runVolumeBatch,
} from "../src/volume-batch.mjs";

test("deliveryOf is deterministic and digest-bound (no randomBytes placeholder)", () => {
  const first = deliveryOf("order-label-a");
  const second = deliveryOf("order-label-a");
  assert.deepEqual(first, second);
  assert.match(first.commitment, /^[0-9a-f]{64}$/);
  assert.equal(first.files.length, 3);
  for (const file of first.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(file.contentType, "image/png");
    assert.equal(file.byteLength, 32);
  }
  assert.equal(
    first.commitment,
    deliveryCommitment(first.files.map((file) => ({ sha256: file.sha256 }))),
  );
  const other = deliveryOf("order-label-b");
  assert.notEqual(first.commitment, other.commitment);
});

test("finishRecord is idempotent under the F-35 race", () => {
  const state = { charged: 0, finished: new Set() };
  finishRecord(state, "slot-1");
  finishRecord(state, "slot-1");
  finishRecord(state, "slot-2");
  assert.equal(state.charged, 2);
  assert.equal(state.finished.size, 2);
});

test("runVolumeBatch drives a synthetic multi-hundred-iteration run with bounded state", async () => {
  const result = await runVolumeBatch({
    iterations: 2400,
    label: "volume-batch-f35",
    crashAt: 2079,
  });
  assert.equal(result.stop.gate, "submission-crashed");
  // F-35: charged must equal finished records, not the planned iteration count.
  assert.equal(result.charged, result.finished);
  assert.equal(result.finished, 2079);
  assert.equal(result.planned, 2400);
  assert.notEqual(result.charged, result.planned);
  assert.equal(result.state.orderState.delivery.commitment.length, 64);
  assert.equal(
    result.state.orderState.delivery.commitment,
    deliveryOf("volume-batch-f35").commitment,
  );
});

test("runVolumeBatch without a crash charges every iteration exactly once", async () => {
  const result = await runVolumeBatch({
    iterations: 128,
    label: "volume-batch-clean",
  });
  assert.equal(result.stop.gate, "complete");
  assert.equal(result.charged, 128);
  assert.equal(result.finished, 128);
  assert.equal(result.planned, 128);
});
