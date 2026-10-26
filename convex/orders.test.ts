/**
 * `orders` truth: the stage and the payment label come from the provider, the
 * delivery manifest comes from the chain, the list sorts by real activity, and
 * an operator sees disputed orders. Identity is the shared Privy gate.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Row } from "./orderProjection.double";

// AUDIT15 A-01: no privy.io fallback, so declare the issuer under test.
process.env.CONVEX_SITE_URL ??= "privy.io";

const EMAIL = { value: undefined as string | undefined };

const allowed = (email: string | null | undefined) => {
  const configured = (process.env.MILO_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return (
    configured.length > 0 && configured.includes((email ?? "").toLowerCase())
  );
};

mock.module("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async () => (EMAIL.value ? { email: EMAIL.value } : null),
  },
  operatorAllowed: allowed,
  OPERATOR_SCOPE: "milo-operators",
}));

const { invite, list, order, paymentStateOf } = await import("./orders");
type OrderDetail = import("./orders").OrderDetail;
const { operatorAllowed } = await import("./auth");
const { settlementAuthorized } = await import("./settlement");

/** The subset of the Convex filter expression builder these queries use. */
const exprBuilder = () => ({
  field: (name: string) => ({ _field: name }),
  eq: (left: unknown, right: unknown) => ({
    _test: (row: Row) => {
      const leftValue =
        typeof left === "object" && left !== null && "_field" in left
          ? row[(left as { _field: string })._field]
          : left;
      return leftValue === right;
    },
  }),
});

function ctxDouble(identity: { issuer: string; subject: string } | null) {
  const tables: Record<string, Row[]> = {
    frozenQuotes: [],
    approvedQuotes: [],
    memberships: [],
    chainOrders: [],
    deliveries: [],
    fileGrants: [],
    quoteDrafts: [],
    paymentIntents: [],
    paymentObservations: [],
    settlementOps: [],
  };
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    db: {
      query: (table: string) => ({
        withIndex: (
          _name: string,
          range: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const conditions: [string, unknown][] = [];
          const q = {
            eq: (field: string, value: unknown) => {
              conditions.push([field, value]);
              return q;
            },
          };
          range(q);
          const matched = () =>
            (tables[table] ?? []).filter((row) =>
              conditions.every(([field, value]) => row[field] === value),
            );
          const filtered = (predicate?: unknown) =>
            matched().filter((row) => {
              const built =
                typeof predicate === "function"
                  ? (predicate as (q: unknown) => unknown)(exprBuilder())
                  : predicate;
              const test = (
                built as { _test?: (row: Row) => boolean } | undefined
              )?._test;
              return test ? test(row) : true;
            });
          const scope = {
            unique: async () => {
              const rows = matched();
              if (rows.length > 1) throw new Error("Duplicate rows");
              return rows[0] ?? null;
            },
            collect: async () => matched(),
            take: async (n: number) => matched().slice(0, n),
            first: async () => matched()[0] ?? null,
            filter: (predicate: unknown) => {
              const next = {
                filter: (second: unknown) => ({
                  first: async () => filtered(second)[0] ?? null,
                  take: async (n: number) => filtered(second).slice(0, n),
                }),
                first: async () => filtered(predicate)[0] ?? null,
                take: async (n: number) => filtered(predicate).slice(0, n),
              };
              return next;
            },
          };
          return scope;
        },
        // The unbounded read, matching `readSurface.fullTableScan`: real Convex
        // spells it `ctx.db.query(table)` with no index.
        fullTableScan: () => {
          const matched = () => tables[table] ?? [];
          return {
            collect: async () => matched(),
            take: async (n: number) => matched().slice(0, n),
            first: async () => matched()[0] ?? null,
            unique: async () => {
              const rows = matched();
              if (rows.length > 1) throw new Error("Duplicate rows");
              return rows[0] ?? null;
            },
          };
        },
      }),
      ...exprBuilder(),
    },
  };
  return { ctx: ctx as never, tables };
}

const BUYER = { issuer: "privy.io", subject: "did:privy:buyer" };
const MERCHANT = { issuer: "privy.io", subject: "did:privy:merchant" };
const STRANGER = { issuer: "privy.io", subject: "did:privy:stranger" };

type Summary = Pick<OrderDetail, "quoteId" | "stage" | "role"> & {
  lastActivityAt: number;
  updatedAt: number;
};

const detailHandler = (
  order as unknown as {
    _handler: (
      ctx: never,
      args: { quoteId: string },
    ) => Promise<OrderDetail | null>;
  }
)._handler;

