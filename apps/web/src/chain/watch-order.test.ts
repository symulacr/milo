/**
 * R34 / V1 — `watchOrderState`: the light subscription branch, no per-message
 * resubscribe, and an attempt budget that counts consecutive failures.
 *
 * Why these tests exist. The live `watchOrderState` has three defects that
 * compound:
 *
 *   1. It subscribes with `{ type: "latest" }`, which the SDK's own doc comment
 *      labels the HEAVY branch: it opens `TXS_FROM_BLOCK_SUB`, so every block on
 *      chain flows over the WebSocket and the client filters for this contract.
 *      `{ type: "all" }` opens `CONTRACT_STATE_SUB($address)`, server-filtered.
 *   2. `next()` calls `schedule()`, which unsubscribes and re-subscribes after a
 *      backoff delay. So the stream is torn down on EVERY emission.
 *   3. Because `attempt` only ever increments, and `latest` emits once per block,
 *      the default budget of 30 is spent by ordinary operation: the order page
 *      stops updating after ~30 blocks and never recovers.
 *
 * The tests below fail against the live file and pass against the work-tree copy.
 * They are written to the same style as `lifecycle.test.ts` (bun:test, a fake
 * `OrderStateSource`, no network) so they can be appended there instead of
 * living in a second file if the lead prefers one test module.
 */
import { describe, expect, test } from "bun:test";
import type { ContractState as RuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import type { OrderContractState } from "./order";
import { watchOrderState } from "./runtime";

const ADDRESS = "ab".repeat(32);

type Observer = {
  next(v: RuntimeContractState): void;
  error(e: unknown): void;
  complete(): void;
};

type Harness = {
  /** One entry per `contractStateObservable` call, i.e. per subscription opened. */
  readonly configs: unknown[];
  readonly observers: Observer[];
  readonly seen: OrderContractState[];
  readonly stales: number[];
  readonly stop: () => void;
  readonly unsubscribed: () => number;
};

/**
 * A source that records every subscription it is asked for, so a test can assert
 * both the config it was given and how many times the stream was re-opened.
 */
const harness = (
  options: {
    attempts?: number;
    onState?: (state: OrderContractState) => void;
    /** Omit to simulate a source with no one-shot read (the pre-V1 shape). */
    withRead?: boolean;
    currentState?: RuntimeContractState | null;
  } = {},
): Harness & { readonly reads: number } => {
  const configs: unknown[] = [];
  const observers: Observer[] = [];
  const seen: OrderContractState[] = [];
  const stales: number[] = [];
  let unsubscribed = 0;
  let reads = 0;
  const stop = watchOrderState(
    {
      contractStateObservable(_address: string, config: unknown) {
        configs.push(config);
        return {
          subscribe(observer: Observer) {
            observers.push(observer);
            return {
              unsubscribe() {
                unsubscribed += 1;
              },
            };
          },
        };
      },
      ...(options.withRead === false
        ? {}
        : {
            async contractState() {
              reads += 1;
              return options.currentState ?? null;
            },
          }),
    },
    ADDRESS,
    (state) => {
      seen.push(state);
      options.onState?.(state);
    },
    {
      // Deterministic: no real timers, no jitter, so the attempt arithmetic is
      // the only thing under test.
      wait: async () => {},
      random: () => 1,
      onStale: (ms) => stales.push(ms),
      ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
    },
  );
  return {
    configs,
    observers,
    seen,
    stales,
    stop,
    unsubscribed: () => unsubscribed,
    get reads() {
      return reads;
    },
  };
};

/** Let the queued `wait(...).then(look)` microtasks run. */
const flush = async () => {
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
};

/**
 * A minimal valid contract state. `decodeOrderState` reads the phase out of a
 * real ledger, so the fixture is built from the generated contract exactly as
 * `lifecycle.test.ts:90` does — `initialState` is a FUNCTION taking
 * `(constructorContext, configuration)`, not a property, which is easy to get
 * wrong and fails at runtime rather than at the type level.
 */
const deployedState = async (): Promise<RuntimeContractState> => {
  const runtime = await import("@midnight-ntwrk/compact-runtime");
  const generated = await import(
    "../../../../packages/contract/generated/contract/index.js"
  );
  const { orderWitnesses } = await import("./order");
  const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("preprod"));
  const terms = {
    serviceVersion: 1n,
    packQuantity: 1n,
    outputCount: 3n,
    unitPrice: 36_000n,
    total: 36_000n,
    currency: new TextEncoder().encode("USD"),
    scopeDigest: bytes32(4),
    rightsDigest: bytes32(5),
    paymentPolicy: bytes32(6),
    salt: bytes32(7),
  };
  const secrets = {
    buyer: bytes32(11),
    merchant: bytes32(12),
    operator: bytes32(13),
  };
  const configuration = {
    network,
    orderNonce: bytes32(1),
    termsCommitment: generated.pureCircuits.hashTerms(
      network,
      bytes32(1),
      terms,
    ),
    buyerCommitment: generated.pureCircuits.hashCapability(
      network,
      bytes32(1),
      generated.Role.BUYER,
      secrets.buyer,
    ),
    merchantCommitment: generated.pureCircuits.hashCapability(
      network,
      bytes32(1),
      generated.Role.MERCHANT,
      secrets.merchant,
    ),
    operatorCommitment: generated.pureCircuits.hashCapability(
      network,
      bytes32(1),
      generated.Role.OPERATOR,
      secrets.operator,
    ),
    acceptanceDeadline: 3_600n,
    deliveryDeadline: 7_200n,
    reviewDeadline: 10_800n,
    resolutionDeadline: 14_400n,
  };
  const buyerState = {
    actor: "buyer" as const,
    secret: secrets.buyer,
    terms,
    limit: 36_000n,
  };
  const contract = new generated.Contract(orderWitnesses() as never);
  const context = runtime.createConstructorContext(buyerState, "aa".repeat(32));
  const initial = contract.initialState(
    context as never,
    configuration as never,
  );
  return initial.currentContractState as never;
};

