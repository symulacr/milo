import { requireSessionSubject } from "../../packages/backend/src/session-identity";
import type { DataModel } from "../_generated/dataModel";
import { fail, type ReadContext } from "../admissionContext";
import { membershipFor } from "../paymentMonitor";

type Membership = Pick<
  DataModel["memberships"]["document"],
  "status" | "role" | "accountId"
>;

export async function requireMembership(ctx: ReadContext, scopeId: string) {
  const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
  const membership = await membershipFor(ctx, subject, scopeId);
  if (membership?.status !== "active")
    fail("FORBIDDEN", "Active membership required");
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
