import {
  internalActionGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type Stripe from "stripe";
import { stripeMode } from "../packages/backend/src/stripe-mode";
import { stripeClient } from "../packages/backend/src/stripe-observer.server";

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

type ProviderOutcome = "captured" | "voided" | "ambiguous" | "retry" | "failed";

/**
 * Map a provider failure to the settlement outcome. The SDK raises
 * `StripeError` with the HTTP status, so the mapping is a table, not a parser.
 *
 * A connection failure or timeout carries no status: the request may have
 * reached Stripe and taken effect, so it is ambiguous, never a clean retry.
 * The shared idempotency key makes the follow-up safe either way.
 */
export function outcomeOf(error: unknown): ProviderOutcome {
  const status = (error as Stripe.errors.StripeError | undefined)?.statusCode;
  if (status === 409 || status === 425) return "ambiguous";
  if (status !== undefined && (status >= 500 || status === 429)) return "retry";
  if (status === undefined) return "ambiguous";
  return "failed";
}

const beginRef = makeFunctionReference<
  "mutation",
  { opId: string; generation: number; attempt: number },
  {
    action: "capture" | "void";
    idempotencyKey: string;
    payment: string;
    amountMinor: number;
    currency: string;
  } | null
>("settlement:begin");

const finishRef = makeFunctionReference<"mutation">("settlement:finish");

const providerRef = makeFunctionReference<
  "query",
  { payment: string },
  unknown
>("stripeSettlement:providerIntent");

export const run = internalActionGeneric({
  args: {
    opId: v.id("settlementOps"),
    generation: v.number(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Refuse a live key before touching the provider. `holdPayment` already
    // refuses to create a live intent, so this is the same guard at the only
    // other place that can move money. `stripeClient` validates the shape only.
    if (stripeMode(process.env.STRIPE_SECRET_KEY) === "live") {
      await ctx.runMutation(finishRef, { ...args, outcome: "failed" });
      return null;
    }
    const started = await ctx.runMutation(beginRef, args);
    if (!started) return null;
    const finish = (
      outcome: ProviderOutcome,
      receipt?: Record<string, unknown>,
    ) =>
      ctx.runMutation(finishRef, {
        ...args,
        outcome,
        ...(receipt ? { receipt } : {}),
      });
    const provider = await ctx.runQuery(providerRef, {
      payment: started.payment,
    });
    const pi =
      provider && typeof provider === "object"
        ? (provider as { stripePaymentIntentId?: string }).stripePaymentIntentId
        : undefined;
    if (!pi) {
      await finish("failed");
      return null;
    }
    const capture = started.action === "capture";
    try {
      const stripe = stripeClient();
      const intent = capture
        ? await stripe.paymentIntents.capture(
            pi,
            {},
            { idempotencyKey: started.idempotencyKey },
          )
        : await stripe.paymentIntents.cancel(
            pi,
            {},
            { idempotencyKey: started.idempotencyKey },
          );
      await finish(capture ? "captured" : "voided", {
        providerStatus: intent.status,
        amountCaptured: intent.amount_received,
        observedAt: Date.now(),
      });
      return null;
    } catch (error) {
      await finish(outcomeOf(error));
      return null;
    }
  },
});
