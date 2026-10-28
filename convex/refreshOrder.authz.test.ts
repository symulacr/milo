/**
 * `refreshOrder` is a public action that spends an indexer read. These tests
 * pin the authorization it must apply: a caller with no session, or a session
 * with no membership in the order's scope, gets nothing and triggers no read;
 * an operator who may read a DISPUTED order may also refresh it.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { Row } from "./orderProjection.double";

// AUDIT15 A-01: no privy.io fallback, so declare the issuer under test.
process.env.CONVEX_SITE_URL ??= "privy.io";

const EMAIL = { value: undefined as string | undefined };

// Same operator seam as `orders.test.ts`: the allowlist decides, the mocked
// auth component answers who is signed in.
const allowlist = () =>
  (process.env.MILO_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
const allowed = (email: string | null | undefined) => {
  const configured = allowlist();
  return (
    configured.length > 0 && configured.includes((email ?? "").toLowerCase())
  );
};

mock.module("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async () => (EMAIL.value ? { email: EMAIL.value } : null),
  },
  operatorAllowed: allowed,
  isOperator: async () => allowed(EMAIL.value),
  OPERATOR_SCOPE: "milo-operators",
}));

const { orderScopeMember, refreshOrder } = await import("./chainObserver");
const { databaseDouble } = await import("./orderProjection.double");

function ctxDouble(
  identity: { issuer: string; subject: string } | null,
  tables: Record<string, Row[]> = {},
  /**
   * R29 AC-03: when supplied, `orderForQuote` answers with this `observedAt`
   * instead of `null`, which is what lets a test drive the cooldown. Left
   * undefined the routing is exactly as before, so the pre-existing assertions
   * about *which* callers reach `orderForQuote` are untouched.
   */
  cooldown?: { observedAt: number | null },
) {
  const queries: string[] = [];
  const { db } = databaseDouble(tables).ctx;
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    runQuery: async (ref: unknown, args: unknown) => {
      const name = (() => {
        try {
          return getFunctionName(ref as never);
        } catch {
          return "";
        }
      })();
      queries.push(name);
      // Route the two internal queries this action uses.
      if (name.includes("orderScopeMember"))
        return (
          orderScopeMember as unknown as {
            _handler: (c: never, a: never) => Promise<boolean>;
          }
        )._handler(ctx as never, args as never);
      if (name.includes("orderForQuote") && cooldown) return cooldown;
      return null;
    },
    // The shared double answers `withIndex(...).unique()`; the action only
    // reaches the database through the internal query above.
    db,
  };
  return { ctx: ctx as never, queries };
}

const DRAFT = { _id: "d1", id: "quote-1", scopeId: "scope-1" };
const DISPUTED = [{ _id: "c1", quoteId: "quote-1", phase: "DISPUTED" }];
const ACCEPTED = [{ _id: "c1", quoteId: "quote-1", phase: "ACCEPTED" }];

const handler = (
  refreshOrder as unknown as {
    _handler: (
      ctx: never,
      args: { quoteId: string },
    ) => Promise<{ phase: string | null; revision: number | null }>;
  }
)._handler;

const NULL = { phase: null, revision: null };
const STRANGER = { issuer: "privy.io", subject: "did:privy:stranger" };
const OPERATOR_EMAIL = "ops@studio.example";
const original = process.env.MILO_OPERATOR_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.MILO_OPERATOR_EMAILS;
  else process.env.MILO_OPERATOR_EMAILS = original;
  EMAIL.value = undefined;
});

