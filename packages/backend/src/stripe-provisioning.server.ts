import Stripe from "stripe";
import type { FrozenQuote } from "./admission-policy";
import { PROVIDER_RETRY_WINDOW_MS } from "./provisioning-policy";
import {
  normalizeTestPayment,
  STRIPE_API_VERSION,
} from "./stripe-observer.server";

export function testStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_[a-zA-Z0-9]+$/.test(key))
    throw new Error("Server-only Stripe test key required");
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 1,
    timeout: 10_000,
  });
}

export interface ProvisioningRequest {
  jobId: string;
  firstAttemptAt: number;
  quote: FrozenQuote;
  stripeAccountId: string;
  stripeCustomerId: string;
}

// Never confirm, attach a payment method, capture, or return client secrets here.
export async function provisionTestIntent(
  request: ProvisioningRequest,
  stripe = testStripeClient(),
): Promise<string> {
  const { quote } = request;
  if (
    quote.network !== "preprod" ||
    !Number.isSafeInteger(quote.amountMinor) ||
    quote.amountMinor <= 0 ||
    !Number.isSafeInteger(quote.version) ||
    quote.version < 1 ||
    quote.currency !== "USD" ||
    !request.jobId ||
    !/^acct_[a-zA-Z0-9]+$/.test(request.stripeAccountId) ||
    !/^cus_[a-zA-Z0-9]+$/.test(request.stripeCustomerId)
  )
    throw new Error("Invalid trusted provisioning request");
  const account = await stripe.accounts.retrieveCurrent();
  if (account.id !== request.stripeAccountId)
    throw new Error("Stripe account mismatch");
  const customer = await stripe.customers.retrieve(request.stripeCustomerId);
  if (
    customer.deleted ||
    customer.livemode !== false ||
    customer.id !== request.stripeCustomerId
  )
    throw new Error("Test customer required");
  const now = Date.now();
  if (
    !Number.isSafeInteger(request.firstAttemptAt) ||
    request.firstAttemptAt > now ||
    now - request.firstAttemptAt >= PROVIDER_RETRY_WINDOW_MS ||
    quote.acceptanceDeadlineSeconds * 1000 <= now
  ) {
    throw new Error("Expired provisioning retry window or quote");
  }
  const intent = await stripe.paymentIntents.create(
    {
      amount: quote.amountMinor,
      currency: quote.currency.toLowerCase(),
      customer: request.stripeCustomerId,
      capture_method: "manual",
      payment_method_types: ["card"],
      confirm: false,
      metadata: {
        provisioningJob: request.jobId,
        quoteId: quote.id,
        quoteVersion: String(quote.version),
      },
    },
    { idempotencyKey: `milo-test-intent:${request.jobId}` },
  );
  const normalized = normalizeTestPayment(
    intent,
    {
      id: request.jobId,
      quoteId: quote.id,
      quoteVersion: quote.version,
      buyerAccountId: quote.buyerAccountId,
      stripeAccountId: request.stripeAccountId,
      stripeCustomerId: request.stripeCustomerId,
      stripePaymentIntentId: intent.id,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      environment: "test",
      network: "preprod",
    },
    Date.now(),
  );
  if (
    normalized.kind !== "observed" ||
    intent.metadata.provisioningJob !== request.jobId ||
    intent.metadata.quoteId !== quote.id ||
    intent.metadata.quoteVersion !== String(quote.version)
  )
    throw new Error("Provider intent binding mismatch");
  return intent.id;
}
