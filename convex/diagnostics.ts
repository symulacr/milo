import {
  internalActionGeneric,
  internalMutationGeneric,
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
import type { AdmissionContext, ReadContext, ReadDb } from "./admissionContext";

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
 * R22 I-04: the retention the privacy page promises, enforced.
 *
 * `InfoPage.tsx` promises "Order brief and delivered files: 90 days after the
 * order ends" and "Order and payment records: 7 years, for tax". Nothing
 * enforced either. This is one daily mutation, the same bounded-batch shape as
 * the `paymentInbox` prune: it **redacts** the personal content of a terminal
 * order past the window and **keeps** the row and its money fields, so the
 * 7-year promise survives the 90-day one.
 */
export const RETENTION_DAYS = 90;
export const RETENTION_BATCH = 50;

export const pruneExpiredContent = internalMutationGeneric({
  args: {},
  returns: v.object({ quotes: v.number(), deliveries: v.number() }),
  handler: async (ctx: AdmissionContext) => {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60_000;
    // Terminal orders only, oldest first, bounded per run: the next run
    // continues where this one stopped.
    const expired = await ctx.db
      .query("chainOrders")
      .withIndex("by_terminal_observed", (q) => q.eq("terminal", true))
      .take(RETENTION_BATCH);
    let quotes = 0;
    let deliveries = 0;
    for (const chain of expired) {
      // `observedAt` is when the chain last moved; a row with none is not yet
      // provably ended, so it is left alone.
      if (typeof chain.observedAt !== "number" || chain.observedAt > cutoff)
        continue;
      const draft = await ctx.db
        .query("quoteDrafts")
        .withIndex("by_quote", (q) => q.eq("id", chain.quoteId))
        .unique();
      if (draft && draft.brief !== "") {
        // Redact the personal content, keep the money record.
        await ctx.db.patch(draft._id, {
          brief: "",
          title: "(retained for tax)",
          clientEmail: "",
          updatedAt: Date.now(),
        });
        quotes += 1;
      }
      const delivery = await ctx.db
        .query("deliveries")
        .withIndex("by_order", (q) => q.eq("orderId", chain.orderId))
        .first();
      if (delivery && delivery.files.length > 0) {
        await ctx.db.patch(delivery._id, { files: [] });
        deliveries += 1;
      }
    }
    return { quotes, deliveries };
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
  returns: v.object({
    emailed: v.number(),
    unprocessed: v.number(),
    /** R23 H-06: surfaced so a silent skip is visible in the cron log. */
    skipped: v.union(v.literal("no-operator"), v.literal("clean"), v.null()),
  }),
  handler: async (ctx) => {
    const recipients = operatorEmails();
    const counts = (await ctx.runQuery(deadLetterCountsRef, {})) as {
      unprocessed: number;
      recent: number;
      byType: Array<{ eventType: string; count: number }>;
    };
    // R23 H-06: a misconfigured deployment used to look identical to a healthy
    // one — the digest returned quietly and the queue grew unseen. Both skips are
    // now distinguishable in the return value, and the dangerous one is logged.
    if (recipients.length === 0) {
      console.warn(
        "digest-skipped",
        JSON.stringify({
          reason: "no-operator",
          unprocessed: counts.unprocessed,
        }),
      );
      return {
        emailed: 0,
        unprocessed: counts.unprocessed,
        skipped: "no-operator" as const,
      };
    }
    if (counts.unprocessed === 0)
      return { emailed: 0, unprocessed: 0, skipped: "clean" as const };
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
    return { emailed, unprocessed: counts.unprocessed, skipped: null };
  },
});

/**
 * R23 I-10: reap `paymentInbox` rows that were never processed.
 *
 * `settlement.ts` deletes a row once `processedAt` is set, so a row that never
 * processes is kept forever. The digest reports them; this is the reaping half,
 * over the existing `by_received` index, bounded per run like the grant sweep.
 * The window is long because an unprocessed row is evidence for a while, and the
 * digest has already reported it many times before it goes.
 */
export const INBOX_REAP_DAYS = 30;
export const INBOX_REAP_BATCH = 200;

export const reapPaymentInbox = internalMutationGeneric({
  args: {},
  returns: v.object({ removed: v.number() }),
  handler: async (ctx: AdmissionContext) => {
    const cutoff = Date.now() - INBOX_REAP_DAYS * 24 * 60 * 60_000;
    const stale = await ctx.db
      .query("paymentInbox")
      .withIndex("by_received", (q) => q.lt("receivedAt", cutoff))
      .take(INBOX_REAP_BATCH);
    let removed = 0;
    for (const row of stale) {
      // Only unprocessed rows: a processed row is already deleted by
      // `settlement.ts`, and a row that processed late must not be lost here.
      if (row.processedAt !== undefined) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return { removed };
  },
});