const listHandler = (
  list as unknown as {
    _handler: (ctx: never, args: object) => Promise<Summary[]>;
  }
)._handler;

function seedDraft(f: ReturnType<typeof ctxDouble>, overrides = {}) {
  f.tables.quoteDrafts = [
    {
      _id: "d1",
      id: "quote-1",
      scopeId: "scope-1",
      studioName: "North Studio",
      merchantSubject: "did:privy:merchant",
      merchantAccountId: "merchant-1",
      title: "Three hero images",
      brief: "A short brief for the pack.",
      clientEmail: "client@example.com",
      amountUsd: 900,
      amountMinor: 90_000,
      currency: "USD",
      orderNonce: "a".repeat(64),
      merchantCommitment: "b".repeat(64),
      operatorCommitment: "c".repeat(64),
      termsCommitment: "d".repeat(64),
      terms: {
        unitPrice: "90000",
        total: "90000",
        scopeDigest: "e".repeat(64),
        rightsDigest: "f".repeat(64),
        paymentPolicy: "1".repeat(64),
        salt: "2".repeat(64),
      },
      // A realistic token: `randomHex()` is 64 lowercase hex characters, which
      // is what `timingSafeEqualHex` compares.
      inviteToken: "a1".repeat(32),
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    },
  ];
}

const membership = (
  subject: string,
  role: "buyer" | "merchant" | "operator",
) => ({
  _id: `m-${role}`,
  privySubject: subject,
  scopeId: "scope-1",
  accountId: `${role}-1`,
  role,
  status: "active",
});

const paymentOf = (f: ReturnType<typeof ctxDouble>, status: string) => {
  f.tables.paymentIntents.push({
    _id: "pi1",
    quoteId: "quote-1",
    stripePaymentIntentId: "pi_test_1",
  });
  f.tables.paymentObservations.push({
    _id: "po1",
    paymentIntentId: "pi1",
    authorization: { status, usableFrom: 500 },
  });
};

describe("orders.order", () => {
  test("non-member gets null", async () => {
    const f = ctxDouble(STRANGER);
    seedDraft(f);
    await expect(
      detailHandler(f.ctx, { quoteId: "quote-1" }),
    ).resolves.toBeNull();
  });

  test("merchant sees the client email and the invite link", async () => {
    const f = ctxDouble(MERCHANT);
    seedDraft(f);
    f.tables.memberships.push(membership("did:privy:merchant", "merchant"));
    const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
    expect(detail).toMatchObject({
      quoteId: "quote-1",
      role: "merchant",
      stage: "QUOTE",
      clientEmail: "client@example.com",
      inviteClaimed: false,
      deadlines: null,
      payment: { state: "none", mode: null },
      contract: null,
    });
    expect(detail?.inviteUrl).toContain("?invite=a1a1");
  });

  test("buyer never reads the client email or the invite link", async () => {
    const f = ctxDouble(BUYER);
    seedDraft(f, {
      buyerSubject: "did:privy:buyer",
      buyerAccountId: "did:privy:buyer",
    });
    f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
    const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
    expect(detail).toMatchObject({
      role: "buyer",
      clientEmail: null,
      inviteUrl: null,
      inviteClaimed: true,
    });
  });

  // AUDIT15 A-09: a stored `operator` membership row used to be a second source
  // of operator rights, but the `!disputed` refusal made that branch dead — it
  // granted nothing beyond being an ordinary member. The allowlist is the only
  // operator source now; this asserts both halves of that.
  test("operator rights come from the allowlist, not a stored row", async () => {
    const original = process.env.MILO_OPERATOR_EMAILS;
    process.env.MILO_OPERATOR_EMAILS = "ops@milo.example";
    EMAIL.value = "ops@milo.example";
    try {
      const f = ctxDouble(STRANGER);
      seedDraft(f);
      f.tables.chainOrders = [
        {
          _id: "co1",
          orderId: "order-1",
          quoteId: "quote-1",
          address: "addr-1",
          phase: "SUBMITTED",
          revision: 3,
        },
      ];
      // A stored operator row is just an active membership: no operator view of
      // an undisputed order.
      f.tables.memberships.push(membership("did:privy:stranger", "operator"));
      await expect(
        detailHandler(f.ctx, { quoteId: "quote-1" }),
      ).resolves.toMatchObject({ role: "buyer" });
      // Only a dispute plus the allowlist yields the operator view.
      f.tables.chainOrders[0].phase = "DISPUTED";
      await expect(
        detailHandler(f.ctx, { quoteId: "quote-1" }),
      ).resolves.toMatchObject({ role: "operator", stage: "DISPUTED" });
    } finally {
      if (original === undefined) delete process.env.MILO_OPERATOR_EMAILS;
      else process.env.MILO_OPERATOR_EMAILS = original;
      EMAIL.value = undefined;
    }
  });
});

