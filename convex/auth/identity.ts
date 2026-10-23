import type {
  DataModelFromSchemaDefinition,
  GenericQueryCtx,
} from "convex/server";
import { requireSessionSubject } from "../../packages/backend/src/session-identity";
import type schema from "../schema";

type Context = GenericQueryCtx<DataModelFromSchemaDefinition<typeof schema>>;

type Membership = Pick<
  DataModelFromSchemaDefinition<typeof schema>["memberships"]["document"],
  "status" | "role" | "accountId"
>;

export async function requireMembership(ctx: Context, scopeId: string) {
  const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_subject_scope", (q) =>
      q.eq("privySubject", subject).eq("scopeId", scopeId),
    )
    .unique();
  if (membership?.status !== "active") {
    throw new Error("Active membership required");
  }
  return membership;
}

export function isQuoteBuyer(
  membership: Membership | null | undefined,
  buyerAccountId: string,
): boolean {
  return (
    membership?.status === "active" &&
    membership.role === "buyer" &&
    membership.accountId === buyerAccountId
  );
}
