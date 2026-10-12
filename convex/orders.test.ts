/**
 * `orders.read` authorization: the chain-backed projection is a read-model for
 * the quote's buyer or merchant only. Identity is the shared Privy gate
 * (throws, as every sibling); a missing quote or a non-participant membership
 * is an ordinary absence (null), never a throw, so the union contract holds.
 */
import { describe, expect, test } from "bun:test";
import { read } from "./orders";

type Row = Record<string, unknown> & { _id: string };

const handler = (
  read as unknown as {
    _handler: (ctx: never, args: { quoteId: string }) => Promise<unknown>;
  }
)._handler;

function ctxDouble(identity: { issuer: string; subject: string } | null) {
  const tables: Record<string, Row[]> = {
    frozenQuotes: [],
    approvedQuotes: [],
    memberships: [],
    chainOrders: [],
    deliveries: [],
    fileGrants: [],
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
          return {
            unique: async () => {
              const rows = matched();
              if (rows.length > 1) throw new Error("Duplicate rows");
              return rows[0] ?? null;
            },
            collect: async () => matched(),
          };
        },
      }),
    },
  };
  return { ctx: ctx as never, tables };
}

const BUYER = { issuer: "privy.io", subject: "did:privy:buyer" };
const MERCHANT = { issuer: "privy.io", subject: "did:privy:merchant" };
const STRANGER = { issuer: "privy.io", subject: "did:privy:stranger" };

function seedQuote(f: ReturnType<typeof ctxDouble>) {
  f.tables.frozenQuotes.push({
    _id: "q1",
    id: "quote-1",
    scopeId: "scope-1",
    buyerAccountId: "buyer-1",
  });
  f.tables.chainOrders.push({
    _id: "co1",
    orderId: "order-1",
    quoteId: "quote-1",
    network: "preprod",
    address: "addr-1",
    nonce: "n1",
    artifactFingerprint: "af",
    phase: "ACCEPTED",
    revision: 3,
    deliveryManifest: null,
    terminal: false,
    merchantActive: true,
    observedAt: Date.now(),
  });
}

describe("orders.read authorization", () => {
  test("unauthenticated caller is refused by the shared identity gate", async () => {
    const f = ctxDouble(null);
    seedQuote(f);
    await expect(handler(f.ctx, { quoteId: "quote-1" })).rejects.toThrow(
      "Authenticated session required",
    );
  });

  test("authenticated non-member gets null, never the record", async () => {
    const f = ctxDouble(STRANGER);
    seedQuote(f);
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toBeNull();
  });

  test("membership in a different scope does not authorize", async () => {
    const f = ctxDouble(STRANGER);
    seedQuote(f);
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:stranger",
      scopeId: "other-scope",
      accountId: "buyer-1",
      role: "buyer",
      status: "active",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toBeNull();
  });

  test("revoked buyer membership gets null", async () => {
    const f = ctxDouble(BUYER);
    seedQuote(f);
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      scopeId: "scope-1",
      accountId: "buyer-1",
      role: "buyer",
      status: "revoked",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toBeNull();
  });

  test("active buyer membership reads the projection", async () => {
    const f = ctxDouble(BUYER);
    seedQuote(f);
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      scopeId: "scope-1",
      accountId: "buyer-1",
      role: "buyer",
      status: "active",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toMatchObject(
      {
        orderId: "order-1",
        address: "addr-1",
        phase: "ACCEPTED",
        revision: 3,
      },
    );
  });

  test("active merchant membership in the quote scope reads the projection", async () => {
    const f = ctxDouble(MERCHANT);
    seedQuote(f);
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:merchant",
      scopeId: "scope-1",
      accountId: "merchant-1",
      role: "merchant",
      status: "active",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toMatchObject(
      { orderId: "order-1", phase: "ACCEPTED" },
    );
  });

  test("merchant membership in the quote scope reads regardless of accountId", async () => {
    const f = ctxDouble(MERCHANT);
    seedQuote(f);
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:merchant",
      scopeId: "scope-1",
      accountId: "some-other-merchant",
      role: "merchant",
      status: "active",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toMatchObject(
      { orderId: "order-1", phase: "ACCEPTED" },
    );
  });

  test("an operator membership does not authorize the read", async () => {
    const f = ctxDouble(STRANGER);
    seedQuote(f);
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:stranger",
      scopeId: "scope-1",
      accountId: "operator-1",
      role: "operator",
      status: "active",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toBeNull();
  });

  test("missing quote is null even for an authenticated caller", async () => {
    const f = ctxDouble(BUYER);
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toBeNull();
  });

  test("authorized caller with no backing chainOrders row is null", async () => {
    const f = ctxDouble(BUYER);
    f.tables.frozenQuotes.push({
      _id: "q1",
      id: "quote-1",
      scopeId: "scope-1",
      buyerAccountId: "buyer-1",
    });
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      scopeId: "scope-1",
      accountId: "buyer-1",
      role: "buyer",
      status: "active",
    });
    await expect(handler(f.ctx, { quoteId: "quote-1" })).resolves.toBeNull();
  });
});