describe("T1 the stage needs a real hold", () => {
  for (const status of ["pending", "failed", "voided"]) {
    test(`a ${status} authorization stays QUOTE`, async () => {
      const f = ctxDouble(BUYER);
      seedDraft(f, { buyerSubject: "did:privy:buyer" });
      f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
      f.tables.frozenQuotes.push({ _id: "fq", id: "quote-1", version: 1 });
      paymentOf(f, status);
      const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
      expect(detail?.stage).toBe("QUOTE");
      expect(detail?.payment.state).not.toBe("held");
    });
  }

  for (const status of ["authorized", "captured"]) {
    test(`a ${status} authorization is PAYMENT_HELD`, async () => {
      const f = ctxDouble(BUYER);
      seedDraft(f, { buyerSubject: "did:privy:buyer" });
      f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
      f.tables.frozenQuotes.push({ _id: "fq", id: "quote-1", version: 1 });
      paymentOf(f, status);
      const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
      expect(detail?.stage).toBe("PAYMENT_HELD");
      expect(detail?.payment.state).toBe(
        status === "captured" ? "captured" : "held",
      );
    });
  }

  test("a frozen quote with no payment is not PAYMENT_HELD", async () => {
    const f = ctxDouble(BUYER);
    seedDraft(f, { buyerSubject: "did:privy:buyer" });
    f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
    f.tables.frozenQuotes.push({ _id: "fq", id: "quote-1", version: 1 });
    const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
    expect(detail?.stage).toBe("QUOTE");
    expect(detail?.payment.state).toBe("none");
  });
});

describe("T11 the label survives settlement", () => {
  for (const [action, expected] of [
    ["capture", "captured"],
    ["void", "released"],
  ] as const) {
    test(`a complete ${action} op reads ${expected} without an observation`, async () => {
      const f = ctxDouble(BUYER);
      seedDraft(f, { buyerSubject: "did:privy:buyer" });
      f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
      f.tables.paymentIntents.push({ _id: "pi1", quoteId: "quote-1" });
      f.tables.settlementOps.push({
        _id: "op1",
        paymentIntentId: "pi1",
        action,
        state: "complete",
      });
      const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
      expect(detail?.payment.state).toBe(expected);
    });
  }
});

describe("T10 the manifest comes from the chain", () => {
  test("a Convex delivery manifest is not exposed as the chain manifest", async () => {
    const f = ctxDouble(BUYER);
    seedDraft(f, { buyerSubject: "did:privy:buyer" });
    f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
    f.tables.chainOrders.push({
      _id: "co1",
      orderId: "order-1",
      quoteId: "quote-1",
      address: "addr-1",
      phase: "SUBMITTED",
      revision: 3,
      deliveryManifest: null,
    });
    f.tables.deliveries.push({
      _id: "del1",
      orderId: "order-1",
      manifest: "f".repeat(64),
      files: [
        {
          grantId: "g1",
          storageId: "s1",
          sha256: "a".repeat(64),
          contentType: "image/png",
          byteLength: 3,
        },
      ],
    });
    const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
    expect(detail?.delivery.manifest).toBeNull();
    expect(detail?.delivery.files).toHaveLength(1);
  });

  test("the chain manifest is exposed once the chain shows it", async () => {
    const f = ctxDouble(BUYER);
    seedDraft(f, { buyerSubject: "did:privy:buyer" });
    f.tables.memberships.push(membership("did:privy:buyer", "buyer"));
    f.tables.chainOrders.push({
      _id: "co1",
      orderId: "order-1",
      quoteId: "quote-1",
      address: "addr-1",
      phase: "SUBMITTED",
      revision: 3,
      deliveryManifest: "c".repeat(64),
    });
    const detail = await detailHandler(f.ctx, { quoteId: "quote-1" });
    expect(detail?.delivery.manifest).toBe("c".repeat(64));
  });
});

