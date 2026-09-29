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
import { requirePrivySubject } from "../packages/backend/src/privy-identity";
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
    const subject = requirePrivySubject(await ctx.auth.getUserIdentity());
    const ops = args.paymentIntentId
      ? await byIntentRows(
          ctx.db as never,
          args.paymentIntentId as unknown as string,
        )
      : [];
    const inbox = await ctx.db
      .query("paymentInbox")
      .withIndex("by_account", (q) => q.eq("accountId", subject))
      .take(16);
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
