/**
 * RECONSTRUCTED — Phase 8 W1-A
 * Redacted diagnostics surface. F-21 class at historical diagnostics.ts:122:
 * by_intent lookups use .take(64), never .unique(), so capture+void on one
 * intent cannot crash the read.
 */

import type {
  DataModelFromSchemaDefinition,
  GenericQueryCtx,
} from "convex/server";
import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import type schema from "./schema";

type DiagContext = GenericQueryCtx<
  DataModelFromSchemaDefinition<typeof schema>
>;

export const DIAGNOSTICS_BY_INTENT_LIMIT = 64;

type DiagDb = {
  query: (table: string) => {
    withIndex: (
      name: string,
      range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      take: (n: number) => Promise<unknown[]>;
      unique?: () => Promise<unknown>;
    };
  };
};

export type ByIntentRow = {
  id: string;
  action: "capture" | "void";
  state: string;
  generation: number;
  attempt: number;
};

/**
 * F-21 class: bounded scan of settlementOps by intent.
 * Never `.unique()` — one intent may hold capture and void rows.
 */
export async function byIntentRows(
  db: DiagDb,
  paymentIntentId: string,
): Promise<ByIntentRow[]> {
  const rows = (await db
    .query("settlementOps")
    .withIndex("by_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
    .take(DIAGNOSTICS_BY_INTENT_LIMIT)) as {
    _id: string;
    action: "capture" | "void";
    state: string;
    generation: number;
    attempt: number;
  }[];
  return rows.map((row) => ({
    id: row._id,
    action: row.action,
    state: row.state,
    generation: row.generation,
    attempt: row.attempt,
  }));
}

/**
 * Safe diagnostics for an authenticated subject: correlation identifiers only.
 * No raw webhook bodies, secrets, call data, or capability material.
 */
export const read = queryGeneric({
  args: {
    paymentIntentId: v.optional(v.id("paymentIntents")),
    refreshToken: v.optional(v.string()),
  },
  returns: v.object({
    subjectBound: v.boolean(),
    ops: v.array(
      v.object({
        id: v.string(),
        action: v.union(v.literal("capture"), v.literal("void")),
        state: v.string(),
        generation: v.number(),
        attempt: v.number(),
      }),
    ),
    inboxRecent: v.array(
      v.object({
        eventId: v.string(),
        eventType: v.string(),
        processed: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx: DiagContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    // `paymentIntents.buyerAccountId` holds an ACCOUNT id, while the session
    // yields a SUBJECT. Comparing them directly is always false, so the scope is
    // resolved through the caller's own membership rows first.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) => q.eq("privySubject", subject))
      .take(32);
    const accountIds = new Set(
      memberships
        .filter((row) => row.status === "active")
        .map((row) => row.accountId),
    );
    // A payment intent is only readable by the buyer it was authorized for.
    let ops: ByIntentRow[] = [];
    if (args.paymentIntentId) {
      const payment = await ctx.db.get(args.paymentIntentId);
      if (payment && accountIds.has(payment.buyerAccountId))
        ops = await byIntentRows(
          ctx.db as never,
          args.paymentIntentId as unknown as string,
        );
    }
    // `paymentInbox.accountId` is the Stripe account, not the session subject, so
    // a subject lookup on that index always misses. The caller's own intents are
    // the correct scope for this view.
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
    };
  },
});
