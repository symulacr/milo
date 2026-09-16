import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requirePrivySubject } from "../../packages/backend/src/privy-identity";

export const current = queryGeneric({
  args: {},
  returns: v.object({ subject: v.string() }),
  handler: async (ctx) => ({
    subject: requirePrivySubject(await ctx.auth.getUserIdentity()),
  }),
});
