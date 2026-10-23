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
  db: DiagDb,
  paymentIntentId: string,
): Promise<ByIntentRow[]> {
  const rows = (await db
    .query("settlementOps")
    .withIndex("by_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
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

export const read = queryGeneric({
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
  }),
  handler: async (ctx: DiagContext, args) => {
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
    };
  },
});
