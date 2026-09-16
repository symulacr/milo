import { describe, expect, test } from "bun:test";
import {
  ChargedState,
  type CircuitContext,
  type CircuitResults,
  type CompactType,
  CompactTypeBytes,
  CompactTypeUnsignedInteger,
  createCircuitContext,
  createConstructorContext,
  StateValue,
} from "@midnight-ntwrk/compact-runtime";
import {
  type Configuration,
  Contract,
  type ImpureCircuits,
  ledger,
  Phase,
  pureCircuits,
  Role,
  type Terms,
  type Witnesses,
} from "../generated/contract/index.js";

// Synthetic openings only. This executes generated code, not a proof or node.
const bytes = (value: number) => new Uint8Array(32).fill(value);
const network = bytes(1);
const nonce = bytes(2);
const secrets = { buyer: bytes(3), merchant: bytes(4), operator: bytes(5) };
const delivery = bytes(6);
const evidence = bytes(7);
const terms: Terms = {
  serviceVersion: 1n,
  packQuantity: 1n,
  outputCount: 3n,
  unitPrice: 36_000n,
  total: 36_000n,
  currency: new TextEncoder().encode("USD"),
  scopeDigest: bytes(8),
  rightsDigest: bytes(9),
  paymentPolicy: bytes(10),
  salt: bytes(11),
};
type Actor = keyof typeof secrets;
type PrivateState = {
  actor?: Actor;
  secret?: Uint8Array;
  terms?: Terms;
  limit?: bigint;
};
const requireValue = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("unavailable actor-local witness");
  return value;
};
const roleWitness =
  (actor: Actor): Witnesses<PrivateState>["buyerSecret"] =>
  ({ privateState }) => {
    if (privateState.actor !== actor)
      throw new Error("other actor witness requested");
    return [privateState, requireValue(privateState.secret)];
  };
const contract = new Contract<PrivateState>({
  buyerSecret: roleWitness("buyer"),
  merchantSecret: roleWitness("merchant"),
  operatorSecret: roleWitness("operator"),
  agreedTerms: ({ privateState }) => [
    privateState,
    requireValue(privateState.terms),
  ],
  buyerApprovalLimit: ({ privateState }) => [
    privateState,
    requireValue(privateState.limit),
  ],
});
const configFor = (opening = terms): Configuration => ({
  network,
  orderNonce: nonce,
  termsCommitment: pureCircuits.hashTerms(network, nonce, opening),
  buyerCommitment: pureCircuits.hashCapability(
    network,
    nonce,
    Role.BUYER,
    secrets.buyer,
  ),
  merchantCommitment: pureCircuits.hashCapability(
    network,
    nonce,
    Role.MERCHANT,
    secrets.merchant,
  ),
  operatorCommitment: pureCircuits.hashCapability(
    network,
    nonce,
    Role.OPERATOR,
    secrets.operator,
  ),
  acceptanceDeadline: 100n,
  deliveryDeadline: 200n,
  reviewDeadline: 300n,
  resolutionDeadline: 400n,
});
const privateFor = (actor?: Actor): PrivateState =>
  actor
    ? {
        actor,
        secret: secrets[actor],
        ...(actor !== "operator" ? { terms } : {}),
        ...(actor === "buyer" ? { limit: 36_000n } : {}),
      }
    : {};
type Action = keyof ImpureCircuits<PrivateState>;
type Args<A extends Action> =
  Parameters<ImpureCircuits<PrivateState>[A]> extends [unknown, ...infer R]
    ? R
    : never;
const circuits: {
  [A in Action]: (
    context: CircuitContext<PrivateState>,
    ...args: Args<A>
  ) => CircuitResults<PrivateState, []>;
} = contract.impureCircuits;

class Harness {
  state;
  constructor(config = configFor()) {
    this.state = contract.initialState(
      createConstructorContext<PrivateState>({}, "00".repeat(32)),
      config,
    ).currentContractState.data;
  }
  get public() {
    return ledger(this.state);
  }
  call<A extends Action>(
    action: A,
    actor: Actor | undefined,
    time: number,
    args: Args<A>,
    overrides: Partial<PrivateState> = {},
  ) {
    const context = createCircuitContext(
      "00".repeat(32),
      "00".repeat(32),
      this.state,
      { ...privateFor(actor), ...overrides },
      undefined,
      undefined,
      time,
    );
    const result = circuits[action](context, ...args);
    this.state = result.context.currentQueryContext.state;
    return result;
  }
}
function at(phase: Phase): Harness {
  const h = new Harness();
  if (phase === Phase.DEPLOYED) return h;
  h.call("reserve", "buyer", 50, [0n]);
  if (phase === Phase.RESERVED) return h;
  h.call("accept", "merchant", 60, [1n]);
  if (phase === Phase.ACCEPTED) return h;
  h.call("submitDelivery", "merchant", 150, [2n, delivery]);
  if (phase === Phase.SUBMITTED) return h;
  h.call("disputeBuyer", "buyer", 250, [3n, evidence]);
  return h;
}

