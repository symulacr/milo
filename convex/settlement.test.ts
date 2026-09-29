import { describe, expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import {
  inboxDedupeKey,
  MAX_SWEEP,
  opsForIntent,
  settlementAuthorized,
  settlementIdempotencyKey,
} from "./settlement";

/**
 * Pure-policy coverage for the F-21 class: by_intent lookups must tolerate
 * capture+void on one intent (.take(64), never .unique()).
 */
describe("settlementAuthorized phase gates", () => {
  test("capture only from APPROVED", () => {
    expect(settlementAuthorized("capture", "APPROVED")).toBe(true);
    for (const phase of [
      "CANCELLED",
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
    ]) {
      expect(settlementAuthorized("capture", phase)).toBe(false);
    }
  });
  test("void only from CANCELLED", () => {
    expect(settlementAuthorized("void", "CANCELLED")).toBe(true);
    for (const phase of [
      "APPROVED",
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
    ]) {
      expect(settlementAuthorized("void", phase)).toBe(false);
    }
  });
});

describe("settlementIdempotencyKey", () => {
  test("is stable across attempts and unique per (order, action, revision)", () => {
    const a = settlementIdempotencyKey("order-1", "capture", 1);
    const b = settlementIdempotencyKey("order-1", "capture", 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^milo-capture:order-1:1$/);
    expect(settlementIdempotencyKey("order-1", "void", 1)).not.toBe(a);
    expect(settlementIdempotencyKey("order-1", "capture", 2)).not.toBe(a);
    expect(settlementIdempotencyKey("order-2", "capture", 1)).not.toBe(a);
  });
});

describe("opsForIntent — F-21 by_intent .take(64), never .unique()", () => {
  type Row = {
    _id: GenericId<"settlementOps">;
    paymentIntentId: GenericId<"paymentIntents">;
    action: "capture" | "void";
    orderId: string;
    contractRevision: number;
    state: string;
    generation: number;
    attempt: number;
  };

  function db(rows: Row[]) {
    return {
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
            take: async (n: number) => {
              if (table !== "settlementOps") return [];
              return rows
                .filter((row) =>
                  conditions.every(
                    ([field, value]) =>
                      (row as unknown as Record<string, unknown>)[field] ===
                      value,
                  ),
                )
                .slice(0, n);
            },
            unique: async () => {
              throw new Error(
                "F-21: by_intent must not use .unique() when capture+void share one intent",
              );
            },
          };
        },
      }),
    };
  }

  const intent = "pi_1" as GenericId<"paymentIntents">;
  const capture: Row = {
    _id: "op_cap" as GenericId<"settlementOps">,
    paymentIntentId: intent,
    action: "capture",
    orderId: "order-1",
    contractRevision: 1,
    state: "pending",
    generation: 1,
    attempt: 0,
  };
  const voidOp: Row = {
    _id: "op_void" as GenericId<"settlementOps">,
    paymentIntentId: intent,
    action: "void",
    orderId: "order-1",
    contractRevision: 1,
    state: "pending",
    generation: 1,
    attempt: 0,
  };

  test("returns capture and void for one intent without throwing", async () => {
    const rows = await opsForIntent(db([capture, voidOp]) as never, intent);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.action).sort()).toEqual(["capture", "void"]);
  });

  test("is empty when the intent has no ops", async () => {
    const rows = await opsForIntent(db([]) as never, intent);
    expect(rows).toEqual([]);
  });

  test("bounds the scan at 64 rows (take(64), not unlimited)", async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      ...capture,
      _id: `op_${i}` as GenericId<"settlementOps">,
    }));
    const rows = await opsForIntent(db(many) as never, intent);
    expect(rows).toHaveLength(64);
    expect(MAX_SWEEP).toBe(16);
  });
});

describe("inbox dedup identity (provider, accountId, eventId)", () => {
  test("first delivery is a new row; duplicate eventId is the same key", () => {
    const first = inboxDedupeKey("stripe", "acct_1", "evt_1");
    const dup = inboxDedupeKey("stripe", "acct_1", "evt_1");
    expect(first).toBe(dup);
  });
  test("same event id under another account is a distinct row", () => {
    expect(inboxDedupeKey("stripe", "acct_1", "evt_1")).not.toBe(
      inboxDedupeKey("stripe", "acct_2", "evt_1"),
    );
  });
  test("provider participates in the identity", () => {
    expect(inboxDedupeKey("stripe", "acct_1", "evt_1")).not.toBe(
      inboxDedupeKey("other", "acct_1", "evt_1"),
    );
  });
});
