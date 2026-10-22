/**
 * Order creation: the step that makes the chain projection and the delivery
 * projection exist at all.
 *
 * Before this existed, `orders` and `chainOrders` were read in five places and
 * written nowhere, so `orders.read` always returned null and every `files.*` call
 * threw before its policy ran. These tests pin the pairing and the backfill.
 */
import { describe, expect, test } from "bun:test";
import type { AdmissionContext } from "./admissionContext";
import { createOrder, deliveryPhaseFor } from "./orderProjection";

type Row = Record<string, unknown> & { _id: string };

function databaseDouble(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    chainOrders: [],
    orders: [],
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

describe("order creation", () => {
  test("creates the chain row and the delivery projection together", async () => {
    const f = databaseDouble();
    const result = await createOrder(f.ctx, input);
    expect(result).toEqual({ orderId: "quote-1", created: true });
    expect(f.tables.chainOrders).toHaveLength(1);
    expect(f.tables.orders).toHaveLength(1);
    expect(f.tables.chainOrders[0]).toMatchObject({
      orderId: "quote-1",
      phase: "DEPLOYED",
      revision: 0,
      terminal: false,
    });
    expect(f.tables.orders[0]).toMatchObject({
      id: "quote-1",
      buyerId: "buyer-1",
      merchantId: "merchant-1",
      phase: "TERMINAL",
      revision: 0,
    });
  });

  test("is idempotent for an identical quote", async () => {
    const f = databaseDouble();
    await createOrder(f.ctx, input);
    const again = await createOrder(f.ctx, input);
    expect(again).toEqual({ orderId: "quote-1", created: false });
    expect(f.tables.chainOrders).toHaveLength(1);
    expect(f.tables.orders).toHaveLength(1);
  });

  test("backfills a missing delivery projection instead of stranding it", async () => {
    const f = databaseDouble({
      chainOrders: [
        {
          _id: "chainOrders-1",
          orderId: "quote-1",
          quoteId: "quote-1",
          address: input.address,
          nonce: input.nonce,
          phase: "ACCEPTED",
          revision: 2,
          terminal: false,
        },
      ],
    });
    const result = await createOrder(f.ctx, input);
    expect(result).toEqual({ orderId: "quote-1", created: true });
    expect(f.tables.orders).toHaveLength(1);
    expect(f.tables.orders[0]).toMatchObject({
      id: "quote-1",
      phase: "ACCEPTED",
      revision: 2,
    });
  });

  test("refuses to rebind an existing order to a different address", async () => {
    const f = databaseDouble();
    await createOrder(f.ctx, input);
    await expect(
      createOrder(f.ctx, { ...input, address: "d".repeat(64) }),
    ).rejects.toThrow("cannot be adopted or rebound");
  });

  test("refuses an address already claimed by another order", async () => {
    const f = databaseDouble({
      chainOrders: [
        {
          _id: "chainOrders-1",
          orderId: "other",
          quoteId: "other",
          address: input.address,
          nonce: "e".repeat(64),
          phase: "DEPLOYED",
          revision: 0,
          terminal: false,
        },
      ],
    });
    await expect(createOrder(f.ctx, input)).rejects.toThrow("already claimed");
  });
});

describe("delivery phase projection", () => {
  test("maps chain phases onto the four delivery phases", () => {
    expect(deliveryPhaseFor("DEPLOYED")).toBe("TERMINAL");
    expect(deliveryPhaseFor("RESERVED")).toBe("TERMINAL");
    expect(deliveryPhaseFor("ACCEPTED")).toBe("ACCEPTED");
    expect(deliveryPhaseFor("SUBMITTED")).toBe("SUBMITTED");
    expect(deliveryPhaseFor("DISPUTED")).toBe("DISPUTED");
    expect(deliveryPhaseFor("APPROVED")).toBe("TERMINAL");
    expect(deliveryPhaseFor("CANCELLED")).toBe("TERMINAL");
  });
});
