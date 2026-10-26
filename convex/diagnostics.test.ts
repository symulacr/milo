import { describe, expect, test } from "bun:test";
import {
  byIntentRows,
  DIAGNOSTICS_BY_INTENT_LIMIT,
  DIGEST_WINDOW_MS,
  deadLetterCounts,
} from "./diagnostics";
import { settlementDouble } from "./orderProjection.double";

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

  const db = (rows: Row[]) =>
    settlementDouble({ settlementOps: rows as never }).ctx.db as never;

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

/**
 * ROUND 18 item 7 — the daily dead-letter digest.
 *
 * Stripe retries a live delivery for up to 3 days but a sandbox delivery only 3
 * times, so a silently dropped event is the normal failure mode. The digest is
 * the only thing that tells an operator about it. Two properties matter and both
 * are cheap to break: it must no-op when no operator is configured, and it must
 * stay silent when there is nothing wrong (a daily "all clear" trains an operator
 * to ignore the one that matters).
 */
describe("ROUND18 item 7: the operator digest", () => {
  const inbox = (rows: Array<Record<string, unknown>>) =>
    ({
      db: {
        query: () => ({
          withIndex: (_i: string, range: (q: never) => unknown) => {
            const q = { gt: () => q };
            (range as unknown as (x: unknown) => void)(q);
            return { take: async (n: number) => rows.slice(0, n) };
          },
        }),
      },
    }) as never;

  const counts = async (rows: Array<Record<string, unknown>>) => {
    const handler = (
      deadLetterCounts as unknown as {
        _handler: (
          ctx: never,
          args: Record<string, never>,
        ) => Promise<{
          unprocessed: number;
          recent: number;
          byType: Array<{ eventType: string; count: number }>;
        }>;
      }
    )._handler;
    return handler(inbox(rows), {});
  };

  test("counts only unprocessed rows, grouped by type", async () => {
    const now = Date.now();
    const out = await counts([
      { eventType: "payment_intent.succeeded", receivedAt: now },
      { eventType: "payment_intent.succeeded", receivedAt: now },
      { eventType: "charge.refunded", receivedAt: now },
      { eventType: "charge.expired", receivedAt: now, processedAt: now },
    ]);
    expect(out.unprocessed).toBe(3);
    expect(out.recent).toBe(4);
    expect(out.byType).toEqual([
      { eventType: "payment_intent.succeeded", count: 2 },
      { eventType: "charge.refunded", count: 1 },
    ]);
  });

  test("an empty inbox is zero, not an error", async () => {
    expect(await counts([])).toEqual({ unprocessed: 0, recent: 0, byType: [] });
  });

  test("the window is a day plus slack", () => {
    // 25 h: a cron that fires a few minutes late still covers the full previous
    // day and does not double-count the boundary.
    expect(DIGEST_WINDOW_MS).toBe(25 * 60 * 60_000);
  });

  test("the cron is registered daily, off the top of the hour", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./crons.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('crons.daily(\n  "operator digest"');
    // `minuteUTC` is omitted so Convex spreads the run; pinning :00 is the
    // documented busiest moment.
    expect(source).not.toMatch(/hourUTC: 7,\s*minuteUTC/);
  });
});
