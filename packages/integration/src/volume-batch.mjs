import { createHash } from "node:crypto";
import { deliveryCommitment } from "../../backend/src/delivery-commitment.mjs";

/**
 * RECONSTRUCTED volume-batch: synthetic multi-iteration delivery driver.
 * deliveryOf is digest-bound (never randomBytes). finishRecord is idempotent
 * under the F-35 race so charged always equals finished records.
 */

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Three synthetic inspected digests derived from the order label. */
export function deliveryOf(label) {
  if (typeof label !== "string" || label.length === 0)
    throw new Error("order label is required");
  const files = [0, 1, 2].map((index) => {
    const sha256 = sha256Hex(`${label}:file:${index}`);
    return {
      grantId: `grant-${index}`,
      sha256,
      contentType: "image/png",
      byteLength: 32,
    };
  });
  return {
    label,
    files,
    commitment: deliveryCommitment(files),
  };
}

/**
 * F-35 finishRecord race: a slot is charged at most once even if finishRecord
 * is observed twice after a submission crash/retry.
 */
export function finishRecord(state, slotId) {
  if (!state || typeof state !== "object")
    throw new Error("volume batch state is required");
  if (typeof slotId !== "string" || slotId.length === 0)
    throw new Error("slot id is required");
  if (!state.finished) state.finished = new Set();
  if (typeof state.charged !== "number") state.charged = 0;
  if (state.finished.has(slotId)) return { slotId, charged: false };
  state.finished.add(slotId);
  state.charged += 1;
  return { slotId, charged: true };
}

/**
 * Synthetic multi-hundred-iteration run with bounded state.
 * When crashAt is set, the run stops at that finished count with gate
 * "submission-crashed"; charged remains equal to finished (F-35).
 */
export async function runVolumeBatch(options) {
  const iterations = options?.iterations ?? 2400;
  const label = options?.label ?? "volume-batch";
  const crashAt = options?.crashAt;
  if (!Number.isSafeInteger(iterations) || iterations <= 0)
    throw new Error("bounded positive iteration count is required");
  const state = {
    charged: 0,
    finished: new Set(),
    orderState: {
      label,
      delivery: deliveryOf(label),
    },
  };
  let stop = { gate: "complete" };
  for (let i = 0; i < iterations; i += 1) {
    if (typeof crashAt === "number" && state.finished.size >= crashAt) {
      stop = { gate: "submission-crashed", at: state.finished.size };
      break;
    }
    const slotId = `slot-${i}`;
    // Retry-safe finish: the same slot may be observed twice after a crash.
    finishRecord(state, slotId);
    finishRecord(state, slotId);
  }
  return {
    planned: iterations,
    charged: state.charged,
    finished: state.finished.size,
    stop,
    state,
  };
}