describe("refreshOrder requires a participant, or an operator on a dispute", () => {
  test("an unauthenticated caller is refused before any indexer read", async () => {
    const f = ctxDouble(null, { quoteDrafts: [DRAFT] });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).rejects.toThrow(
      "Authenticated session required",
    );
    expect(f.queries).toEqual([]);
  });

  // Membership decides the read. Each row asserts both the result and whether
  // the order read happened, which is the property that matters (a refusal
  // must not spend an indexer read).
  test.each([
    ["a non-member reads nothing", [], false],
    [
      "a revoked membership reads nothing",
      [
        {
          _id: "m1",
          privySubject: STRANGER.subject,
          scopeId: "scope-1",
          status: "revoked",
        },
      ],
      false,
    ],
    [
      "an active member reaches the order read",
      [
        {
          _id: "m1",
          privySubject: STRANGER.subject,
          scopeId: "scope-1",
          status: "active",
        },
      ],
      true,
    ],
  ])("%s", async (_label, memberships, reads) => {
    const f = ctxDouble(STRANGER, { quoteDrafts: [DRAFT], memberships });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toEqual(NULL);
    expect(
      f.queries.filter((q) => q.includes("orderForQuote")).length > 0,
    ).toBe(reads);
  });

  test("a quote that does not exist grants nothing", async () => {
    const f = ctxDouble(STRANGER, { quoteDrafts: [], memberships: [] });
    await expect(handler(f.ctx, { quoteId: "quote-absent" })).resolves.toEqual(
      NULL,
    );
  });

  // The operator edge case: an allowlisted operator is not a member of the
  // studio's scope, but `orders:order` lets them read a DISPUTED order. They
  // must be able to refresh it too, and only while it is disputed.
  test.each([
    ["DISPUTED order is refreshed", DISPUTED, true],
    ["ACCEPTED order is not", ACCEPTED, false],
    ["missing chain row is not", [], false],
  ])("an operator: %s", async (_label, chain, allowed) => {
    process.env.MILO_OPERATOR_EMAILS = OPERATOR_EMAIL;
    EMAIL.value = OPERATOR_EMAIL;
    const f = ctxDouble(STRANGER, {
      quoteDrafts: [DRAFT],
      memberships: [],
      chainOrders: chain as Row[],
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toEqual(NULL);
    expect(f.queries.some((q) => q.includes("orderForQuote"))).toBe(allowed);
  });

  test("an operator not on the allowlist is refused even on a dispute", async () => {
    process.env.MILO_OPERATOR_EMAILS = OPERATOR_EMAIL;
    EMAIL.value = "someone@else.example";
    const f = ctxDouble(STRANGER, {
      quoteDrafts: [DRAFT],
      memberships: [],
      chainOrders: DISPUTED,
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toEqual(NULL);
    expect(f.queries.some((q) => q.includes("orderForQuote"))).toBe(false);
  });

  test("an empty allowlist decides nobody, even on a dispute", async () => {
    process.env.MILO_OPERATOR_EMAILS = "";
    EMAIL.value = OPERATOR_EMAIL;
    const f = ctxDouble(STRANGER, {
      quoteDrafts: [DRAFT],
      memberships: [],
      chainOrders: DISPUTED,
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toEqual(NULL);
    expect(f.queries.some((q) => q.includes("orderForQuote"))).toBe(false);
  });
});

/**
 * R29 AC-03: `refreshOrder` spends two Blockfrost reads per call against the
 * project id the 60 s `poll` cron also uses. Before this cap an authenticated
 * member could loop it and exhaust the daily allowance, which would stop chain
 * observation for **every** order — an availability bug reachable by anyone who
 * belongs to one studio.
 *
 * The cap reuses `chainOrders.observedAt`, which the observer already writes, so
 * there is no new table and no new index. The tests pin the boundary by value
 * and, just as importantly, that a fresh order is still refreshed.
 */
describe("R29 AC-03: refreshOrder caps the indexer spend per order", () => {
  const PARTICIPANT = { issuer: "privy.io", subject: "did:privy:buyer" };
  const MEMBERSHIP = [
    {
      _id: "m1",
      privySubject: PARTICIPANT.subject,
      scopeId: "scope-1",
      role: "buyer",
      status: "active",
      accountId: "buyer-1",
    },
  ];
  const CHAIN = [
    {
      _id: "c1",
      quoteId: "quote-1",
      phase: "ACCEPTED",
      address: "a".repeat(64),
      nonce: "b".repeat(64),
      artifactFingerprint: "c".repeat(64),
    },
  ];
  const fixture = (cooldown: { observedAt: number | null }) =>
    ctxDouble(
      PARTICIPANT,
      { quoteDrafts: [DRAFT], memberships: MEMBERSHIP, chainOrders: CHAIN },
      cooldown,
    );

  test("an order observed inside the window is not read again", async () => {
    const f = fixture({ observedAt: Date.now() - 1_000 });
    // Answers from the recorded state without spending an indexer read.
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toEqual(NULL);
  });

  test("the boundary: just inside is refused, just outside is allowed", async () => {
    // Inside: refused (resolves null, no indexer).
    const inside = fixture({ observedAt: Date.now() - 1_000 });
    await expect(handler(inside.ctx, { quoteId: "quote-1" })).resolves.toEqual(
      NULL,
    );
    // Outside: the read is attempted. The indexer env is unset in this suite,
    // so it fails closed — which is proof the cap did NOT short-circuit.
    const outside = fixture({ observedAt: Date.now() - 10 * 60_000 });
    await expect(
      handler(outside.ctx, { quoteId: "quote-1" }),
    ).rejects.toThrow();
  });

  test("a never-observed order is refreshed normally", async () => {
    // `observedAt: null` means "never observed". Treating it as "observed at
    // epoch" would block the very first refresh forever.
    const f = fixture({ observedAt: null });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).rejects.toThrow();
  });
});