describe("watchOrderState uses the light, server-filtered subscription", () => {
  test("(a) subscribes with { type: 'all' }, not the heavy 'latest' branch", async () => {
    const run = harness({ withRead: false });
    // `all` is the branch the SDK documents as "Light — server-side filter; only
    // this contract's state changes flow over WS". `latest` streams every block.
    expect(run.configs).toEqual([{ type: "all" }]);
    run.stop();
  });

  test("(b) a state emission does NOT unsubscribe or resubscribe", async () => {
    const run = harness();
    const state = await deployedState();
    expect(run.observers).toHaveLength(1);

    run.observers[0].next(state);
    await flush();

    // The stream is long-lived. Re-opening it per emission is what spent the
    // attempt budget and what the indexer's 4.3.3 per-client subscription quota
    // is aimed at.
    expect(run.unsubscribed()).toBe(0);
    expect(run.observers).toHaveLength(1);
    expect(run.configs).toHaveLength(1);
    run.stop();
  });

  test("(c) a successful emission resets the attempt budget", async () => {
    // Budget of 2. If `attempt` were never reset, two drops would exhaust it and
    // the third subscription would never open. With a reset on success, the
    // stream survives an unbounded number of drops as long as each is followed by
    // a successful emission.
    const run = harness({ attempts: 2 });
    const state = await deployedState();

    for (let round = 0; round < 5; round += 1) {
      const observer = run.observers.at(-1);
      expect(observer).toBeDefined();
      observer?.error(new Error("indexer dropped"));
      await flush();
      // A new subscription must have opened despite the tiny budget.
      expect(run.observers.length).toBe(round + 2);
      run.observers.at(-1)?.next(state);
      await flush();
    }
    run.stop();
  });

  test("(d) an error still resubscribes with backoff and reports the delay", async () => {
    // No read, so the first subscribe is synchronous and the test can drive the
    // observer immediately. With a read the subscribe is one microtask later,
    // which is covered by the read-then-stream group below.
    const run = harness({ attempts: 3, withRead: false });
    expect(run.observers).toHaveLength(1);

    run.observers[0].error(new Error("indexer dropped"));
    await flush();

    expect(run.observers).toHaveLength(2);
    // The dead subscription is dropped before waiting, so it cannot leak.
    expect(run.unsubscribed()).toBe(1);
    // `onStale` fired with the delay the UI shows while it waits.
    expect(run.stales.length).toBeGreaterThan(0);
    expect(run.stales[0]).toBeGreaterThan(0);
    run.stop();
  });

  test("(e) an order page keeps updating past the old 30-block ceiling", async () => {
    // The regression this guards: with `latest` emitting once per block and
    // `attempt` only incrementing, 100 blocks killed the subscription at 30.
    const run = harness();
    const state = await deployedState();
    expect(run.observers).toHaveLength(1);

    for (let block = 0; block < 100; block += 1) {
      run.observers[0].next(state);
      await flush();
    }

    // Still the original subscription: never torn down, never re-opened.
    expect(run.observers).toHaveLength(1);
    expect(run.unsubscribed()).toBe(0);
    // And the unchanged-state dedupe still holds, so 100 blocks of a quiet order
    // is one publish, not 100.
    expect(run.seen).toHaveLength(1);
    run.stop();
  });

  test("the unchanged-state dedupe survives the branch change", async () => {
    // `all` only emits on change, so this is defence in depth rather than the
    // primary mechanism — but a duplicate emission must still not re-render.
    const run = harness();
    const state = await deployedState();
    for (let i = 0; i < 5; i += 1) {
      run.observers[0].next(state);
      await flush();
    }
    expect(run.seen).toHaveLength(1);
    run.stop();
  });

  test("stop() unsubscribes once and silences later emissions", async () => {
    const run = harness();
    const state = await deployedState();
    const observer = run.observers[0];
    run.stop();
    expect(run.unsubscribed()).toBe(1);
    observer.next(state);
    await flush();
    expect(run.seen).toHaveLength(0);
    // A second stop is a no-op, not a second unsubscribe.
    run.stop();
    expect(run.unsubscribed()).toBe(1);
  });

  test("a complete() also resubscribes rather than freezing the page", async () => {
    const run = harness({ attempts: 3, withRead: false });
    run.observers[0].complete();
    await flush();
    expect(run.observers).toHaveLength(2);
    run.stop();
  });
});

