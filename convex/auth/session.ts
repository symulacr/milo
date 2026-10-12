import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireSessionSubject } from "../../packages/backend/src/session-identity";

export const current = queryGeneric({
  args: {},
  returns: v.object({ subject: v.string() }),
  handler: async (ctx) => ({
    subject: requireSessionSubject(await ctx.auth.getUserIdentity()),
  }),
});
