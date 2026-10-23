import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { PaymentAuthorization } from "./admission-policy";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "./admission-policy";

export const STRIPE_API_VERSION = "2026-09-30.endive" as const;
export const STRIPE_ACCOUNT_ID = /^acct_[a-zA-Z0-9]+$/;
export const STRIPE_CUSTOMER_ID = /^cus_[a-zA-Z0-9]+$/;

const TEST_KEY = /^(sk|rk)_test_[a-zA-Z0-9]+$/;
const INTENT_ID = /^pi_[a-zA-Z0-9]+$/;
const TEXT_IDS = ["id", "quoteId", "buyerAccountId"] as const;
const SIMPLE_STATUS: Record<string, PaymentAuthorization["status"]> = {
  canceled: "voided",
  processing: "pending",
  requires_action: "pending",
  requires_confirmation: "pending",
};

export interface TestPaymentBinding {
  id: string;
  quoteId: string;
  quoteVersion: number;
  buyerAccountId: string;
  amountMinor: number;
  currency: string;
  stripeAccountId: string;
  stripeCustomerId: string;
  stripePaymentIntentId: string;
  environment: "test";
  network: "preprod";
}

export type PaymentObservation =
  | { kind: "observed"; authorization: PaymentAuthorization }
  | { kind: "blocked"; reason: string };

export const isPositiveInt = (v: number): boolean =>
  Number.isSafeInteger(v) && v > 0;
export const isTestStripeId = (account: string, customer: string): boolean =>
  STRIPE_ACCOUNT_ID.test(account) && STRIPE_CUSTOMER_ID.test(customer);

const blocked = (reason: string): PaymentObservation => ({
  kind: "blocked",
  reason,
});
const externalId = (v: string | { id: string } | null): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

export function testStripeClient(
  message = "Server-only Stripe test key required",
): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !TEST_KEY.test(key)) throw new Error(message);
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 1,
    timeout: 10_000,
  });
}

export async function observeTestPayment(
  binding: TestPaymentBinding,
): Promise<PaymentObservation> {
  const stripe = testStripeClient("A server-only Stripe test key is required");
  if (!validBinding(binding)) return blocked("Invalid test payment binding");
  try {
    if (
      (await stripe.accounts.retrieveCurrent()).id !== binding.stripeAccountId
    )
      return blocked("Stripe account mismatch");
    const observedAt = Date.now();
    const intent = await stripe.paymentIntents.retrieve(
      binding.stripePaymentIntentId,
      { expand: ["latest_charge"] },
    );
    return normalizeTestPayment(intent, binding, observedAt);
  } catch {
    return blocked("Stripe observation unavailable; retry reconciliation");
  }
}

export function normalizeTestPayment(
  intent: Stripe.PaymentIntent,
  binding: TestPaymentBinding,
  observedAt: number,
): PaymentObservation {
  if (
    !validBinding(binding) ||
    !Number.isSafeInteger(observedAt) ||
    !Number.isSafeInteger(observedAt + PAYMENT_AUTHORIZATION_WINDOW_MS) ||
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
  const raw = charge?.payment_method_details?.card?.capture_before;
  const captureBeforeMs =
    typeof raw === "number" &&
    isPositiveInt(raw) &&
    Number.isSafeInteger(raw * 1000)
      ? raw * 1000
      : 0;
  const settled =
    !!charge &&
    charge.status === "succeeded" &&
    charge.paid &&
    !charge.refunded &&
    charge.amount_refunded === 0 &&
    !charge.disputed;
  let status: PaymentAuthorization["status"] | undefined;
  if (intent.status === "requires_capture") {
    if (
      !settled ||
      charge.captured ||
      charge.amount_captured !== 0 ||
      charge.payment_method_details?.type !== "card" ||
      intent.amount_capturable !== binding.amountMinor ||
      intent.amount_received !== 0 ||
      !captureBeforeMs
    )
      return blocked(
        "Full manual card authorization and provider capture expiry required",
      );
    status = captureBeforeMs > observedAt ? "authorized" : "failed";
  } else if (intent.status === "succeeded") {
    if (
      !settled ||
      !charge.captured ||
      charge.amount_captured !== binding.amountMinor ||
      intent.amount_received !== binding.amountMinor
    )
      return blocked(
        "Captured payment needs independent refund/dispute reconciliation",
      );
    status = "captured";
  } else if (intent.status === "requires_payment_method") {
    status = intent.last_payment_error ? "failed" : "pending";
  } else {
    status = SIMPLE_STATUS[intent.status];
    if (!status) return blocked("Unsupported Stripe payment state");
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
  const win = observedAt + PAYMENT_AUTHORIZATION_WINDOW_MS;
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
        status === "authorized" ? Math.min(captureBeforeMs, win) : observedAt,
      captureBeforeMs,
      source: "payment-observer",
      status,
      providerReceiptFingerprint: createHash("sha256")
        .update(JSON.stringify(receipt))
        .digest("hex"),
    },
  };
}

function validBinding(b: TestPaymentBinding): boolean {
  return (
    b.environment === "test" &&
    b.network === "preprod" &&
    b.currency === "USD" &&
    TEXT_IDS.every((k) => typeof b[k] === "string" && b[k].trim() !== "") &&
    isTestStripeId(b.stripeAccountId, b.stripeCustomerId) &&
    INTENT_ID.test(b.stripePaymentIntentId) &&
    isPositiveInt(b.quoteVersion) &&
    isPositiveInt(b.amountMinor)
  );
}
