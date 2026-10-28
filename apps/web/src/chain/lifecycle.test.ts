import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as runtime from "@midnight-ntwrk/compact-runtime";
import { Window } from "happy-dom";
import * as Generated from "../../../../packages/contract/generated/contract/index.js";
import {
  circuitArguments,
  type OrderConfiguration,
  orderWitnesses,
} from "./order";
// `fakeIdb` was already imported from here; the shared fixtures join it.
import { bytes32, fakeIdb, terms } from "./private-state.test";
import { backoffDelay, decodeOrderState, watchOrderState } from "./runtime";
import { initChainWasmFrom } from "./wasm";

/** The smallest valid wasm module: the 8-byte header and nothing else. */
const WASM = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0);

/** The digest the build plugin records for a wasm body. */
const sha256Of = async (bytes: Uint8Array) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  ).toHex();

const network = (() => {
  const value = new Uint8Array(32);
  value.set(new TextEncoder().encode("preprod"));
  return value;
})();

const now = BigInt(Math.floor(Date.now() / 1000));

const secrets = {
  buyer: bytes32(11),
  merchant: bytes32(12),
  operator: bytes32(13),
};

const configuration: OrderConfiguration = {
  network,
  orderNonce: bytes32(1),
  termsCommitment: Generated.pureCircuits.hashTerms(network, bytes32(1), terms),
  buyerCommitment: Generated.pureCircuits.hashCapability(
    network,
    bytes32(1),
    Generated.Role.BUYER,
    secrets.buyer,
  ),
  merchantCommitment: Generated.pureCircuits.hashCapability(
    network,
    bytes32(1),
    Generated.Role.MERCHANT,
    secrets.merchant,
  ),
  operatorCommitment: Generated.pureCircuits.hashCapability(
    network,
    bytes32(1),
    Generated.Role.OPERATOR,
    secrets.operator,
  ),
  acceptanceDeadline: now + 3_600n,
  deliveryDeadline: now + 7_200n,
  reviewDeadline: now + 10_800n,
  resolutionDeadline: now + 14_400n,
};

const buyerState = {
  actor: "buyer" as const,
  secret: secrets.buyer,
  terms,
  limit: 36_000n,
};

const contract = new Generated.Contract(orderWitnesses() as never);

const deployState = () => {
  const context = runtime.createConstructorContext(buyerState, "aa".repeat(32));
  return contract.initialState(context, configuration);
};

const circuitContextFor = (initial: ReturnType<typeof deployState>) =>
  runtime.createCircuitContext(
    "00".repeat(32),
    initial.currentZswapLocalState,
    runtime.ContractState.deserialize(initial.currentContractState.serialize()),
    buyerState,
  );

const nextState = (result: {
  context: { currentQueryContext: { state: { state: unknown } } };
}) => result.context.currentQueryContext.state.state as never;

const phaseOf = (state: unknown) =>
  Generated.ledger(
    runtime.ContractState.deserialize(
      (state as { serialize(): Uint8Array }).serialize(),
    ).data,
  );

const ledgerOf = (result: {
  context: { currentQueryContext: { state: { state: unknown } } };
}) => Generated.ledger(nextState(result));

