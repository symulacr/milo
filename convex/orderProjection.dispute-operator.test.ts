/**
 * `orders.disputeOperatorId` is read by `files.*` and by `delivery-policy`'s
 * dispute branch, which requires `phase === "DISPUTED"` and an exact account
 * match. Nothing wrote it, so that branch was unreachable in a deployed
 * environment no matter what the operator membership said.
 *
 * These tests pin the write, and pin the absence of a write: an order must still
 * be created when the scope has no active operator.
 */
import { describe, expect, test } from "bun:test";
import type { AdmissionContext } from "./admissionContext";
import { createOrder } from "./orderProjection";

type Row = Record<string, unknown> & { _id: string };

function databaseDouble(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    chainOrders: [],
    orders: [],
    memberships: [],
    ...seed,
  };
  const ctx = {
    db: {
      query: (table: string) => {
        const rows = () => tables[table] ?? [];
        const filter = (predicate: (row: Row) => boolean) => ({
          unique: async () => {
            const matched = rows().filter(predicate);
            return matched.length === 1 ? matched[0] : null;
          },
          collect: async () => rows().filter(predicate),
        });
        return {
          withIndex: (
            _index: string,
            range: (q: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            const captured: Array<[string, unknown]> = [];
            const chain = {
              eq: (field: string, value: unknown) => {
                captured.push([field, value]);
                return chain;
              },
            };
            range(chain);
            return filter((row) =>
              captured.every(([field, value]) => row[field] === value),
            );
          },
        };
      },
      insert: async (table: string, doc: Record<string, unknown>) => {
        const _id = `${table}-${tables[table].length + 1}`;
        tables[table].push({ ...doc, _id });
        return _id;
      },
      patch: async (id: string, fields: Record<string, unknown>) => {
        for (const rows of Object.values(tables)) {
          const found = rows.find((row) => row._id === id);
          if (found) {
            Object.assign(found, fields);
            return;
          }
        }
        throw new Error(`unknown document ${id}`);
      },
    },
  };
  return { ctx: ctx as unknown as AdmissionContext, tables };
}

const input = {
  quoteId: "quote-1",
  scopeId: "scope-1",
  buyerId: "buyer-1",
  merchantId: "merchant-1",
  address: "a".repeat(64),
  nonce: "b".repeat(64),
  artifactFingerprint: "c".repeat(64),
};

function operator(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: "memberships-operator",
    privySubject: "did:privy:operator",
    accountId: "operator-1",
    scopeId: "scope-1",
    role: "operator",
    status: "active",
    ...overrides,
  };
}

describe("dispute operator resolution at order creation", () => {
  test("writes the scope's active operator account id", async () => {
    const f = databaseDouble({ memberships: [operator()] });
    await createOrder(f.ctx, input);
    expect(f.tables.orders).toHaveLength(1);
    expect(f.tables.orders[0].disputeOperatorId).toBe("operator-1");
  });

  test("omits the field when the scope has no operator membership", async () => {
    const f = databaseDouble();
    const result = await createOrder(f.ctx, input);
    expect(result).toEqual({ orderId: "quote-1", created: true });
    expect(f.tables.orders).toHaveLength(1);
    expect(f.tables.orders[0]).not.toHaveProperty("disputeOperatorId");
  });

  test("omits the field when the operator membership is revoked", async () => {
    const f = databaseDouble({
      memberships: [operator({ status: "revoked" })],
    });
    await createOrder(f.ctx, input);
    expect(f.tables.orders[0]).not.toHaveProperty("disputeOperatorId");
  });

  test("ignores an operator membership in another scope", async () => {
    const f = databaseDouble({
      memberships: [operator({ scopeId: "scope-other" })],
    });
    await createOrder(f.ctx, input);
    expect(f.tables.orders[0]).not.toHaveProperty("disputeOperatorId");
  });

  test("backfills the operator onto a chain row missing its projection", async () => {
    const f = databaseDouble({
      memberships: [operator()],
      chainOrders: [
        {
          _id: "chainOrders-1",
          orderId: "quote-1",
          quoteId: "quote-1",
          address: input.address,
          nonce: input.nonce,
          phase: "DISPUTED",
          revision: 3,
          terminal: false,
        },
      ],
    });
    const result = await createOrder(f.ctx, input);
    expect(result).toEqual({ orderId: "quote-1", created: true });
    expect(f.tables.orders[0]).toMatchObject({
      phase: "DISPUTED",
      revision: 3,
      disputeOperatorId: "operator-1",
    });
  });

  test("a missing operator never blocks order creation", async () => {
    const f = databaseDouble();
    await createOrder(f.ctx, input);
    expect(f.tables.chainOrders).toHaveLength(1);
    expect(f.tables.orders).toHaveLength(1);
  });
});