const b32 = new CompactTypeBytes(32);
const u64 = new CompactTypeUnsignedInteger((1n << 64n) - 1n, 8);
const configFields: {
  [K in keyof Configuration]: CompactType<Configuration[K]>;
} = {
  network: b32,
  orderNonce: b32,
  termsCommitment: b32,
  buyerCommitment: b32,
  merchantCommitment: b32,
  operatorCommitment: b32,
  acceptanceDeadline: u64,
  deliveryDeadline: u64,
  reviewDeadline: u64,
  resolutionDeadline: u64,
};
function injectCell(h: Harness, index: number, cell: StateValue) {
  // Positional raw ledger layout is checked by the generated decoder below.
  const cells = requireValue(h.state.state.asArray());
  expect(cells).toHaveLength(6);
  cells[index] = cell;
  h.state = new ChargedState(
    cells.reduce(
      (state, value) => state.arrayPush(value),
      StateValue.newArray(),
    ),
  );
}
function injectConfiguration(h: Harness, configuration: Configuration) {
  const keys = Object.keys(configFields) as (keyof Configuration)[];
  const value = <K extends keyof Configuration>(key: K) =>
    configFields[key].toValue(configuration[key]);
  injectCell(
    h,
    1,
    StateValue.newCell({
      alignment: keys.flatMap((key) => configFields[key].alignment()),
      value: keys.flatMap(value),
    }),
  );
  expect(h.public.configuration).toEqual(configuration);
}

