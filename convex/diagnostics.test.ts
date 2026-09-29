import { describe, expect, test } from "bun:test";
import { byIntentRows, DIAGNOSTICS_BY_INTENT_LIMIT } from "./diagnostics";

/**
 * F-21 same class at diagnostics.ts: by_intent must use .take(64),
 * never .unique(), so one intent with capture+void does not crash reads.
 */
describe("diagnostics by_intent (F-21 class)", () => {
  type Row = {
    _id: string;
    paymentIntentId: string;
    action: "capture" | "void";
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
                "diagnostics.ts by_intent must not use .unique() (F-21 class)",
              );
            },
          };
        },
      }),
    };
  }

  const intent = "pi_1";
  const capture: Row = {
    _id: "op_cap",
    paymentIntentId: intent,
    action: "capture",
    state: "pending",
    generation: 1,
    attempt: 0,
  };
  const voidOp: Row = {
    _id: "op_void",
    paymentIntentId: intent,
    action: "void",
    state: "reconciliation",
    generation: 1,
    attempt: 2,
  };

  test("lists capture+void for one intent without throwing", async () => {
    const rows = await byIntentRows(db([capture, voidOp]) as never, intent);
    expect(rows).toHaveLength(2);
    expect(DIAGNOSTICS_BY_INTENT_LIMIT).toBe(64);
  });

  test("projects redacted fields only (no secrets / raw payloads)", async () => {
    const rows = await byIntentRows(db([capture]) as never, intent);
    expect(rows[0]).toEqual({
      id: "op_cap",
      action: "capture",
      state: "pending",
      generation: 1,
      attempt: 0,
    });
  });
});
