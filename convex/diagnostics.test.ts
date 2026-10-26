import { describe, expect, test } from "bun:test";
import {
  byIntentRows,
  DIAGNOSTICS_BY_INTENT_LIMIT,
  DIGEST_WINDOW_MS,
  deadLetterCounts,
  read,
} from "./diagnostics";
import { settlementDouble } from "./orderProjection.double";

// The diagnostics read is session-gated, and `requireSessionSubject` compares
// the identity's issuer against the deployment's own. Declare it here.
process.env.CONVEX_SITE_URL ??= "privy.io";

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

/**
 * ROUND 19 — the diagnostics read reports which mail provider is active.
 *
 * The selection logic itself is tested in `magic-link.test.ts`; what this pins
 * is that the read *exposes* it, and that it exposes names only. This query is
 * reachable from the app, so a key value here would be a disclosure.
 */
describe("ROUND19: diagnostics exposes the mail provider by name only", () => {
  const readMail = async () => {
    const handler = (
      read as unknown as {
        _handler: (
          ctx: never,
          args: Record<string, never>,
        ) => Promise<{ mail: Record<string, unknown> }>;
      }
    )._handler;
    const ctx = {
      auth: {
        getUserIdentity: async () => ({
          issuer: process.env.CONVEX_SITE_URL ?? "privy.io",
          subject: "did:privy:buyer",
        }),
      },
      db: { query: () => ({ withIndex: () => ({ take: async () => [] }) }) },
    } as never;
    return (await handler(ctx, {})).mail;
  };

  const withEnv = async (
    vars: Record<string, string | undefined>,
    run: () => Promise<void>,
  ) => {
    const previous = Object.fromEntries(
      Object.keys(vars).map((k) => [k, process.env[k]]),
    );
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await run();
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  test.each([
    ["resend", "RESEND_API_KEY"],
    ["agentmail", "AGENTMAIL_API_KEY"],
    ["brevo", "BREVO_API_KEY"],
  ])("%s reports its own key variable, never its value", async (p, keyEnv) => {
    await withEnv(
      { MAIL_PROVIDER: p, [keyEnv]: "secret-value-xyz" },
      async () => {
        const mail = await readMail();
        expect(mail).toMatchObject({ provider: p, keyEnv, keyPresent: true });
        expect(JSON.stringify(mail)).not.toContain("secret-value-xyz");
      },
    );
  });

  test("the default provider is resend with its key absent", async () => {
    await withEnv(
      { MAIL_PROVIDER: undefined, RESEND_API_KEY: undefined },
      async () => {
        expect(await readMail()).toMatchObject({
          provider: "resend",
          keyEnv: "RESEND_API_KEY",
          keyPresent: false,
        });
      },
    );
  });
});
