import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { PaymentAuthorization } from "./admission-policy";

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

export interface TestPaymentBinding {
  id: string;
  quoteId: string;
  quoteVersion: number;
  buyerAccountId: string;
  stripeAccountId: string;
  stripeCustomerId: string;
  stripePaymentIntentId: string;
  amountMinor: number;
  currency: string;
  environment: "test";
  network: "preprod";
}

export type PaymentObservation =
  | { kind: "observed"; authorization: PaymentAuthorization }
  | { kind: "blocked"; reason: string };

/** Trusted backend binding only. This adapter performs GET requests, never effects. */
export async function observeTestPayment(
  binding: TestPaymentBinding,
): Promise<PaymentObservation> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_[a-zA-Z0-9]+$/.test(key)) {
    throw new Error("A server-only Stripe test key is required");
  }
  if (!validBinding(binding)) return blocked("Invalid test payment binding");
  const stripe = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 1,
    timeout: 10_000,
  });
  try {
    const account = await stripe.accounts.retrieveCurrent();
    if (account.id !== binding.stripeAccountId) {
      return blocked("Stripe account mismatch");
    }
    const observedAt = Date.now();
    const intent = await stripe.paymentIntents.retrieve(
      binding.stripePaymentIntentId,
      { expand: ["latest_charge"] },
    );
    return normalizeTestPayment(intent, binding, observedAt);
  } catch {
    // Provider errors can include identifiers and request payloads.
    return blocked("Stripe observation unavailable; retry reconciliation");
  }
}

/** Normalize an independently retrieved SDK response; not a public request handler. */
export function normalizeTestPayment(
  intent: Stripe.PaymentIntent,
  binding: TestPaymentBinding,
  observedAt: number,
): PaymentObservation {
  if (
    !validBinding(binding) ||
    !Number.isSafeInteger(observedAt) ||
    !Number.isSafeInteger(observedAt + 60_000) ||
    observedAt < 0
  )
    return blocked("Invalid test payment binding or clock");
  if (
    intent.livemode !== false ||
    intent.id !== binding.stripePaymentIntentId ||
    intent.amount !== binding.amountMinor ||
    intent.currency !== binding.currency.toLowerCase() ||
    externalId(intent.customer) !== binding.stripeCustomerId ||
    intent.capture_method !== "manual"
  )
    return blocked("Stripe intent does not match immutable test binding");

  const charge =
    typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (intent.latest_charge && !charge)
    return blocked("Expanded charge required");
  if (
    charge &&
    (charge.livemode !== false ||
      externalId(charge.payment_intent) !== intent.id ||
      externalId(charge.customer) !== binding.stripeCustomerId ||
      charge.amount !== binding.amountMinor ||
      charge.currency !== intent.currency)
  )
    return blocked("Stripe charge does not match immutable test binding");

  const captureBefore = charge?.payment_method_details?.card?.capture_before;
  const captureBeforeMs =
    typeof captureBefore === "number" &&
    Number.isSafeInteger(captureBefore) &&
    captureBefore > 0 &&
    Number.isSafeInteger(captureBefore * 1000)
      ? captureBefore * 1000
      : 0;
  let status: PaymentAuthorization["status"];
  switch (intent.status) {
    case "requires_capture":
      if (
        charge?.status !== "succeeded" ||
        !charge.paid ||
        charge.captured ||
        charge.amount_captured !== 0 ||
        charge.refunded ||
        charge.amount_refunded !== 0 ||
        charge.disputed ||
        charge.payment_method_details?.type !== "card" ||
        intent.amount_capturable !== binding.amountMinor ||
        intent.amount_received !== 0 ||
        !captureBeforeMs
      )
        return blocked(
          "Full manual card authorization and provider capture expiry required",
        );
      status = captureBeforeMs > observedAt ? "authorized" : "failed";
      break;
    case "succeeded":
      if (
        !charge?.captured ||
        !charge.paid ||
        charge.status !== "succeeded" ||
        charge.amount_captured !== binding.amountMinor ||
        intent.amount_received !== binding.amountMinor ||
        charge.refunded ||
        charge.amount_refunded !== 0 ||
        charge.disputed
      )
        return blocked(
          "Captured payment needs independent refund/dispute reconciliation",
        );
      status = "captured";
      break;
    case "canceled":
      status = "voided";
      break;
    case "requires_payment_method":
      status = intent.last_payment_error ? "failed" : "pending";
      break;
    case "processing":
    case "requires_action":
    case "requires_confirmation":
      status = "pending";
      break;
    default:
      return blocked("Unsupported Stripe payment state");
  }
  const receipt = {
    account: binding.stripeAccountId,
    intent: intent.id,
    charge: charge?.id ?? null,
    providerStatus: intent.status,
    amountCapturable: intent.amount_capturable,
    amountReceived: intent.amount_received,
    captureBeforeMs,
    observedAt,
    status,
  };
  return {
    kind: "observed",
    authorization: {
      id: binding.id,
      quoteId: binding.quoteId,
      quoteVersion: binding.quoteVersion,
      buyerAccountId: binding.buyerAccountId,
      amountMinor: binding.amountMinor,
      currency: binding.currency,
      usableFrom: observedAt,
      usableUntil:
        status === "authorized"
          ? Math.min(captureBeforeMs, observedAt + 60_000)
          : observedAt,
      captureBeforeMs,
      source: "payment-observer",
      status,
      providerReceiptFingerprint: createHash("sha256")
        .update(JSON.stringify(receipt))
        .digest("hex"),
    },
  };
}

function validBinding(binding: TestPaymentBinding): boolean {
  return (
    binding.environment === "test" &&
    binding.network === "preprod" &&
    [binding.id, binding.quoteId, binding.buyerAccountId].every(
      (id) => typeof id === "string" && id.trim().length > 0,
    ) &&
    /^acct_[a-zA-Z0-9]+$/.test(binding.stripeAccountId) &&
    /^cus_[a-zA-Z0-9]+$/.test(binding.stripeCustomerId) &&
    /^pi_[a-zA-Z0-9]+$/.test(binding.stripePaymentIntentId) &&
    Number.isSafeInteger(binding.quoteVersion) &&
    binding.quoteVersion > 0 &&
    Number.isSafeInteger(binding.amountMinor) &&
    binding.amountMinor > 0 &&
    binding.currency === "USD"
  );
}

function externalId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function blocked(reason: string): PaymentObservation {
  return { kind: "blocked", reason };
}