describe("generated-runtime only: M-02/M-03; MID rows remain network-unverified", () => {
  test("all lifecycle entrypoints reject exhausted revisions before mutation", () => {
    const max = (1n << 64n) - 1n;
    const attempts: [Phase, (h: Harness) => unknown][] = [
      [Phase.DEPLOYED, (h) => h.call("reserve", "buyer", 50, [max])],
      [Phase.RESERVED, (h) => h.call("accept", "merchant", 60, [max])],
      [Phase.RESERVED, (h) => h.call("cancelReserved", "buyer", 60, [max])],
      [Phase.RESERVED, (h) => h.call("decline", "merchant", 60, [max])],
      [
        Phase.ACCEPTED,
        (h) => h.call("submitDelivery", "merchant", 150, [max, delivery]),
      ],
      [
        Phase.SUBMITTED,
        (h) => h.call("approve", "buyer", 250, [max, delivery]),
      ],
      [
        Phase.ACCEPTED,
        (h) => h.call("disputeBuyer", "buyer", 150, [max, evidence]),
      ],
      [
        Phase.ACCEPTED,
        (h) => h.call("disputeMerchant", "merchant", 150, [max, evidence]),
      ],
      [
        Phase.DISPUTED,
        (h) => h.call("resolve", "operator", 350, [max, true, evidence]),
      ],
      [Phase.DEPLOYED, (h) => h.call("expireBootstrap", undefined, 100, [max])],
      [Phase.RESERVED, (h) => h.call("expireReserved", undefined, 100, [max])],
      [
        Phase.ACCEPTED,
        (h) => h.call("expireUndelivered", undefined, 200, [max]),
      ],
      [
        Phase.SUBMITTED,
        (h) => h.call("escalateUnreviewed", undefined, 300, [max]),
      ],
      [Phase.DISPUTED, (h) => h.call("expireDispute", undefined, 400, [max])],
    ];
    for (const [phase, run] of attempts) {
      const h = at(phase);
      injectCell(
        h,
        3,
        StateValue.newCell({
          alignment: u64.alignment(),
          value: u64.toValue(max),
        }),
      );
      expect(h.public.revision).toBe(max);
      expect(h.public.phase).toBe(phase);
      const before = h.public;
      expect(() => run(h)).toThrow("revision exhausted");
      expect(h.public).toEqual(before);
    }
  });

  test("MID-T02 private currency follows artifact policy, not a committed caller selection", () => {
    for (const currency of [
      new TextEncoder().encode("EUR"),
      new Uint8Array(3),
    ]) {
      const opening = { ...terms, currency };
      const config = configFor(opening);
      for (const raw of [false, true]) {
        const h = raw ? new Harness() : new Harness(config);
        if (raw) injectConfiguration(h, config);
        expect(h.public.configuration).not.toHaveProperty("currency");
        const before = h.public;
        expect(() =>
          h.call("reserve", "buyer", 50, [0n], { terms: opening }),
        ).toThrow("unsupported currency");
        expect(h.public).toEqual(before);
      }
    }
    const h = new Harness();
    expect(h.public.configuration).not.toHaveProperty("currency");
    h.call("reserve", "buyer", 50, [0n]);
    expect(h.public.phase).toBe(Phase.RESERVED);
  });

  test("MID-T02 proved reserve rejects forged public configuration without constructor validation", () => {
    const config = configFor();
    const cases: [Partial<Configuration>, string][] = [
      [{ network: bytes(0) }, "empty network"],
      [{ orderNonce: bytes(0) }, "empty nonce"],
      [{ termsCommitment: bytes(0) }, "empty terms"],
      [{ buyerCommitment: bytes(0) }, "empty buyer"],
      [{ merchantCommitment: bytes(0) }, "empty merchant"],
      [{ operatorCommitment: bytes(0) }, "empty operator"],
      [
        { merchantCommitment: config.buyerCommitment },
        "distinct roles required",
      ],
      [
        { operatorCommitment: config.buyerCommitment },
        "distinct roles required",
      ],
      [
        { operatorCommitment: config.merchantCommitment },
        "distinct roles required",
      ],
      [{ acceptanceDeadline: 0n }, "unordered deadlines"],
      [{ deliveryDeadline: 100n }, "unordered deadlines"],
      [{ deliveryDeadline: 99n }, "unordered deadlines"],
      [{ reviewDeadline: 200n }, "unordered deadlines"],
      [{ reviewDeadline: 199n }, "unordered deadlines"],
      [{ resolutionDeadline: 300n }, "unordered deadlines"],
      [{ resolutionDeadline: 299n }, "unordered deadlines"],
    ];
    for (const [patch, message] of cases) {
      const h = new Harness();
      injectConfiguration(h, { ...config, ...patch });
      const before = h.public;
      expect(() => h.call("reserve", "buyer", 50, [0n])).toThrow(message);
      expect(h.public).toEqual(before);
    }
    const valid = new Harness();
    injectConfiguration(valid, config);
    valid.call("reserve", "buyer", 50, [0n]);
    expect(valid.public.phase).toBe(Phase.RESERVED);
  });

  test("MID-T02 proved reserve rejects forged bootstrap fields with matching revision", () => {
    const u16 = new CompactTypeUnsignedInteger(65535n, 2);
    const cases = [
      {
        index: 0,
        descriptor: u16,
        value: 0n,
        revision: 0n,
        message: "unsupported protocol",
      },
      {
        index: 0,
        descriptor: u16,
        value: 2n,
        revision: 0n,
        message: "unsupported protocol",
      },
      {
        index: 3,
        descriptor: u64,
        value: 1n,
        revision: 1n,
        message: "invalid bootstrap revision",
      },
    ];
    for (const { index, descriptor, value, revision, message } of cases) {
      const h = new Harness();
      injectCell(
        h,
        index,
        StateValue.newCell({
          alignment: descriptor.alignment(),
          value: descriptor.toValue(value),
        }),
      );
      expect(index === 0 ? h.public.protocolVersion : h.public.revision).toBe(
        value,
      );
      expect(() => h.call("reserve", "buyer", 50, [revision])).toThrow(message);
    }
    for (const [index, message] of [
      [4, "bootstrap delivery not empty"],
      [5, "bootstrap evidence not empty"],
    ] as const) {
      const h = new Harness();
      injectCell(
        h,
        index,
        StateValue.newCell({
          alignment: b32.alignment(),
          value: b32.toValue(bytes(99)),
        }),
      );
      expect(
        index === 4 ? h.public.deliveryCommitment : h.public.evidenceCommitment,
      ).toEqual(bytes(99));
      expect(() => h.call("reserve", "buyer", 50, [0n])).toThrow(message);
    }
  });

  test("MID-T01 midnight.order.bootstrap: fixed initial state and malformed configuration denial", () => {
    const h = new Harness();
    expect(h.public).toMatchObject({
      phase: Phase.DEPLOYED,
      revision: 0n,
      protocolVersion: 1n,
    });
    expect(h.public.deliveryCommitment).toEqual(bytes(0));
    expect(h.public.evidenceCommitment).toEqual(bytes(0));
    for (const key of [
      "network",
      "orderNonce",
      "termsCommitment",
      "buyerCommitment",
      "merchantCommitment",
      "operatorCommitment",
    ] as const) {
      expect(() => new Harness({ ...configFor(), [key]: bytes(0) })).toThrow();
    }
    expect(
      () => new Harness({ ...configFor(), acceptanceDeadline: 0n }),
    ).toThrow();
    expect(
      () => new Harness({ ...configFor(), deliveryDeadline: 100n }),
    ).toThrow();
    expect(
      () =>
        new Harness({
          ...configFor(),
          buyerCommitment: configFor().merchantCommitment,
        }),
    ).toThrow();
  });

  test("MID-T02 midnight.order.reserve: terms, role, network, nonce, amount and private limit", () => {
    const h = new Harness();
    for (const secret of [secrets.merchant, bytes(0)]) {
      expect(() => h.call("reserve", "buyer", 50, [0n], { secret })).toThrow(
        "buyer capability",
      );
    }
    expect(() =>
      h.call("reserve", "buyer", 50, [0n], {
        terms: { ...terms, scopeDigest: bytes(99) },
      }),
    ).toThrow("terms opening");
    expect(() =>
      h.call("reserve", "buyer", 50, [0n], { limit: 35_999n }),
    ).toThrow("limit exceeded");
    for (const opening of [
      { ...terms, serviceVersion: 2n },
      { ...terms, packQuantity: 2n },
      { ...terms, outputCount: 2n },
      { ...terms, unitPrice: 0n, total: 0n },
      { ...terms, total: 35_999n },
    ]) {
      const invalid = new Harness(configFor(opening));
      expect(() =>
        invalid.call("reserve", "buyer", 50, [0n], { terms: opening }),
      ).toThrow();
    }
    for (const config of [
      { ...configFor(), network: bytes(99) },
      { ...configFor(), orderNonce: bytes(99) },
    ]) {
      expect(() =>
        new Harness(config).call("reserve", "buyer", 50, [0n]),
      ).toThrow("buyer capability");
    }
    h.call("reserve", "buyer", 50, [0n]);
    expect(h.public.phase).toBe(Phase.RESERVED);
    const max = {
      ...terms,
      unitPrice: (1n << 64n) - 1n,
      total: (1n << 64n) - 1n,
    };
    new Harness(configFor(max)).call("reserve", "buyer", 50, [0n], {
      terms: max,
      limit: max.total,
    });
    expect(() =>
      pureCircuits.hashTerms(network, nonce, { ...terms, total: 1n << 64n }),
    ).toThrow();
  });

  test("MID-T03/04/05 midnight.order.accept/cancel/decline: independent roles and stale race", () => {
    const h = at(Phase.RESERVED);
    expect(() =>
      h.call("accept", "merchant", 60, [1n], { secret: secrets.buyer }),
    ).toThrow("merchant capability");
    expect(() =>
      h.call("accept", "merchant", 60, [1n], {
        terms: { ...terms, salt: bytes(99) },
      }),
    ).toThrow("terms opening");
    h.call("accept", "merchant", 60, [1n]);
    expect(() => h.call("cancelReserved", "buyer", 60, [1n])).toThrow(
      "stale revision",
    );
    for (const [action, actor] of [
      ["cancelReserved", "buyer"],
      ["decline", "merchant"],
    ] as const) {
      const cancelled = at(Phase.RESERVED);
      cancelled.call(action, actor, 60, [1n], {
        terms: undefined,
        limit: undefined,
      });
      expect(cancelled.public.phase).toBe(Phase.CANCELLED);
      expect(() => cancelled.call("accept", "merchant", 60, [2n])).toThrow(
        "requires reserved",
      );
    }
  });

  test("MID-T06/07 midnight.order.submit/approve: immutable delivery and same terms", () => {
    const h = at(Phase.ACCEPTED);
    expect(() => h.call("approve", "buyer", 150, [2n, delivery])).toThrow(
      "requires submitted",
    );
    expect(() =>
      h.call("submitDelivery", "merchant", 150, [2n, bytes(0)]),
    ).toThrow("empty delivery");
    h.call("submitDelivery", "merchant", 150, [2n, delivery], {
      terms: undefined,
    });
    expect(() =>
      h.call("submitDelivery", "merchant", 150, [3n, bytes(99)]),
    ).toThrow("requires accepted");
    expect(() => h.call("approve", "buyer", 250, [3n, bytes(99)])).toThrow(
      "delivery mismatch",
    );
    expect(() =>
      h.call("approve", "buyer", 250, [3n, delivery], {
        terms: { ...terms, total: 1n },
      }),
    ).toThrow("terms opening");
    h.call("approve", "buyer", 250, [3n, delivery], { limit: undefined });
    expect(h.public.phase).toBe(Phase.APPROVED);
    expect(h.public.configuration).toEqual(configFor());
    expect(() => h.call("approve", "buyer", 250, [4n, delivery])).toThrow(
      "requires submitted",
    );
  });

  test("MID-T08/09 midnight.order.dispute/resolve: permitted roles, full outcomes, delivery prerequisite", () => {
    for (const [action, actor] of [
      ["disputeBuyer", "buyer"],
      ["disputeMerchant", "merchant"],
    ] as const) {
      const h = at(Phase.ACCEPTED);
      h.call(action, actor, 150, [2n, evidence], { terms: undefined });
      expect(() =>
        h.call("resolve", "operator", 350, [3n, true, evidence]),
      ).toThrow("approval requires submitted");
      h.call("resolve", "operator", 350, [3n, false, evidence]);
      expect(h.public.phase).toBe(Phase.CANCELLED);
    }
    expect(() =>
      at(Phase.SUBMITTED).call("disputeMerchant", "merchant", 250, [
        3n,
        evidence,
      ]),
    ).toThrow("merchant dispute phase");
    for (const approve of [true, false]) {
      const h = at(Phase.DISPUTED);
      expect(() => h.call("approve", "buyer", 250, [4n, delivery])).toThrow(
        "requires submitted",
      );
      expect(() =>
        h.call("resolve", "operator", 350, [4n, approve, evidence], {
          secret: secrets.buyer,
        }),
      ).toThrow("operator capability");
      expect(() =>
        h.call("resolve", "operator", 350, [4n, approve, bytes(0)]),
      ).toThrow("empty resolution evidence");
      h.call("resolve", "operator", 350, [4n, approve, bytes(12)]);
      expect(h.public.phase).toBe(approve ? Phase.APPROVED : Phase.CANCELLED);
      expect(h.public.evidenceCommitment).toEqual(bytes(12));
    }
  });

  for (const [id, action, phase, deadline, next] of [
    [
      "MID-T10 midnight.order.expire-bootstrap",
      "expireBootstrap",
      Phase.DEPLOYED,
      100,
      Phase.CANCELLED,
    ],
    [
      "MID-T11 midnight.order.expire-reserved",
      "expireReserved",
      Phase.RESERVED,
      100,
      Phase.CANCELLED,
    ],
    [
      "MID-T12 midnight.order.expire-undelivered",
      "expireUndelivered",
      Phase.ACCEPTED,
      200,
      Phase.CANCELLED,
    ],
    [
      "MID-T13 midnight.order.escalate-unreviewed",
      "escalateUnreviewed",
      Phase.SUBMITTED,
      300,
      Phase.DISPUTED,
    ],
    [
      "MID-T14 midnight.order.expire-dispute",
      "expireDispute",
      Phase.DISPUTED,
      400,
      Phase.CANCELLED,
    ],
  ] as const) {
    test(`${id}: public-only before/at/after boundary and replay`, () => {
      const early = at(phase);
      expect(() =>
        early.call(action, undefined, deadline - 1, [early.public.revision]),
      ).toThrow("deadline not reached");
      for (const time of [deadline, deadline + 1]) {
        const h = at(phase);
        const revision = h.public.revision;
        h.call(action, undefined, time, [revision]);
        expect(h.public.phase).toBe(next);
        expect(h.public.revision).toBe(revision + 1n);
        expect(() => h.call(action, undefined, time, [revision])).toThrow(
          "stale revision",
        );
      }
    });
  }

  test("M-03 every role-gated action rejects a valid other-role secret without mutation", () => {
    const attempts = [
      {
        phase: Phase.DEPLOYED,
        run: (h: Harness) =>
          h.call("reserve", "buyer", 50, [h.public.revision], {
            secret: secrets.merchant,
          }),
      },
      {
        phase: Phase.RESERVED,
        run: (h: Harness) =>
          h.call("accept", "merchant", 60, [h.public.revision], {
            secret: secrets.buyer,
          }),
      },
      {
        phase: Phase.RESERVED,
        run: (h: Harness) =>
          h.call("cancelReserved", "buyer", 60, [h.public.revision], {
            secret: secrets.operator,
          }),
      },
      {
        phase: Phase.RESERVED,
        run: (h: Harness) =>
          h.call("decline", "merchant", 60, [h.public.revision], {
            secret: secrets.operator,
          }),
      },
      {
        phase: Phase.ACCEPTED,
        run: (h: Harness) =>
          h.call(
            "submitDelivery",
            "merchant",
            150,
            [h.public.revision, delivery],
            { secret: secrets.buyer },
          ),
      },
      {
        phase: Phase.SUBMITTED,
        run: (h: Harness) =>
          h.call("approve", "buyer", 250, [h.public.revision, delivery], {
            secret: secrets.merchant,
          }),
      },
      {
        phase: Phase.ACCEPTED,
        run: (h: Harness) =>
          h.call("disputeBuyer", "buyer", 150, [h.public.revision, evidence], {
            secret: secrets.merchant,
          }),
      },
      {
        phase: Phase.ACCEPTED,
        run: (h: Harness) =>
          h.call(
            "disputeMerchant",
            "merchant",
            150,
            [h.public.revision, evidence],
            { secret: secrets.buyer },
          ),
      },
      {
        phase: Phase.DISPUTED,
        run: (h: Harness) =>
          h.call(
            "resolve",
            "operator",
            350,
            [h.public.revision, false, evidence],
            { secret: secrets.merchant },
          ),
      },
    ];
    for (const { phase, run } of attempts) {
      const h = at(phase);
      const before = h.public;
      expect(() => run(h)).toThrow("capability required");
      expect(h.public).toEqual(before);
    }
  });

  test("M-03 every entry point rejects both terminal states with a fresh revision", () => {
    for (const approval of [true, false]) {
      const h = at(Phase.DISPUTED);
      h.call("resolve", "operator", 350, [4n, approval, evidence]);
      const before = h.public;
      const r = before.revision;
      const attempts = [
        () => h.call("reserve", "buyer", 50, [r]),
        () => h.call("accept", "merchant", 60, [r]),
        () => h.call("cancelReserved", "buyer", 60, [r]),
        () => h.call("decline", "merchant", 60, [r]),
        () => h.call("submitDelivery", "merchant", 150, [r, delivery]),
        () => h.call("approve", "buyer", 250, [r, delivery]),
        () => h.call("disputeBuyer", "buyer", 250, [r, evidence]),
        () => h.call("disputeMerchant", "merchant", 150, [r, evidence]),
        () => h.call("resolve", "operator", 350, [r, !approval, evidence]),
        () => h.call("expireBootstrap", undefined, 400, [r]),
        () => h.call("expireReserved", undefined, 400, [r]),
        () => h.call("expireUndelivered", undefined, 400, [r]),
        () => h.call("escalateUnreviewed", undefined, 400, [r]),
        () => h.call("expireDispute", undefined, 400, [r]),
      ];
      for (const run of attempts) {
        expect(run).toThrow();
        expect(h.public).toEqual(before);
      }
    }
  });

  test("normal actions reject at/after deadline and succeed one second before", () => {
    for (const time of [99, 100, 101]) {
      const run = () => new Harness().call("reserve", "buyer", time, [0n]);
      if (time === 99) run();
      else expect(run).toThrow("deadline reached");
      const accept = () =>
        at(Phase.RESERVED).call("accept", "merchant", time, [1n]);
      if (time === 99) accept();
      else expect(accept).toThrow("deadline reached");
    }
    for (const delta of [-1, 0, 1]) {
      const submit = () =>
        at(Phase.ACCEPTED).call("submitDelivery", "merchant", 200 + delta, [
          2n,
          delivery,
        ]);
      const approve = () =>
        at(Phase.SUBMITTED).call("approve", "buyer", 300 + delta, [
          3n,
          delivery,
        ]);
      const resolve = () =>
        at(Phase.DISPUTED).call("resolve", "operator", 400 + delta, [
          4n,
          true,
          evidence,
        ]);
      for (const run of [submit, approve, resolve]) {
        if (delta === -1) run();
        else expect(run).toThrow("deadline reached");
      }
    }
  });
});