describe("the compiled contract executes the lifecycle the module drives", () => {
  test("the constructor deploys phase DEPLOYED at revision 0", () => {
    const initial = deployState();
    const ledger = phaseOf(initial.currentContractState);
    expect(ledger.phase).toBe(Generated.Phase.DEPLOYED);
    expect(ledger.revision).toBe(0n);
    expect(ledger.protocolVersion).toBe(1n);
  });

  test("reserve moves DEPLOYED to RESERVED and bumps the revision", () => {
    const initial = deployState();
    const [revision] = circuitArguments("reserve", { expectedRevision: 0n });
    const result = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      revision as bigint,
    );
    const ledger = ledgerOf(result);
    expect(ledger.phase).toBe(Generated.Phase.RESERVED);
    expect(ledger.revision).toBe(1n);
  });

  test("reserve refuses a stale revision", () => {
    const initial = deployState();
    expect(() =>
      contract.provableCircuits.reserve(circuitContextFor(initial), 1n),
    ).toThrow(/stale revision/);
  });

  test("reserve refuses a second call once reserved", () => {
    const initial = deployState();
    const first = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const nextContext = runtime.createCircuitContext(
      "00".repeat(32),
      initial.currentZswapLocalState,
      nextState(first),
      buyerState,
    );
    expect(() => contract.provableCircuits.reserve(nextContext, 1n)).toThrow(
      /reserve requires deployed/,
    );
  });

  test("reserve refuses a buyer whose secret does not match the commitment", () => {
    const initial = deployState();
    const context = runtime.createCircuitContext(
      "00".repeat(32),
      initial.currentZswapLocalState,
      runtime.ContractState.deserialize(
        initial.currentContractState.serialize(),
      ),
      { ...buyerState, secret: bytes32(99) },
    );
    expect(() => contract.provableCircuits.reserve(context, 0n)).toThrow(
      /buyer capability required/,
    );
  });

  test("reserve refuses an approval limit below the order total", () => {
    const initial = deployState();
    const context = runtime.createCircuitContext(
      "00".repeat(32),
      initial.currentZswapLocalState,
      runtime.ContractState.deserialize(
        initial.currentContractState.serialize(),
      ),
      { ...buyerState, limit: 1n },
    );
    expect(() => contract.provableCircuits.reserve(context, 0n)).toThrow(
      /buyer limit exceeded/,
    );
  });

  test("cancelReserved moves RESERVED to CANCELLED", () => {
    const initial = deployState();
    const reserved = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const context = runtime.createCircuitContext(
      "00".repeat(32),
      initial.currentZswapLocalState,
      nextState(reserved),
      buyerState,
    );
    const cancelled = contract.provableCircuits.cancelReserved(context, 1n);
    const ledger = ledgerOf(cancelled);
    expect(ledger.phase).toBe(Generated.Phase.CANCELLED);
    expect(ledger.revision).toBe(2n);
  });

  test("accept requires the merchant's own private state", () => {
    const initial = deployState();
    const reserved = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const context = runtime.createCircuitContext(
      "00".repeat(32),
      initial.currentZswapLocalState,
      nextState(reserved),
      buyerState,
    );
    expect(() => contract.provableCircuits.accept(context, 1n)).toThrow(
      /merchant witness was requested with another actor's private state/,
    );
  });

  test("submitDelivery takes the commitment the module passes", () => {
    const initial = deployState();
    const reserved = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const merchantState = {
      actor: "merchant" as const,
      secret: secrets.merchant,
      terms,
      limit: 0n,
    };
    const accepted = contract.provableCircuits.accept(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(reserved),
        merchantState,
      ),
      1n,
    );
    const commitment = bytes32(21);
    const [revision, delivered] = circuitArguments("submitDelivery", {
      expectedRevision: 2n,
      commitment,
    });
    const submitted = contract.provableCircuits.submitDelivery(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(accepted),
        merchantState,
      ),
      revision as bigint,
      delivered as Uint8Array,
    );
    const ledger = ledgerOf(submitted);
    expect(ledger.phase).toBe(Generated.Phase.SUBMITTED);
    expect(Array.from(ledger.deliveryCommitment)).toEqual(
      Array.from(commitment),
    );
    expect(ledger.revision).toBe(3n);
  });

  test("resolve takes the decision the module passes", () => {
    const initial = deployState();
    const buyerContext = (state: unknown) =>
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        state as never,
        buyerState,
      );
    const reserved = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const merchantState = {
      actor: "merchant" as const,
      secret: secrets.merchant,
      terms,
      limit: 0n,
    };
    const accepted = contract.provableCircuits.accept(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(reserved),
        merchantState,
      ),
      1n,
    );
    const disputed = contract.provableCircuits.disputeBuyer(
      buyerContext(nextState(accepted)),
      2n,
      bytes32(31),
    );
    const operatorState = {
      actor: "operator" as const,
      secret: secrets.operator,
      terms,
      limit: 0n,
    };
    const resolved = contract.provableCircuits.resolve(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(disputed),
        operatorState,
      ),
      3n,
      false,
      bytes32(31),
    );
    const ledger = ledgerOf(resolved);
    expect(ledger.phase).toBe(Generated.Phase.CANCELLED);
    expect(ledger.revision).toBe(4n);
  });

  test("resolve refuses evidence that does not match the dispute", () => {
    const initial = deployState();
    const buyerContext = (state: unknown) =>
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        state as never,
        buyerState,
      );
    const reserved = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const merchantState = {
      actor: "merchant" as const,
      secret: secrets.merchant,
      terms,
      limit: 0n,
    };
    const accepted = contract.provableCircuits.accept(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(reserved),
        merchantState,
      ),
      1n,
    );
    const disputed = contract.provableCircuits.disputeBuyer(
      buyerContext(nextState(accepted)),
      2n,
      bytes32(31),
    );
    const operatorState = {
      actor: "operator" as const,
      secret: secrets.operator,
      terms,
      limit: 0n,
    };
    expect(() =>
      contract.provableCircuits.resolve(
        runtime.createCircuitContext(
          "00".repeat(32),
          initial.currentZswapLocalState,
          nextState(disputed),
          operatorState,
        ),
        3n,
        false,
        bytes32(32),
      ),
    ).toThrow(/resolution evidence mismatch/);
  });
});

