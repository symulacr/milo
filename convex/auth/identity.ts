import type {
  DataModelFromSchemaDefinition,
  GenericQueryCtx,
} from "convex/server";
import { requirePrivySubject } from "../../packages/backend/src/privy-identity";
import type schema from "../schema";

type Context = GenericQueryCtx<DataModelFromSchemaDefinition<typeof schema>>;

export async function requireMembership(ctx: Context, scopeId: string) {
  const subject = requirePrivySubject(await ctx.auth.getUserIdentity());
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_subject_scope", (q) =>
      q.eq("privySubject", subject).eq("scopeId", scopeId),
    )
    .unique();
  if (!membership || membership.status !== "active") {
    throw new Error("Active membership required");
  }
  return membership;
}