describe("T3 the list sorts by real activity", () => {
  // ROUND17 (b): the list must be index-backed so it cannot silently drop a
  // chain or payment row. The previous shape scanned each table with a 512-row
  // cap, so an order whose chain row sat past the cap rendered as QUOTE — a live
  // order shown as an unaccepted one. This gate pins both halves of the fix:
  // every draft's chain row is reflected, and the read count stays bounded by
  // the draft bound rather than by a table-wide cap.
  test("every draft's chain row is reflected, and reads stay bounded", async () => {
    const reads: number[] = [];
    for (const n of [1, 32]) {
      const f = ctxDouble(MERCHANT);
      f.tables.memberships.push(membership("did:privy:merchant", "merchant"));
      f.tables.quoteDrafts = [];
      f.tables.chainOrders = [];
      for (let i = 0; i < n; i++) {
        f.tables.quoteDrafts.push({
          _id: `d${i}`,
          id: `quote-${i}`,
          scopeId: "scope-1",
          studioName: "North Studio",
          merchantSubject: "did:privy:merchant",
          merchantAccountId: "merchant-1",
          title: `Order ${i}`,
          brief: "A short brief for the fixed-price image pack.",
          clientEmail: "client@example.com",
          amountUsd: 900,
          amountMinor: 90_000,
          currency: "USD",
          orderNonce: "a".repeat(64),
          merchantCommitment: "b".repeat(64),
          termsCommitment: "d".repeat(64),
          terms: {
            unitPrice: "90000",
            total: "90000",
            scopeDigest: "e".repeat(64),
            rightsDigest: "f".repeat(64),
            paymentPolicy: "1".repeat(64),
            salt: "2".repeat(64),
          },
          inviteToken: "a1".repeat(32),
          createdAt: 1,
          updatedAt: 2 + i,
        });
        f.tables.chainOrders.push({
          _id: `co${i}`,
          orderId: `order-${i}`,
          quoteId: `quote-${i}`,
          phase: "ACCEPTED",
          revision: 1,
          terminal: false,
          observedAt: 900,
        });
      }
      let queries = 0;
      const inner = f.ctx as unknown as { db: { query: unknown } };
      const realQuery = inner.db.query as (t: string) => unknown;
      inner.db.query = (t: string) => {
        queries++;
        return realQuery(t);
      };
      const rows = await listHandler(f.ctx, {});
      expect(rows).toHaveLength(n);
      // Every row reflects its chain phase: nothing was dropped.
      expect(rows.every((r) => r.stage === "ACCEPTED")).toBe(true);
      reads.push(queries);
    }
    // Bounded by the draft bound (64 per source), not by a table-wide cap.
    expect(reads[1]).toBeLessThanOrEqual(4 * 32 + 8);
  });

  // ROUND17 (b), the truncation itself: a chain row that sits past a
  // table-wide cap must still reach its draft. The capped-scan shape rendered
  // this order as QUOTE; the index-backed shape reads it by key.
  test("a chain row past any table-wide cap still reaches its draft", async () => {
    const f = ctxDouble(MERCHANT);
    f.tables.memberships.push(membership("did:privy:merchant", "merchant"));
    seedDraft(f, { updatedAt: 2 });
    f.tables.chainOrders = [];
    // 600 unrelated rows first, so a 512-row scan would never reach the real one.
    for (let i = 0; i < 600; i++)
      f.tables.chainOrders.push({
        _id: `co${i}`,
        orderId: `order-${i}`,
        quoteId: `other-${i}`,
        phase: "ACCEPTED",
        revision: 1,
        terminal: false,
        observedAt: 10,
      });
    f.tables.chainOrders.push({
      _id: "co-real",
      orderId: "order-real",
      quoteId: "quote-1",
      phase: "ACCEPTED",
      revision: 5,
      terminal: false,
      observedAt: 900,
    });
    const rows = await listHandler(f.ctx, {});
    const row = rows.find((r) => r.quoteId === "quote-1");
    // Before the fix this was "QUOTE" with lastActivityAt 2: the chain row was
    // dropped by the cap and the order looked unaccepted.
    expect(row?.stage).toBe("ACCEPTED");
    expect(row?.lastActivityAt).toBe(900);
  });

  test("lastActivityAt follows the chain observation, not the draft", async () => {
    const f = ctxDouble(MERCHANT);
    seedDraft(f, { updatedAt: 100 });
    f.tables.memberships.push(membership("did:privy:merchant", "merchant"));
    f.tables.chainOrders.push({
      _id: "co1",
      orderId: "order-1",
      quoteId: "quote-1",
      phase: "ACCEPTED",
      observedAt: 900,
      terminal: false,
    });
    const rows = await listHandler(f.ctx, {});
    expect(rows[0]?.lastActivityAt).toBe(900);
    expect(rows[0]?.updatedAt).toBe(900);
  });

  test("a newer draft update wins over an older observation", async () => {
    const f = ctxDouble(MERCHANT);
    seedDraft(f, { updatedAt: 5_000 });
    f.tables.memberships.push(membership("did:privy:merchant", "merchant"));
    f.tables.chainOrders.push({
      _id: "co1",
      orderId: "order-1",
      quoteId: "quote-1",
      phase: "ACCEPTED",
      observedAt: 900,
      terminal: false,
    });
    const rows = await listHandler(f.ctx, {});
    expect(rows[0]?.lastActivityAt).toBe(5_000);
  });
});