const ADDRESS = "ab".repeat(32);
type Observer = {
  next(v: runtime.ContractState): void;
  error(e: unknown): void;
  complete(): void;
};

const watch = (
  options: {
    attempts?: number;
    onStale?: (ms: number) => void;
    onState?: (state: ReturnType<typeof decodeOrderState>) => void;
  } = {},
) => {
  const observers: Observer[] = [];
  const seen: unknown[] = [];
  let unsubscribed = 0;
  const stop = watchOrderState(
    {
      contractStateObservable(address: string, config: unknown) {
        expect(address).toBe(ADDRESS);
        // `all` is the server-filtered branch; `latest` streamed every block on
        // chain for a client-side filter. See watch-order.test.ts.
        expect(config).toEqual({ type: "all" });
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
      // No one-shot read here, so the first subscribe stays synchronous and the
      // existing tests can drive the observer immediately. The read-then-stream
      // behaviour has its own file.
      contractState: undefined,
    },
    ADDRESS,
    (state) => {
      seen.push(state);
      options.onState?.(state);
    },
    { wait: async () => {}, ...options },
  );
  return {
    observers,
    seen,
    stop,
    get unsubscribed() {
      return unsubscribed;
    },
  };
};

const flush = async () => {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
};

describe("watching the order contract", () => {
  test("decodes the phase, the revision and the empty evidence slot", () => {
    expect(decodeOrderState(deployState().currentContractState)).toEqual({
      phase: "DEPLOYED",
      revision: 0,
      evidenceCommitment: null,
    });
  });

  test("reads the dispute evidence the contract recorded", () => {
    const initial = deployState();
    const merchant = {
      actor: "merchant" as const,
      secret: secrets.merchant,
      terms,
      limit: 0n,
    };
    const reserved = contract.provableCircuits.reserve(
      circuitContextFor(initial),
      0n,
    );
    const accepted = contract.provableCircuits.accept(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(reserved),
        merchant,
      ),
      1n,
    );
    const disputed = contract.provableCircuits.disputeBuyer(
      runtime.createCircuitContext(
        "00".repeat(32),
        initial.currentZswapLocalState,
        nextState(accepted),
        buyerState,
      ),
      2n,
      bytes32(77),
    );
    expect(
      decodeOrderState({
        data: new runtime.ChargedState(nextState(disputed) as never),
      } as never),
    ).toEqual({
      phase: "DISPUTED",
      revision: 3,
      evidenceCommitment: "4d".repeat(32),
    });
  });

  test("reports each decoded state and never invents one", () => {
    const run = watch();
    expect(run.observers).toHaveLength(1);
    run.observers[0].next(deployState().currentContractState);
    expect(run.seen).toEqual([
      { phase: "DEPLOYED", revision: 0, evidenceCommitment: null },
    ]);
    run.stop();
  });

  test("unsubscribe stops the stream and further reports", () => {
    const run = watch();
    const observer = run.observers[0];
    run.stop();
    expect(run.unsubscribed).toBe(1);
    observer.next(deployState().currentContractState);
    expect(run.seen).toEqual([]);
  });

  // Renders: the indexer re-emits the latest state on every block, so an unchanged
  // order would republish — and re-render the order page — once per block. One
  // object per actual change is what keeps a quiet order at one commit, not N.
  test("publishes one state per change, not one per indexer block", () => {
    const run = watch();
    const state = deployState().currentContractState;
    for (let block = 0; block < 5; block += 1) run.observers[0].next(state);
    expect(run.seen).toHaveLength(1);
    run.stop();
  });

  test("a real change still publishes, and the render count follows it", async () => {
    const window = new Window({ url: "http://localhost/" });
    const globals = globalThis as Record<string, unknown>;
    const saved = {
      window: globals.window,
      document: globals.document,
      navigator: globals.navigator,
      HTMLElement: globals.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
    };
    globals.window = window;
    globals.document = window.document;
    globals.navigator = window.navigator;
    globals.HTMLElement = window.HTMLElement;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const act = (React as unknown as { act(fn: () => void): void }).act;

    // The order page reads phase, revision and evidence. The subscription is the
    // chain's own: one publish per change, and the component commits once per
    // publish because the object identity changes only then.
    const store = { state: null as ReturnType<typeof decodeOrderState> | null };
    const listeners = new Set<() => void>();
    const publish = (next: ReturnType<typeof decodeOrderState>) => {
      store.state = next;
      for (const listener of listeners) listener();
    };
    // Lowercase on purpose: these are inline fixtures, and biome 2.6's
    // `noComponentHookFactories` flags any capitalised definition inside a
    // function. This file builds elements with `React.createElement`, not JSX,
    // so a lowercase name is still a plain function reference.
    const chainState = () =>
      React.useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => store.state,
        () => store.state,
      );
    let commits = 0;
    const orderPhaseLine = () => {
      commits += 1;
      const state = chainState();
      return React.createElement(
        "p",
        null,
        `${state?.phase ?? "…"} ${state?.revision ?? 0}`,
      );
    };
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    try {
      act(() => root.render(React.createElement(orderPhaseLine)));
      expect(commits).toBe(1);

      const run = watch({ onState: publish });
      const observer = run.observers[0];
      const deployed = deployState().currentContractState;
      // Each indexer emit is its own WebSocket message, so it is its own task and
      // React commits per task. Four blocks of an unchanged order must not cost
      // four commits.
      for (let block = 0; block < 4; block += 1)
        act(() => observer.next(deployed));
      expect(commits).toBe(2);
      expect(container.textContent).toBe("DEPLOYED 0");

      // A real change publishes once and commits once.
      const merchant = {
        actor: "merchant" as const,
        secret: secrets.merchant,
        terms,
        limit: 0n,
      };
      const reserved = contract.provableCircuits.reserve(
        circuitContextFor(deployState()),
        0n,
      );
      const accepted = contract.provableCircuits.accept(
        runtime.createCircuitContext(
          "00".repeat(32),
          deployState().currentZswapLocalState,
          nextState(reserved),
          merchant,
        ),
        1n,
      );
      act(() =>
        observer.next({
          data: new runtime.ChargedState(nextState(accepted) as never),
        } as never),
      );
      expect(commits).toBe(3);
      expect(container.textContent).toBe("ACCEPTED 2");
      run.stop();
    } finally {
      act(() => root.unmount());
      container.remove();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globals[key];
        else globals[key] = value;
      }
    }
  });

  // H3: a dropped or completed stream is the normal case, not a fatal one. Both must
  // resubscribe with backoff, report the delay, and respect the attempt budget.
  for (const kind of ["complete", "error"] as const) {
    test(`a ${kind} resubscribes with backoff and stops at the budget`, async () => {
      const stales: number[] = [];
      const run = watch({ attempts: 2, onStale: (ms) => stales.push(ms) });
      run.observers[0][kind](new Error("indexer dropped"));
      await flush();
      expect(run.observers).toHaveLength(2);
      expect(run.unsubscribed).toBe(1);
      expect(stales.length).toBeGreaterThan(0);
      // A real state on the new subscription is still decoded and reported.
      run.observers[1].next(deployState().currentContractState);
      expect(run.seen).toEqual([
        { phase: "DEPLOYED", revision: 0, evidenceCommitment: null },
      ]);
      run.stop();
    });

    test(`a ${kind} with no success between drops still exhausts the budget`, async () => {
      // The budget counts CONSECUTIVE failures. A successful emission resets it
      // (see watch-order.test.ts), so exhaustion is only reachable when every
      // attempt fails. This is the case that must still stop rather than spin.
      const stales: number[] = [];
      const run = watch({ attempts: 2, onStale: (ms) => stales.push(ms) });
      run.observers[0][kind](new Error("indexer dropped"));
      await flush();
      expect(run.observers).toHaveLength(2);
      run.observers[1][kind](new Error("indexer dropped"));
      await flush();
      // Two failures against a budget of two: no third subscription.
      expect(run.observers).toHaveLength(2);
      run.stop();
    });
  }

  test("an unreadable state stops rather than reporting a guess", () => {
    const broken = watch();
    broken.observers[0].next(
      runtime.ContractState.deserialize(
        new runtime.ContractState().serialize(),
      ),
    );
    expect(broken.seen).toEqual([]);
    expect(broken.unsubscribed).toBe(1);
    broken.stop();
  });

  test("backoff doubles, caps at 30 s, and jitters within half the delay", () => {
    // random()=0 gives the 50% floor, random()=1 the full delay. attempt 11 would be
    // 2s * 2^10 = 2048s uncapped, so it also proves the 30 s cap.
    expect(backoffDelay(1, 2_000, () => 1)).toBe(2_000);
    expect(backoffDelay(2, 2_000, () => 1)).toBe(4_000);
    expect(backoffDelay(3, 2_000, () => 1)).toBe(8_000);
    expect(backoffDelay(1, 2_000, () => 0)).toBe(1_000);
    expect(backoffDelay(11, 2_000, () => 1)).toBe(30_000);
    expect(backoffDelay(11, 2_000, () => 0)).toBe(15_000);
  });
});

