"use node";

import { internalActionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { provisionTestCustomerFacts } from "../packages/backend/src/stripe-customer-provisioning.server";

export const provision = internalActionGeneric({
  args: {
    requestId: v.string(),
    operatorId: v.string(),
    sourceId: v.string(),
    buyerAccountId: v.string(),
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
  },
  returns: v.id("trustedProvisioning"),
  handler: async (ctx, args) =>
    provisionTestCustomerFacts(args, (verified) =>
      ctx.runMutation(
        makeFunctionReference<"mutation">("trustedProvisioning:provision"),
        verified,
      ),
    ),
});