describe("P2 an operator sees disputed orders", () => {
  const withAllowlist = (emails: string, email = "ops@milo.example") => {
    process.env.MILO_OPERATOR_EMAILS = emails;
    EMAIL.value = email;
  };
  const original = process.env.MILO_OPERATOR_EMAILS;
  afterEach(() => {
    if (original === undefined) delete process.env.MILO_OPERATOR_EMAILS;
    else process.env.MILO_OPERATOR_EMAILS = original;
    EMAIL.value = undefined;
  });

  test("the allowlist decides, and an empty list decides nobody", () => {
    withAllowlist("ops@milo.example");
    expect(operatorAllowed("ops@milo.example")).toBe(true);
    expect(operatorAllowed("OPS@Milo.Example")).toBe(true);
    expect(operatorAllowed("other@milo.example")).toBe(false);
    expect(operatorAllowed(null)).toBe(false);
    process.env.MILO_OPERATOR_EMAILS = "";
    expect(operatorAllowed("ops@milo.example")).toBe(false);
  });

  test("an operator resolves disputes across studios", async () => {
    withAllowlist("ops@milo.example");
    const f = ctxDouble(STRANGER);
    seedDraft(f, { scopeId: "scope-2" });
    f.tables.chainOrders.push({
      _id: "co1",
      orderId: "order-1",
      quoteId: "quote-1",
      phase: "DISPUTED",
      observedAt: 900,
      terminal: false,
    });
    const rows = await listHandler(f.ctx, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "operator", stage: "DISPUTED" });
  });

  test("an operator never sees an undisputed order from another scope", async () => {
    withAllowlist("ops@milo.example");
    const f = ctxDouble(STRANGER);
    seedDraft(f, { scopeId: "scope-2" });
    f.tables.chainOrders.push({
      _id: "co1",
      orderId: "order-1",
      quoteId: "quote-1",
      phase: "SUBMITTED",
      observedAt: 900,
      terminal: false,
    });
    expect(await listHandler(f.ctx, {})).toEqual([]);
  });

  test("an allowlisted email still needs a session", async () => {
    withAllowlist("ops@milo.example");
    const f = ctxDouble(null);
    seedDraft(f);
    await expect(listHandler(f.ctx, {})).rejects.toThrow(
      "Authenticated session required",
    );
  });
});

const inviteHandler = (
  invite as unknown as {
    _handler: (
      ctx: never,
      args: { quoteId: string; token: string },
    ) => Promise<{ claimed: boolean; orderNonce: string } | null>;
  }
)._handler;

describe("orders.invite", () => {
  test("a wrong token is null", async () => {
    const f = ctxDouble(STRANGER);
    seedDraft(f);
    await expect(
      inviteHandler(f.ctx, { quoteId: "quote-1", token: "wrong" }),
    ).resolves.toBeNull();
  });

  // AUDIT15 A-03: holding the link is not enough. This used to reveal the brief
  // to any signed-in stranger, and the token travels in a URL query string, so
  // it leaks through history and proxy logs. The invited email now decides.
  test("the right token does NOT reveal the brief to a signed-in non-member", async () => {
    const f = ctxDouble(STRANGER);
    seedDraft(f);
    await expect(
      inviteHandler(f.ctx, { quoteId: "quote-1", token: "a1".repeat(32) }),
    ).resolves.toBeNull();
  });

  test("the right token reveals the brief to the invited email's session", async () => {
    const f = ctxDouble(STRANGER);
    seedDraft(f);
    EMAIL.value = "client@example.com";
    try {
      await expect(
        inviteHandler(f.ctx, { quoteId: "quote-1", token: "a1".repeat(32) }),
      ).resolves.toMatchObject({ claimed: false, orderNonce: "a".repeat(64) });
    } finally {
      EMAIL.value = undefined;
    }
  });

  test("the right token reveals the brief to an active scope member", async () => {
    const f = ctxDouble(STRANGER);
    seedDraft(f);
    f.tables.memberships.push(membership("did:privy:stranger", "buyer"));
    await expect(
      inviteHandler(f.ctx, { quoteId: "quote-1", token: "a1".repeat(32) }),
    ).resolves.toMatchObject({ claimed: false });
  });
});