describe("chain wasm loader", () => {
  // Chrome refuses synchronous compile of a module over 8 MB on the main thread,
  // and the ledger module is 10 MB, so only the async calls may be used. The
  // first fetch fails, so this also proves a rejection is not cached.
  test("never uses the synchronous Module or Instance constructors", async () => {
    const real = {
      Module: WebAssembly.Module,
      Instance: WebAssembly.Instance,
      fetch: globalThis.fetch,
    };
    const sync = () => {
      throw new Error("synchronous WebAssembly constructor");
    };
    const seen: unknown[] = [];
    let calls = 0;
    globalThis.fetch = (async () => {
      if (++calls === 1) throw new TypeError("offline");
      return new Response(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0));
    }) as unknown as typeof fetch;
    WebAssembly.Module = Object.assign(sync, {
      imports: real.Module.imports,
    }) as never;
    WebAssembly.Instance = sync as never;
    const asset = {
      bindings: { __wbg_set_wasm: (e: unknown) => seen.push(e) },
      url: "empty.wasm",
      glueModule: "empty",
      sha256: await sha256Of(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0)),
    };
    try {
      await expect(initChainWasmFrom([asset])).rejects.toThrow("downloaded");
      await initChainWasmFrom([asset]);
      await initChainWasmFrom([asset]);
    } finally {
      globalThis.fetch = real.fetch;
      WebAssembly.Module = real.Module;
      WebAssembly.Instance = real.Instance;
    }
    // Two fetches (fail, retry), then the cached module is reused.
    expect([calls, seen.length]).toEqual([2, 1]);
  });

  // C-07/C-11: the wasm is code the page executes, so a body that does not match
  // the digest recorded at build time must never reach the compiler.
  test("refuses a wasm body that does not match its recorded digest", async () => {
    // The loader caches a resolved promise per module instance, so this needs a
    // fresh module rather than the one the earlier tests already initialised.
    const fresh = await import(`./wasm.ts?digest=${Date.now()}`);
    const real = { fetch: globalThis.fetch };
    globalThis.fetch = (async () =>
      new Response(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0))) as never;
    const asset = {
      bindings: { __wbg_set_wasm: () => {} },
      url: "tampered.wasm",
      glueModule: "tampered",
      sha256: "00".repeat(32),
    };
    try {
      await expect(fresh.initChainWasmFrom([asset])).rejects.toThrow(/digest/);
    } finally {
      globalThis.fetch = real.fetch;
    }
  });

  // Speed: a cached module must skip WebAssembly.compile entirely on a repeat
  // visit, keyed by the content digest so a new build is a miss.
  test("reuses a cached module instead of compiling again", async () => {
    const fresh = await import(`./wasm.ts?cache=${Date.now()}`);
    const wasmBytes = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0);
    const sha = await sha256Of(wasmBytes);
    let compiles = 0;
    const real = {
      fetch: globalThis.fetch,
      compile: WebAssembly.compile,
      idb: (globalThis as { indexedDB?: unknown }).indexedDB,
    };
    Object.defineProperty(globalThis, "indexedDB", {
      value: fakeIdb(),
      configurable: true,
    });
    globalThis.fetch = (async () => new Response(wasmBytes)) as never;
    WebAssembly.compile = (async (b: BufferSource) => {
      compiles += 1;
      return real.compile(b);
    }) as never;
    const asset = {
      bindings: { __wbg_set_wasm: () => {} },
      url: "cached.wasm",
      glueModule: "cached",
      sha256: sha,
    };
    try {
      await fresh.initChainWasmFrom([asset]);
      expect(compiles).toBe(1);
      // A second module instance with the same digest hits the cache.
      const again = await import(`./wasm.ts?cache2=${Date.now()}`);
      await again.initChainWasmFrom([asset]);
      expect(compiles).toBe(1);
    } finally {
      globalThis.fetch = real.fetch;
      WebAssembly.compile = real.compile;
      Object.defineProperty(globalThis, "indexedDB", {
        value: real.idb,
        configurable: true,
      });
    }
  });

  // Each case below is one way the loader must fail with the module named rather
  // than an opaque error: the glue layout changed, the body is not wasm, or the
  // rejection carries no Error at all.
  const FAILURES: readonly (readonly [
    string,
    () => typeof fetch,
    Uint8Array,
    Record<string, unknown>,
    RegExp,
  ])[] = [
    [
      "bindings without __wbg_set_wasm",
      () => (async () => new Response(WASM)) as never,
      WASM,
      {},
      /__wbg_set_wasm/,
    ],
    [
      "a body that is not valid wasm",
      () => (async () => new Response(Uint8Array.of(1, 2, 3, 4))) as never,
      Uint8Array.of(1, 2, 3, 4),
      { __wbg_set_wasm: () => {} },
      /broken module could not be instantiated/,
    ],
    [
      "a rejection that is not an Error",
      () => (() => Promise.reject("offline")) as never,
      WASM,
      { __wbg_set_wasm: () => {} },
      /could not be downloaded\. offline/,
    ],
  ];

  for (const [name, fetchImpl, bytes, bindings, message] of FAILURES)
    test(`names the module when the loader meets ${name}`, async () => {
      const fresh = await import(`./wasm.ts?${name.length}=${Date.now()}`);
      const real = { fetch: globalThis.fetch };
      globalThis.fetch = fetchImpl();
      try {
        await expect(
          fresh.initChainWasmFrom([
            {
              bindings,
              url: "broken.wasm",
              glueModule: "broken",
              sha256: await sha256Of(bytes),
            },
          ]),
        ).rejects.toThrow(message);
      } finally {
        globalThis.fetch = real.fetch;
      }
    });

  // A non-200 response must be reported with its status, not compiled: an SPA
  // fallback page served as 200 text/html is the common failure, and a 404 is the
  // other. Compiling either would throw an opaque CompileError.
  test("reports the status of a wasm response that is not ok", async () => {
    const fresh = await import(`./wasm.ts?status=${Date.now()}`);
    const real = { fetch: globalThis.fetch };
    globalThis.fetch = (async () =>
      new Response("not found", {
        status: 404,
        statusText: "Not Found",
      })) as never;
    try {
      await expect(
        fresh.initChainWasmFrom([
          {
            bindings: { __wbg_set_wasm: () => {} },
            url: "missing.wasm",
            glueModule: "missing",
            sha256: "00".repeat(32),
          },
        ]),
      ).rejects.toThrow(/404 Not Found/);
    } finally {
      globalThis.fetch = real.fetch;
    }
  });

  // A cache that cannot be read or written is not a failure: the module is already
  // compiled and usable, and the next visit simply compiles again. Losing the whole
  // deploy because IndexedDB is full would be a far worse trade.
  test("still runs when the module cache cannot be read or written", async () => {
    const fresh = await import(`./wasm.ts?broken=${Date.now()}`);
    const real = {
      fetch: globalThis.fetch,
      idb: (globalThis as { indexedDB?: unknown }).indexedDB,
    };
    const seen: unknown[] = [];
    Object.defineProperty(globalThis, "indexedDB", {
      value: {
        // A failing open must be swallowed by the cache readers.
        open: () => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            (request.onerror as () => void)?.();
          });
          return request;
        },
      },
      configurable: true,
    });
    globalThis.fetch = (async () => new Response(WASM)) as never;
    try {
      await fresh.initChainWasmFrom([
        {
          bindings: {
            __wbg_set_wasm: (exports: unknown) => seen.push(exports),
          },
          url: "nocache.wasm",
          glueModule: "nocache",
          sha256: await sha256Of(WASM),
        },
      ]);
      expect(seen).toHaveLength(1);
    } finally {
      globalThis.fetch = real.fetch;
      Object.defineProperty(globalThis, "indexedDB", {
        value: real.idb,
        configurable: true,
      });
    }
  });

  // Each module keeps its own promise, so initialising the onchain runtime alone
  // (the pure-hash path) must not mark the ledger as done, and vice versa.
  test("initialises each module once, independently of the others", async () => {
    const fresh = await import(`./wasm.ts?each=${Date.now()}`);
    const sha = await sha256Of(WASM);
    const real = { fetch: globalThis.fetch };
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(WASM);
    }) as never;
    const asset = (glueModule: string) => ({
      bindings: { __wbg_set_wasm: () => {} },
      url: `${glueModule}.wasm`,
      glueModule,
      sha256: sha,
    });
    try {
      await fresh.initChainWasmFrom([asset("onchain")]);
      expect(fetches).toBe(1);
      // Re-initialising the same module reuses its promise.
      await fresh.initChainWasmFrom([asset("onchain")]);
      expect(fetches).toBe(1);
      // The ledger module is separate work.
      await fresh.initChainWasmFrom([asset("onchain"), asset("ledger")]);
      expect(fetches).toBe(2);
    } finally {
      globalThis.fetch = real.fetch;
    }
  });
});
// ---------------------------------------------------------------------------
// End-to-end order walk on the real contract runtime.
//
// The REAL generated circuits run against an in-memory chain: no network, no
// wallet, no Lace, no proof server. The only fake is the connector, and it fakes
// exactly what a wallet does — apply a submitted call to the stored contract
// state and report that state back. A call's transcript program IS the circuit,
// so applying a call means running the circuit. Commitments, argument encoding,
// state decoding and serialization are all the shipped code.
// ---------------------------------------------------------------------------

