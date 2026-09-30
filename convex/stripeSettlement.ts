/**
 * RECONSTRUCTED — D1d stripeSettlement:run
 * Provider action: capture on APPROVED, void on CANCELLED.
 * Test-mode Stripe only. Locally-signed webhooks never reach here as "Stripe events".
 */
import {
  internalActionGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";

export const providerIntent = internalQueryGeneric({
  args: { payment: v.id("paymentIntents") },
  returns: v.union(
    v.object({
      stripePaymentIntentId: v.string(),
      amountMinor: v.number(),
      currency: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.payment);
    if (!row) return null;
    return {
      stripePaymentIntentId: row.stripePaymentIntentId,
      amountMinor: row.amountMinor,
      currency: row.currency,
    };
  },
});

function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function stripeForm(
  path: string,
  form: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  const body = new URLSearchParams(form).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

export const run = internalActionGeneric({
  args: {
    opId: v.id("settlementOps"),
    generation: v.number(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const beginRef = makeFunctionReference<
      "mutation",
      typeof args,
      | {
          action: "capture" | "void";
          idempotencyKey: string;
          payment: string;
          amountMinor: number;
          currency: string;
        }
      | null
    >("settlement:begin");
    const started = await ctx.runMutation(beginRef, args);
    if (!started) return null;
    const finishRef = makeFunctionReference<"mutation">("settlement:finish");
    const provider = await ctx.runQuery(
      makeFunctionReference<"query", { payment: string }, unknown>(
        "stripeSettlement:providerIntent",
      ),
      { payment: started.payment },
    );
    if (!provider || typeof provider !== "object") {
      await ctx.runMutation(finishRef, {
        ...args,
        outcome: "failed",
      });
      return null;
    }
    const pi = (provider as { stripePaymentIntentId?: string })
      .stripePaymentIntentId;
    if (!pi) {
      await ctx.runMutation(finishRef, { ...args, outcome: "failed" });
      return null;
    }
    try {
      const path =
        started.action === "capture"
          ? `/payment_intents/${pi}/capture`
          : `/payment_intents/${pi}/cancel`;
      const result = await stripeForm(path, {
        "idempotency_key": started.idempotencyKey,
      });
      if (result.status >= 200 && result.status < 300) {
        let providerStatus = started.action === "capture" ? "succeeded" : "canceled";
        let amountCaptured = started.amountMinor;
        try {
          const parsed = JSON.parse(result.body) as {
            status?: string;
            amount_received?: number;
          };
          if (parsed.status) providerStatus = parsed.status;
          if (typeof parsed.amount_received === "number")
            amountCaptured = parsed.amount_received;
        } catch {
          /* keep defaults */
        }
        await ctx.runMutation(finishRef, {
          ...args,
          outcome: started.action === "capture" ? "captured" : "voided",
          receipt: {
            providerStatus,
            amountCaptured,
            observedAt: Date.now(),
          },
        });
        return null;
      }
      if (result.status === 409 || result.status === 425) {
        await ctx.runMutation(finishRef, { ...args, outcome: "ambiguous" });
        return null;
      }
      await ctx.runMutation(finishRef, { ...args, outcome: "failed" });
      return null;
    } catch {
      await ctx.runMutation(finishRef, { ...args, outcome: "ambiguous" });
      return null;
    }
  },
});
