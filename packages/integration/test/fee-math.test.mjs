import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installFeeMath,
  LOCAL_FIXED_FEE_ACK,
  LOCAL_FIXED_FEE_ENV,
  LOCAL_FIXED_FEE_SPECKS,
  localFixedFeeConfig,
  probeFeesWithMargin,
  resetFeeMathForTests,
} from "../src/fee-math.mjs";

function fakeTransaction({ spin = false, fee = 42n } = {}) {
  const tx = {
    erased: false,
    eraseProofs() {
      return {
        erased: true,
        feesWithMargin() {
          return fee;
        },
      };
    },
    feesWithMargin() {
      if (spin) {
        // simulate WASM spin: never return
        return new Promise(() => {});
      }
      return fee;
    },
  };
  return tx;
}

function fakeTxClass() {
  function Transaction(hasProofs = true) {
    this.__hasProofs = hasProofs;
  }
  Transaction.prototype.eraseProofs = function eraseProofs() {
    return new Transaction(false);
  };
  // Original implementation: spins (hangs) when proofs are present,
  // returns a lower fee once proofs are erased — models WASM feesWithMargin.
  Transaction.prototype.feesWithMargin = function originalFees() {
    if (this.__hasProofs) return new Promise(() => {});
    return 7n;
  };
  return Transaction;
}

test("localFixedFeeConfig defaults to erase-proofs", () => {
  assert.deepEqual(localFixedFeeConfig({}), { mode: "erase-proofs" });
  assert.deepEqual(localFixedFeeConfig({ [LOCAL_FIXED_FEE_ENV]: "" }), {
    mode: "erase-proofs",
  });
});

test("localFixedFeeConfig requires exact ack string", () => {
  assert.throws(
    () => localFixedFeeConfig({ [LOCAL_FIXED_FEE_ENV]: "yes" }),
    /must be exactly/,
  );
  assert.deepEqual(
    localFixedFeeConfig({ [LOCAL_FIXED_FEE_ENV]: LOCAL_FIXED_FEE_ACK }),
    { mode: "local-fixed", fee: LOCAL_FIXED_FEE_SPECKS },
  );
});

test("localFixedFeeConfig refuses Preprod/Mainnet", () => {
  assert.throws(
    () =>
      localFixedFeeConfig(
        { [LOCAL_FIXED_FEE_ENV]: LOCAL_FIXED_FEE_ACK },
        "preprod",
      ),
    /local-only/,
  );
  assert.throws(
    () =>
      localFixedFeeConfig(
        { [LOCAL_FIXED_FEE_ENV]: LOCAL_FIXED_FEE_ACK },
        "mainnet",
      ),
    /local-only/,
  );
  assert.deepEqual(
    localFixedFeeConfig(
      { [LOCAL_FIXED_FEE_ENV]: LOCAL_FIXED_FEE_ACK },
      "undeployed",
    ),
    { mode: "local-fixed", fee: LOCAL_FIXED_FEE_SPECKS },
  );
});

test("installFeeMath erase-proofs path uses original feesWithMargin on erased copy", async () => {
  resetFeeMathForTests();
  const Transaction = fakeTxClass();
  const handle = installFeeMath({
    env: {},
    networkId: "undeployed",
    Transaction,
  });
  assert.equal(handle.mode, "erase-proofs");
  const tx = new Transaction(true);
  // Without the fix this would hang (proven tx); with eraseProofs wrapper it returns 7n.
  assert.equal(tx.feesWithMargin(null, 0), 7n);
  handle.uninstall();
  // Uninstalled: original spins on proved tx (async hang), fine on erased.
  const erased = new Transaction(false);
  assert.equal(erased.feesWithMargin(null, 0), 7n);
  const spun = await probeFeesWithMargin(new Transaction(true), null, 0, {
    timeoutMs: 30,
  });
  assert.equal(spun.timedOut, true);
});

test("installFeeMath local-fixed returns fixed fee and refuses non-local", () => {
  resetFeeMathForTests();
  const Transaction = fakeTxClass();
  const handle = installFeeMath({
    env: { [LOCAL_FIXED_FEE_ENV]: LOCAL_FIXED_FEE_ACK },
    networkId: "undeployed",
    Transaction,
  });
  assert.equal(handle.mode, "local-fixed");
  const tx = new Transaction();
  assert.equal(tx.feesWithMargin(null, 0), LOCAL_FIXED_FEE_SPECKS);
  handle.uninstall();
  resetFeeMathForTests();
  assert.throws(() =>
    installFeeMath({
      env: { [LOCAL_FIXED_FEE_ENV]: LOCAL_FIXED_FEE_ACK },
      networkId: "preprod",
      Transaction,
    }),
  );
});

test("probeFeesWithMargin times out a spinning feesWithMargin", async () => {
  const spinning = fakeTransaction({ spin: true });
  const result = await probeFeesWithMargin(spinning, null, 0, {
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  const okTx = fakeTransaction({ fee: 5n });
  const ok = await probeFeesWithMargin(okTx, null, 0, { timeoutMs: 50 });
  assert.equal(ok.ok, true);
  assert.equal(ok.fee, 5n);
});