/** address -> serialized ContractState. */
const chain = new Map<string, Uint8Array>();

const ledgerAt = (address: string) =>
  Generated.ledger(
    runtime.ContractState.deserialize(chain.get(address) as Uint8Array).data,
  );

/** Run one circuit against the stored state and commit the result. */
const applyCall = (
  address: string,
  circuit: string,
  args: readonly unknown[],
  privateState: unknown,
) => {
  const stored = runtime.ContractState.deserialize(
    chain.get(address) as Uint8Array,
  );
  const run = (
    contract.provableCircuits as unknown as Record<
      string,
      (
        ctx: unknown,
        ...rest: unknown[]
      ) => {
        context: { currentQueryContext: { state: unknown } };
      }
    >
  )[circuit];
  const result = run(
    runtime.createCircuitContext(
      "00".repeat(32),
      deployState().currentZswapLocalState,
      stored,
      privateState as never,
    ),
    ...args,
  );
  const next = new runtime.ContractState();
  next.data = result.context.currentQueryContext.state as never;
  next.maintenanceAuthority = stored.maintenanceAuthority;
  for (const name of stored.operations()) {
    const op = stored.operation(name);
    if (op) next.setOperation(name, op);
  }
  chain.set(address, next.serialize());
  return result;
};

/** Deploy a fresh order at a fixed address and return it. */
const deployAt = (address: string, config = configuration) => {
  chain.clear();
  const context = runtime.createConstructorContext(buyerState, "aa".repeat(32));
  const initial = contract.initialState(context, config);
  chain.set(address, initial.currentContractState.serialize());
  return address;
};

