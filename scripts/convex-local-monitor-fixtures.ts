// Internal helpers copied into .tools only; never deploy with application functions.
import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import { MONITOR_DURATION_MS } from "../packages/backend/src/payment-monitor";

export const prepare = internalMutationGeneric({
  args: { quoteId: v.string() },
  handler: async (ctx, { quoteId }) => {
    const quote = await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", quoteId))
      .unique();
    if (!quote) throw new Error("Synthetic admission fixture required");
    const payment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .unique();
    if (!payment) throw new Error("Synthetic payment required");
    await ctx.db.insert("stripeCustomers", {
      buyerAccountId: quote.buyerAccountId,
      stripeAccountId: payment.stripeAccountId,
      stripeCustomerId: payment.stripeCustomerId,
    });
    for (const row of await ctx.db
      .query("paymentObservations")
      .withIndex("by_payment_intent", (q) =>
        q.eq("paymentIntentId", payment._id),
      )
      .collect())
      await ctx.db.delete(row._id);
    return payment._id;
  },
});

export const revoke = internalMutationGeneric({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    await ctx.db.patch(membershipId, { status: "revoked" });
  },
});

// Move only fixture consent into the past, preserving the production duration invariant.
export const nearExpiry = internalMutationGeneric({
  args: { monitorId: v.id("paymentMonitors"), remainingMs: v.number() },
  handler: async (ctx, { monitorId, remainingMs }) => {
    if (remainingMs < 0 || remainingMs > 10_000)
      throw new Error("Bounded fixture expiry required");
    const expiresAt = Date.now() + remainingMs;
    await ctx.db.patch(monitorId, {
      consentAt: expiresAt - MONITOR_DURATION_MS,
      expiresAt,
    });
  },
});

export const snapshot = internalQueryGeneric({
  args: { quoteId: v.string() },
  handler: async (ctx, { quoteId }) => {
    const monitors = await ctx.db
      .query("paymentMonitors")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .collect();
    const payments = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .collect();
    const observations = (
      await Promise.all(
        payments.map((p) =>
          ctx.db
            .query("paymentObservations")
            .withIndex("by_payment_intent", (q) =>
              q.eq("paymentIntentId", p._id),
            )
            .collect(),
        ),
      )
    ).flat();
    const jobs = await ctx.db
      .query("paymentJobs")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .collect();
    const scheduled = (
      await ctx.db.system.query("_scheduled_functions").collect()
    ).filter((s) =>
      JSON.stringify(s.args).includes(monitors[0]?._id ?? "no-monitor"),
    );
    return { monitors, payments, observations, jobs, scheduled };
  },
});