/**
 * C3 — payment label vs chain phase. Every phase is crossed with every payment
 * state the provider can report. A cancelled order must never show Captured,
 * nor an approved one Released, and no label appears without a payment row.
 */
describe("C3 payment label never contradicts the chain phase", () => {
  const PHASES = [
    "DEPLOYED",
    "RESERVED",
    "ACCEPTED",
    "SUBMITTED",
    "DISPUTED",
    "APPROVED",
    "CANCELLED",
  ] as const;
  const STATUSES = [
    null,
    "pending",
    "authorized",
    "captured",
    "voided",
    "failed",
  ] as const;
  const SETTLEMENTS = [
    null,
    { action: "capture" as const, state: "complete" },
    { action: "void" as const, state: "complete" },
  ];
  const auth = (status: (typeof STATUSES)[number]) =>
    status === null ? null : ({ authorization: { status } } as never);
  // The two contradictions that must never appear: a cancelled order showing
  // Captured, and an approved order showing Released. Every other pairing is
  // honest reporting — a DEPLOYED order whose provider already captured is
  // telling the truth about the money, not contradicting the chain.
  const contradicts = (phase: string, state: string) =>
    (phase === "CANCELLED" && state === "captured") ||
    (phase === "APPROVED" && state === "released");
  const state = (
    status: (typeof STATUSES)[number],
    settlement: (typeof SETTLEMENTS)[number],
    phase?: string,
  ) => paymentStateOf({ _id: "pi-1" }, auth(status), settlement, phase);

  test("no phase x provider-status x completed-settlement combination contradicts", () => {
    // Guard the guard: if `contradicts` were loosened, the sweep would pass
    // vacuously. These five pin what it must and must not flag.
    for (const [phase, label, expected] of [
      ["CANCELLED", "captured", true],
      ["APPROVED", "released", true],
      ["APPROVED", "captured", false],
      ["CANCELLED", "released", false],
      ["DEPLOYED", "captured", false],
    ] as const)
      expect(contradicts(phase, label)).toBe(expected);
    const violations: string[] = [];
    for (const phase of PHASES)
      for (const status of STATUSES)
        for (const settlement of SETTLEMENTS) {
          const label = state(status, settlement, phase);
          if (contradicts(phase, label))
            violations.push(`${phase}/${status}: ${label}`);
        }
    expect(violations).toEqual([]);
    // No label is invented without a payment row.
    for (const status of STATUSES)
      for (const settlement of SETTLEMENTS)
        expect(paymentStateOf(null, auth(status), settlement)).toBe("none");
  });

  test("the unreachable pairs are refused at write time, not labelled", () => {
    for (const phase of PHASES)
      for (const action of ["capture", "void"] as const)
        expect(settlementAuthorized(action, phase)).toBe(
          (action === "capture" && phase === "APPROVED") ||
            (action === "void" && phase === "CANCELLED"),
        );
  });

  // The stage half of C3 — that a chain row wins and that only a real hold
  // lifts QUOTE off — is asserted end-to-end through the real handler by
  // `T1 the stage needs a real hold` above. These keep the pure helper honest
  // where T1 cannot reach.
  test("a completed settlement outranks the observation it replaced", () => {
    // openSettlement deletes the observation, so the receipt is the only record.
    expect(state(null, SETTLEMENTS[1], "APPROVED")).toBe("captured");
    expect(state(null, SETTLEMENTS[2], "CANCELLED")).toBe("released");
    // A pending settlement is not an outcome; the provider still decides.
    expect(
      state("authorized", { action: "capture", state: "pending" }, "APPROVED"),
    ).toBe("held");
  });

  test("a stale provider status yields to the chain phase", () => {
    // The observation still says captured, but the order was cancelled: the
    // label must not claim money that the chain says was never taken.
    expect(state("captured", null, "CANCELLED")).toBe("pending");
    // ...and symmetrically for an approved order whose observation says voided.
    expect(state("voided", null, "APPROVED")).toBe("pending");
    // A completed settlement receipt cannot contradict the phase either.
    expect(state(null, SETTLEMENTS[1], "CANCELLED")).toBe("pending");
  });
});