const merchantState = {
  actor: "merchant" as const,
  secret: secrets.merchant,
  terms,
  limit: 0n,
};

describe("end-to-end order walk on the real contract runtime", () => {
  // The walk the forms drive, one row per circuit. Each row asserts the real
  // circuit's ledger state AND the phase the server projection would store, so a
  // disagreement between the two is a failure rather than a silent drift.
  test("the order walks DEPLOYED to APPROVED on real circuits", () => {
    const address = deployAt("ab".repeat(32));
    const delivery = bytes32(0x5a);
    const steps = [
      ["reserve", [0n], buyerState, "RESERVED"],
      ["accept", [1n], merchantState, "ACCEPTED"],
      ["submitDelivery", [2n, delivery], merchantState, "SUBMITTED"],
      ["approve", [3n, delivery], buyerState, "APPROVED"],
    ] as const;

    for (const [circuit, args, state, phase] of steps) {
      applyCall(address, circuit, args, state);
      // The chain's own decoder must agree with the raw ledger, and both must
      // agree with the name the server projection stores.
      expect([circuit, ledgerAt(address).phase]).toEqual([
        circuit,
        Generated.Phase[phase as keyof typeof Generated.Phase],
      ]);
      expect([
        circuit,
        decodeOrderState(
          runtime.ContractState.deserialize(chain.get(address) as Uint8Array),
        ).phase,
      ]).toEqual([circuit, phase]);
    }

    const final = ledgerAt(address);
    expect(final.revision).toBe(4n);
    expect(final.deliveryCommitment).toEqual(delivery);
    // APPROVED is terminal: no circuit accepts a further revision.
    expect(() => applyCall(address, "reserve", [4n], buyerState)).toThrow(
      /reserve requires deployed/,
    );
  }, 120_000);

  test("a stale expectedRevision is refused and changes nothing", () => {
    const address = deployAt("cd".repeat(32));
    applyCall(address, "reserve", [0n], buyerState);
    const before = chain.get(address) as Uint8Array;
    // Replaying revision 0 when the chain is at 1 is the classic double-submit.
    expect(() => applyCall(address, "accept", [0n], buyerState)).toThrow(
      /stale revision/,
    );
    expect(chain.get(address)).toEqual(before);
  }, 120_000);

  // A past-deadline order can only use the timeout circuits. This is the honest
  // statement of when C-04 bites: an order that never reached SUBMITTED cannot
  // escalate at all, so the defect only strands an order that did.
  test("a past-deadline order expires rather than escalating", () => {
    const past = BigInt(Math.floor(Date.now() / 1000)) - 10_000n;
    const address = deployAt("ef".repeat(32), {
      ...configuration,
      acceptanceDeadline: past,
      deliveryDeadline: past + 1n,
      reviewDeadline: past + 2n,
      resolutionDeadline: past + 3n,
    });
    expect(ledgerAt(address).phase).toBe(Generated.Phase.DEPLOYED);
    applyCall(address, "expireBootstrap", [0n], buyerState);
    expect(ledgerAt(address).phase).toBe(Generated.Phase.CANCELLED);
    expect(ledgerAt(address).evidenceCommitment).toEqual(new Uint8Array(32));
  }, 120_000);

  // C-04, asserted at its source rather than by executing escalate: the circuit
  // gates on `reached(reviewDeadline)`, which reads real block time, so an order
  // inside its deadlines cannot escalate in this harness. The defect was that the
  // escalation body never assigned evidenceCommitment while resolve requires a
  // non-default value equal to the stored one. The fix routes the escalation
  // through recordDispute with the delivery as the evidence, so this now asserts
  // the fixed shape: the escalation records evidence and no longer performs a
  // bare move that would leave the commitment at default.
  test("C-04: escalate records the delivery as dispute evidence", () => {
    const source = readFileSync(
      new URL(
        "../../../../packages/contract/src/order.compact",
        import.meta.url,
      ),
      "utf8",
    );
    const escalate = source.slice(
      source.indexOf("export circuit escalateUnreviewed"),
      source.indexOf("export circuit expireDispute"),
    );
    expect(escalate).toContain("recordDispute(deliveryCommitment)");
    expect(escalate).not.toContain("move(Phase.DISPUTED)");
    const resolve = source.slice(
      source.indexOf("export circuit resolve"),
      source.indexOf("// Integer seconds"),
    );
    expect(resolve).toContain("empty resolution evidence");
    expect(resolve).toContain("resolution evidence mismatch");
  });
});
