import assert from "node:assert/strict";
import {
  combineLatest,
  filter,
  firstValueFrom,
  map,
  timeout,
  timer,
} from "rxjs";

export function isInsufficientDust(error) {
  const queue = [error];
  const seen = new Set();
  let found = false;
  for (let count = 0; queue.length && count < 16; count++) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (
      value._tag === "Wallet.InsufficientFunds" &&
      value.tokenType === "dust"
    ) {
      found = true;
      continue;
    }
    const fiberCause = value[Symbol.for("effect/Runtime/FiberFailure/Cause")];
    if (fiberCause) queue.push(fiberCause);
    else if (value._tag === "Fail") queue.push(value.error);
    else if (value._tag === "Wallet.Transacting" && value.cause)
      queue.push(value.cause);
    else if (value._tag === "Sequential" || value._tag === "Parallel")
      queue.push(value.left, value.right);
    else return false;
  }
  return found && queue.length === 0;
}

export function waitForDustBalance(
  wallet,
  { minimum, greaterThan, deadline, tickMs = 1000 },
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    const error = new Error("DUST readiness deadline reached");
    error.name = "TimeoutError";
    throw error;
  }
  // DUST accrues with time even between indexer emissions; always use observed wallet state.
  return firstValueFrom(
    combineLatest([wallet.state(), timer(0, tickMs)]).pipe(
      filter(([state]) => state.isSynced),
      map(([state]) => state.dust.balance(new Date())),
      filter((balance) => balance >= minimum && balance > greaterThan),
      timeout({ first: remaining }),
    ),
  );
}

export async function balanceWithDustReadiness(
  wallet,
  tx,
  secretKeys,
  { ttl, deadline, emit, wait = waitForDustBalance },
) {
  let minimum = await wallet.calculateTransactionFee(tx);
  assert(typeof minimum === "bigint" && minimum >= 0n);
  let previous = -1n;
  let attempt = 0;
  const boundedDeadline = Math.min(deadline, ttl.getTime());
  while (true) {
    const observed = await wait(wallet, {
      minimum,
      greaterThan: previous,
      deadline: boundedDeadline,
    });
    assert(observed >= minimum && observed > previous);
    attempt++;
    emit("dust-base-fee-covered", { attempt });
    try {
      const estimated = await wallet.estimateTransactionFee(
        tx,
        secretKeys.dustSecretKey,
        {
          ttl,
          currentTime: new Date(),
        },
      );
      assert(typeof estimated === "bigint" && estimated >= 0n);
      if (observed < estimated) {
        minimum = estimated;
        previous = observed;
        emit("dust-accrual-wait", {
          attempt,
          reason: "estimated-total-fee-not-yet-covered",
        });
        continue;
      }
      const recipe = await wallet.balanceUnboundTransaction(tx, secretKeys, {
        ttl,
      });
      emit("dust-fee-ready", { attempt, actualBalancingSucceeded: true });
      return recipe;
    } catch (error) {
      if (!isInsufficientDust(error)) throw error;
      previous = observed;
      emit("dust-accrual-wait", {
        attempt,
        reason: "typed-insufficient-dust-before-submission",
      });
    }
  }
}
