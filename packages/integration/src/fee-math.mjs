/**
 * Product-side fee math for proved call transactions.
 *
 * Root cause (R8): wallet-sdk-dust-wallet Transacting.calculateFee calls
 * transaction.feesWithMargin(ledgerParams, margin) on the *proved* object.
 * feesWithMargin is WASM (wasm.transaction_feesWithMargin) and spins on call
 * txs that carry circuit proofs. dryRunFee already eraseProofs() before the
 * same call; the initial price in computeBalancingRecipe does not.
 *
 * Fix (this module, in-tree product code — not a node_modules patch):
 *  1. Preferred: installEraseProofsFeeMath() so every feesWithMargin is priced
 *     on a proof-erased copy, matching dryRunFee.
 *  2. Local-only escape hatch: MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only
 *     returns a fixed generous fee. This path MUST NOT run on Preprod/Mainnet.
 */
import assert from "node:assert/strict";

export const LOCAL_FIXED_FEE_ENV = "MILO_ALLOW_FIXED_LOCAL_FEE";
export const LOCAL_FIXED_FEE_ACK = "local-disposable-only";
/** 2000 NIGHT in smallest units (1 NIGHT = 1e6 specks). Local disposable only. */
export const LOCAL_FIXED_FEE_SPECKS = 2_000_000_000n;
const LOCAL_NETWORK_IDS = new Set(["undeployed", "local"]);

let installed = null;

export function localFixedFeeConfig(env = process.env, networkId = null) {
  const raw = env[LOCAL_FIXED_FEE_ENV];
  if (raw === undefined || raw === "") return { mode: "erase-proofs" };
  if (raw !== LOCAL_FIXED_FEE_ACK) {
    throw new Error(
      `${LOCAL_FIXED_FEE_ENV} must be exactly '${LOCAL_FIXED_FEE_ACK}' (got a different value)`,
    );
  }
  if (networkId != null && !LOCAL_NETWORK_IDS.has(String(networkId))) {
    throw new Error(
      `${LOCAL_FIXED_FEE_ENV} is local-only; refusing networkId=${networkId}`,
    );
  }
  return { mode: "local-fixed", fee: LOCAL_FIXED_FEE_SPECKS };
}

/**
 * Install fee-math on the ledger-v8 Transaction prototype.
 * Idempotent. Returns a handle describing what was installed.
 */
export function installFeeMath({
  env = process.env,
  networkId = null,
  Transaction,
} = {}) {
  if (installed) return installed;
  if (!Transaction) {
    throw new Error("installFeeMath requires the ledger-v8 Transaction class");
  }
  const proto = Transaction.prototype;
  assert.equal(typeof proto.feesWithMargin, "function");
  assert.equal(typeof proto.eraseProofs, "function");
  const originalFeesWithMargin = proto.feesWithMargin;
  const config = localFixedFeeConfig(env, networkId);
  proto.feesWithMargin = function miloFeesWithMargin(params, margin) {
    if (config.mode === "local-fixed") return config.fee;
    // Product fix: price the proof-erased copy, matching dryRunFee.
    // Call the original implementation to avoid recursion.
    return originalFeesWithMargin.call(this.eraseProofs(), params, margin);
  };
  installed = {
    mode: config.mode,
    fee: config.mode === "local-fixed" ? config.fee : null,
    originalFeesWithMargin,
    proto,
    uninstall() {
      proto.feesWithMargin = originalFeesWithMargin;
      installed = null;
    },
  };
  return installed;
}

/** Test helper: force-reset install state. */
export function resetFeeMathForTests() {
  if (installed) installed.uninstall();
}

/**
 * Safe fee probe used by the repro and diagnostics.
 * A WASM feesWithMargin spin is a *synchronous* event-loop block; a same-thread
 * Promise.race watchdog cannot interrupt it. This probe therefore:
 *  - detects async hangs (returned thenable that never settles) via watchdog;
 *  - for sync spins, callers must run probe in a worker/child (see fee-spin-repro).
 * Returns { ok, fee, ms, timedOut }.
 */
export async function probeFeesWithMargin(tx, params, margin, { timeoutMs = 2000 } = {}) {
  const started = Date.now();
  let timer;
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, fee: null, ms: Date.now() - started, timedOut: true }),
      timeoutMs,
    );
  });
  const work = (async () => {
    try {
      const feeOrPromise = tx.feesWithMargin(params, margin);
      const fee =
        feeOrPromise && typeof feeOrPromise.then === "function"
          ? await feeOrPromise
          : feeOrPromise;
      return { ok: true, fee, ms: Date.now() - started, timedOut: false };
    } catch (error) {
      return {
        ok: false,
        fee: null,
        ms: Date.now() - started,
        timedOut: false,
        error: error && error.message ? error.message : String(error),
      };
    }
  })();
  const result = await Promise.race([work, watchdog]);
  clearTimeout(timer);
  return result;
}
