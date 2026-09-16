import assert from "node:assert/strict";
import test from "node:test";
import { BehaviorSubject } from "rxjs";
import {
  balanceWithDustReadiness,
  isInsufficientDust,
  waitForDustBalance,
} from "../src/dust.mjs";

const insufficient = () => ({
  _tag: "Wallet.InsufficientFunds",
  tokenType: "dust",
  message: "PRIVATE_CANARY",
});
const options = () => ({
  ttl: new Date(Date.now() + 60_000),
  deadline: Date.now() + 60_000,
});

test("MID-T01 actual-fee readiness waits for estimate and retries only after observed DUST increases", async () => {
  const events = [];
  const thresholds = [];
  const balances = [5n, 8n, 9n];
  let attempts = 0;
  const recipe = {};
  const wallet = {
    async calculateTransactionFee() {
      return 5n;
    },
    async estimateTransactionFee() {
      return 8n;
    },
    async balanceUnboundTransaction() {
      if (++attempts === 1) throw insufficient();
      return recipe;
    },
    async submitTransaction() {
      assert.fail("Readiness must never submit");
    },
    async signRecipe() {
      assert.fail("Readiness must never sign");
    },
    async finalizeRecipe() {
      assert.fail("Readiness must never finalize");
    },
  };
  const result = await balanceWithDustReadiness(
    wallet,
    {},
    {},
    {
      ...options(),
      emit: (event, fields) => events.push({ event, ...fields }),
      wait: async (_wallet, thresholdsForAttempt) => {
        thresholds.push(thresholdsForAttempt);
        return balances.shift();
      },
    },
  );
  assert.equal(result, recipe);
  assert.equal(attempts, 2);
  assert.deepEqual(
    thresholds.map(({ minimum, greaterThan }) => [minimum, greaterThan]),
    [
      [5n, -1n],
      [8n, 5n],
      [8n, 8n],
    ],
  );
  assert.equal(events.at(-1).event, "dust-fee-ready");
  assert(!JSON.stringify(events).includes("PRIVATE_CANARY"));
});

test("MID-T01 fee-estimator insufficiency is retried, but unrelated or mixed errors are not", async () => {
  const dust = insufficient();
  const fiber = {
    [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
      _tag: "Fail",
      error: dust,
    },
  };
  assert(isInsufficientDust(fiber));
  assert(
    !isInsufficientDust({
      _tag: "Wallet.InsufficientFunds",
      tokenType: "night",
    }),
  );
  assert(
    !isInsufficientDust({
      _tag: "Parallel",
      left: { _tag: "Fail", error: dust },
      right: { _tag: "Fail", error: new Error("network") },
    }),
  );
  let calls = 0;
  let waits = 0;
  const wallet = {
    async calculateTransactionFee() {
      return 1n;
    },
    async estimateTransactionFee() {
      if (++calls === 1) throw fiber;
      return 2n;
    },
    async balanceUnboundTransaction() {
      return {};
    },
  };
  await balanceWithDustReadiness(
    wallet,
    {},
    {},
    { ...options(), emit() {}, wait: async () => BigInt(++waits) },
  );
  assert.equal(calls, 2);
  const unrelated = new Error("submission outcome unknown");
  wallet.balanceUnboundTransaction = async () => {
    throw unrelated;
  };
  await assert.rejects(
    balanceWithDustReadiness(
      wallet,
      {},
      {},
      {
        ...options(),
        emit() {},
        wait: async () => 10n,
      },
    ),
    (error) => error === unrelated,
  );
  assert.equal(calls, 3);
});

test("MID-T01 observed DUST readiness ignores positive-but-insufficient and unsynced balances", async () => {
  const state = (balance, isSynced = true) => ({
    isSynced,
    dust: { balance: () => balance },
  });
  const states = new BehaviorSubject(state(1n));
  const wallet = { state: () => states };
  let resolved = false;
  const pending = waitForDustBalance(wallet, {
    minimum: 10n,
    greaterThan: 1n,
    deadline: Date.now() + 1000,
    tickMs: 5,
  }).then((balance) => {
    resolved = true;
    return balance;
  });
  states.next(state(100n, false));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(resolved, false);
  states.next(state(10n));
  assert.equal(await pending, 10n);
  await assert.rejects(
    waitForDustBalance(wallet, {
      minimum: 100n,
      greaterThan: 10n,
      deadline: Date.now() + 20,
      tickMs: 5,
    }),
    { name: "TimeoutError" },
  );
  states.complete();
});
