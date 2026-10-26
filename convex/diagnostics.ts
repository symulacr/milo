import {
  internalActionGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { type GenericId, v } from "convex/values";
import { mailConfig, sendEmail } from "../packages/backend/src/email";
import { env } from "../packages/backend/src/encoding";
import {
  operatorEmails,
  requireSessionSubject,
} from "../packages/backend/src/session-identity";
import type { ReadContext, ReadDb } from "./admissionContext";

const deadLetterCountsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    unprocessed: number;
    recent: number;
    byType: Array<{ eventType: string; count: number }>;
  }
>("diagnostics:deadLetterCounts");

export const DIAGNOSTICS_BY_INTENT_LIMIT = 64;

type ByIntentRow = {
  id: string;
  action: "capture" | "void";
  state: string;
  generation: number;
  attempt: number;
};

type RawOpRow = {
  _id: string;
  action: "capture" | "void";
  state: string;
  generation: number;
  attempt: number;
};

const projectOp = (row: RawOpRow): ByIntentRow => ({
  id: row._id,
  action: row.action,
  state: row.state,
  generation: row.generation,
  attempt: row.attempt,
});

export async function byIntentRows(
  db: ReadDb,
  paymentIntentId: string,
): Promise<ByIntentRow[]> {
  const rows = (await db
    .query("settlementOps")
    .withIndex("by_intent", (q) =>
      q.eq("paymentIntentId", paymentIntentId as GenericId<"paymentIntents">),
    )
    .take(DIAGNOSTICS_BY_INTENT_LIMIT)) as RawOpRow[];
  return rows.map(projectOp);
}

const opValidator = v.object({
  id: v.string(),
  action: v.union(v.literal("capture"), v.literal("void")),
  state: v.string(),
  generation: v.number(),
  attempt: v.number(),
});

export const read = internalQueryGeneric({
  args: {
    paymentIntentId: v.optional(v.id("paymentIntents")),
    refreshToken: v.optional(v.string()),
  },
  returns: v.object({
    subjectBound: v.boolean(),
    ops: v.array(opValidator),
    inboxRecent: v.array(
      v.object({
        eventId: v.string(),
        eventType: v.string(),
        processed: v.boolean(),
      }),
    ),
    /**
     * Which mail provider this deployment would use, and whether its key is
     * present. Names and a boolean only — `mailConfig()` never returns a value,
     * so this is safe to show an operator or write to a log.
     */
    mail: v.object({
      provider: v.string(),
      keyEnv: v.string(),
      keyPresent: v.boolean(),
      from: v.union(v.string(), v.null()),
    }),
  }),
  handler: async (ctx: ReadContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) => q.eq("privySubject", subject))
      .take(32);
    const accountIds = new Set(
      memberships
        .filter((row) => row.status === "active")
        .map((row) => row.accountId),
    );
    let ops: ByIntentRow[] = [];
    if (args.paymentIntentId) {
      const payment = await ctx.db.get(args.paymentIntentId);
      if (payment && accountIds.has(payment.buyerAccountId))
        ops = await byIntentRows(
          ctx.db as never,
          args.paymentIntentId as unknown as string,
        );
    }
    const inbox = [];
    for (const accountId of accountIds) {
      const ownIntents = await ctx.db
        .query("paymentIntents")
        .withIndex("by_buyer", (q) => q.eq("buyerAccountId", accountId))
        .take(8);
      for (const intent of ownIntents) {
        const rows = await ctx.db
          .query("paymentInbox")
          .withIndex("by_intent", (q) =>
            q.eq("paymentIntentRef", intent.stripePaymentIntentId),
          )
          .take(4);
        inbox.push(...rows);
      }
    }
    return {
      subjectBound: true,
      ops,
      inboxRecent: inbox.map((row) => ({
        eventId: row.eventId,
        eventType: row.eventType,
        processed: row.processedAt !== undefined,
      })),
      mail: mailConfig(),
    };
  },
});

/**
 * How far back the digest looks: a day plus an hour, so a cron that fires a few
 * minutes late still covers the full previous day without double-counting.
 */
export const DIGEST_WINDOW_MS = 25 * 60 * 60_000;

/** One digest run must not load an unbounded inbox. */
export const DEAD_LETTER_LIMIT = 500;

/**
 * The dead-letter count: events received but never reconciled. Stripe retries a
 * live delivery for up to 3 days but a sandbox delivery only 3 times, so a silent
 * gap is the normal failure mode. `by_received` bounds the scan to the window, so
 * a fixed backlog cannot mask a new one.
 */
export const deadLetterCounts = internalQueryGeneric({
  args: {},
  returns: v.object({
    unprocessed: v.number(),
    recent: v.number(),
    byType: v.array(v.object({ eventType: v.string(), count: v.number() })),
  }),
  handler: async (ctx: ReadContext) => {
    const rows = await ctx.db
      .query("paymentInbox")
      .withIndex("by_received", (q) =>
        q.gt("receivedAt", Date.now() - DIGEST_WINDOW_MS),
      )
      .take(DEAD_LETTER_LIMIT);
    const unprocessed = rows.filter((row) => row.processedAt === undefined);
    const counts = new Map<string, number>();
    for (const row of unprocessed)
      counts.set(row.eventType, (counts.get(row.eventType) ?? 0) + 1);
    return {
      unprocessed: unprocessed.length,
      recent: rows.length,
      byType: [...counts.entries()]
        .map(([eventType, count]) => ({ eventType, count }))
        .sort((a, b) => b.count - a.count),
    };
  },
});

/**
 * The daily operator digest. No-op when `MILO_OPERATOR_EMAILS` is unset (the
 * same rule `operatorEmails()` applies everywhere) and when nothing is
 * unprocessed: a daily "all clear" trains an operator to ignore the one that
 * matters.
 */
export const digest = internalActionGeneric({
  args: {},
  returns: v.object({ emailed: v.number(), unprocessed: v.number() }),
  handler: async (ctx) => {
    const recipients = operatorEmails();
    const counts = (await ctx.runQuery(deadLetterCountsRef, {})) as {
      unprocessed: number;
      recent: number;
      byType: Array<{ eventType: string; count: number }>;
    };
    if (recipients.length === 0 || counts.unprocessed === 0)
      return { emailed: 0, unprocessed: counts.unprocessed };
    const text = [
      `${counts.unprocessed} of ${counts.recent} events in the last day were never reconciled.`,
      ...counts.byType.map((row) => `  ${row.count} x ${row.eventType}`),
      "Check the Stripe webhook endpoint and the Convex logs.",
    ].join("\n");
    let emailed = 0;
    for (const to of recipients) {
      try {
        await sendEmail({
          to,
          url: env("SITE_URL") ?? "https://milo.app",
          subject: `${counts.unprocessed} unprocessed Stripe event(s)`,
          text,
        });
        emailed += 1;
      } catch {
        // One bad recipient must not stop the rest; the next run is the retry.
      }
    }
    return { emailed, unprocessed: counts.unprocessed };
  },
});
