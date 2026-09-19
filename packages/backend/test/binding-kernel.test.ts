import { describe, expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import { invalidatePaymentObservation } from "../../../convex/paymentMonitor";
import { paymentBindsQuote } from "../src/admission-policy";

/**
 * Direct guards for the two consolidations wave 5 found under-guarded: the
 * payment-binding kernel's five clauses had exactly one incidental guarding
 * test, and the invalidation fence's generation clause had none. These are
 * pure functions; a table test is the cheapest way to make every clause bite.
 */
const quote = {
  id: "quote-1",
  version: 3,
  buyerAccountId: "buyer-1",
  amountMinor: 1200,
  currency: "USD",
};
const payment = {
  quoteId: "quote-1",
  quoteVersion: 3,
  buyerAccountId: "buyer-1",
  amountMinor: 1200,
  currency: "USD",
};

describe("paymentBindsQuote clauses", () => {
  test("a fully matching pair binds", () => {
    expect(paymentBindsQuote(payment, quote)).toBe(true);
  });
  for (const [clause, patch] of [
    ["quoteId", { quoteId: "quote-2" }],
    ["quoteVersion", { quoteVersion: 4 }],
    ["buyerAccountId", { buyerAccountId: "buyer-2" }],
    ["amountMinor", { amountMinor: 1300 }],
    ["currency", { currency: "EUR" }],
  ] as const) {
    test(`a ${clause} mismatch does not bind`, () => {
      expect(paymentBindsQuote({ ...payment, ...patch }, quote)).toBe(false);
      // The quote side names its fields differently for the two identity keys.
      const quoteSide =
        clause === "quoteId"
          ? { id: "quote-2" }
          : clause === "quoteVersion"
            ? { version: 4 }
            : patch;
      expect(paymentBindsQuote(payment, { ...quote, ...quoteSide })).toBe(
        false,
      );
    });
  }
});

function observationDb(row: Record<string, unknown> | null) {
  const deleted: string[] = [];
  return {
    deleted,
    ctx: {
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
            return {
              unique: async () => {
                if (table !== "paymentObservations") return null;
                if (conditions.some(([field, value]) => row?.[field] !== value))
                  return null;
                return row;
              },
            };
          },
        }),
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    } as unknown as Parameters<typeof invalidatePaymentObservation>[0],
  };
}

describe("invalidatePaymentObservation fence", () => {
  const row = {
    _id: "obs-1" as GenericId<"paymentObservations">,
    paymentIntentId: "pay-1",
    monitorId: "mon-1",
    monitorGeneration: 3,
  };

  test("unfenced invalidation removes the current observation", async () => {
    const db = observationDb({ ...row });
    await invalidatePaymentObservation(
      db.ctx,
      "pay-1" as GenericId<"paymentIntents">,
    );
    expect(db.deleted).toEqual(["obs-1"]);
  });

  test("a matching monitor fence removes it; a stale generation does not", async () => {
    const db = observationDb({ ...row });
    await invalidatePaymentObservation(
      db.ctx,
      "pay-1" as GenericId<"paymentIntents">,
      "mon-1" as GenericId<"paymentMonitors">,
      3,
    );
    expect(db.deleted).toEqual(["obs-1"]);
    const stale = observationDb({ ...row });
    await invalidatePaymentObservation(
      stale.ctx,
      "pay-1" as GenericId<"paymentIntents">,
      "mon-1" as GenericId<"paymentMonitors">,
      4,
    );
    expect(stale.deleted).toEqual([]);
  });

  test("a different monitor id or a missing row is a no-op", async () => {
    const other = observationDb({ ...row });
    await invalidatePaymentObservation(
      other.ctx,
      "pay-1" as GenericId<"paymentIntents">,
      "mon-2" as GenericId<"paymentMonitors">,
      3,
    );
    expect(other.deleted).toEqual([]);
    const empty = observationDb(null);
    await invalidatePaymentObservation(
      empty.ctx,
      "pay-1" as GenericId<"paymentIntents">,
    );
    expect(empty.deleted).toEqual([]);
  });
});