describe("watchOrderState delivers the current state before streaming", () => {
  // Why this matters. The SDK's `all` branch is:
  //   waitForContractToAppear(...)(address)(null).pipe(
  //     Rx.concatMap(() => blockOffsetToContractState$(client)(address)(null)))
  // The `concatMap(() => ...)` DISCARDS the state the presence poll fetched, and
  // the subscription opens with `offset: null`, which the indexer resolves as
  // "latest block". So `all` alone does not replay the current state: a page that
  // mounts on a quiet order would render nothing until the next change.
  // `latest` did not have that problem, which is why switching branches without
  // this read is a regression rather than a pure win.

  test("reads the current state once, before subscribing", async () => {
    const state = await deployedState();
    const order: string[] = [];
    const run = harness({
      currentState: state,
      onState: () => order.push("read"),
    });
    await flush();
    // The read happened exactly once and was published.
    expect(run.reads).toBe(1);
    expect(order).toEqual(["read"]);
    run.stop();
  });

  test("publishes the read state even if the stream never emits", async () => {
    const state = await deployedState();
    const run = harness({ currentState: state });
    await flush();
    // One publish from the read, zero from the subscription.
    expect(run.seen).toHaveLength(1);
    expect(run.observers).toHaveLength(1);
    run.stop();
  });

  test("a null read is not published and does not stop the stream", async () => {
    // A contract that is not yet indexed returns null. That is not an error: the
    // subscription is still the thing that will deliver it.
    const run = harness({ currentState: null });
    await flush();
    expect(run.seen).toHaveLength(0);
    expect(run.observers).toHaveLength(1);
    run.stop();
  });

  test("a failing read does not prevent the subscription", async () => {
    // The read is best-effort. If the indexer hiccups on the one-shot query, the
    // stream must still be opened.
    const configs: unknown[] = [];
    const observers: Observer[] = [];
    const stop = watchOrderState(
      {
        contractStateObservable(_address: string, config: unknown) {
          configs.push(config);
          return {
            subscribe(observer: Observer) {
              observers.push(observer);
              return { unsubscribe() {} };
            },
          };
        },
        async contractState() {
          throw new Error("indexer hiccup");
        },
      },
      ADDRESS,
      () => {},
      { wait: async () => {}, random: () => 1 },
    );
    await flush();
    expect(configs).toEqual([{ type: "all" }]);
    expect(observers).toHaveLength(1);
    stop();
  });

  test("a source without the read still works", async () => {
    // The read is optional so existing fixtures and any caller that only has an
    // observable keep working.
    const run = harness({ withRead: false });
    await flush();
    expect(run.reads).toBe(0);
    expect(run.configs).toEqual([{ type: "all" }]);
    expect(run.observers).toHaveLength(1);
    run.stop();
  });
});
