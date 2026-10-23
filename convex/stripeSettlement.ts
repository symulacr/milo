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
  idempotencyKey: string,
): Promise<{ status: number; body: string }> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, body: await res.text() };
}

type ProviderOutcome = "captured" | "voided" | "ambiguous" | "retry" | "failed";

function classify(
  action: "capture" | "void",
  status: number,
  body: string,
  amountMinor: number,
): { outcome: ProviderOutcome; receipt?: Record<string, unknown> } {
  if (status >= 200 && status < 300) {
    let providerStatus = action === "capture" ? "succeeded" : "canceled";
    let amountCaptured = amountMinor;
    try {
      const parsed = JSON.parse(body) as {
        status?: string;
        amount_received?: number;
      };
      if (parsed.status) providerStatus = parsed.status;
      if (typeof parsed.amount_received === "number")
        amountCaptured = parsed.amount_received;
    } catch {}
    return {
      outcome: action === "capture" ? "captured" : "voided",
      receipt: { providerStatus, amountCaptured, observedAt: Date.now() },
    };
  }
  if (status === 409 || status === 425) return { outcome: "ambiguous" };
  if (status >= 500 || status === 429) return { outcome: "retry" };
  return { outcome: "failed" };
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
    const path =
      started.action === "capture"
        ? `/payment_intents/${pi}/capture`
        : `/payment_intents/${pi}/cancel`;
    try {
      const result = await stripeForm(path, {}, started.idempotencyKey);
      const verdict = classify(
        started.action,
        result.status,
        result.body,
        started.amountMinor,
      );
      await finish(verdict.outcome, verdict.receipt);
      return null;
    } catch {
      await finish("retry");
      return null;
    }
  },
});
