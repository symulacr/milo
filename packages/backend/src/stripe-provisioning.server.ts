import type Stripe from "stripe";
import type { FrozenQuote } from "./admission-policy";
import { PROVIDER_RETRY_WINDOW_MS } from "./provisioning-policy";
import {
  isPositiveInt,
  isTestStripeId,
  normalizeTestPayment,
  testStripeClient,
} from "./stripe-observer.server";

export { testStripeClient };

export interface ProvisioningRequest {
  jobId: string;
  firstAttemptAt: number;
  quote: FrozenQuote;
  stripeAccountId: string;
  stripeCustomerId: string;
}

export async function provisionTestIntent(
  request: ProvisioningRequest,
  stripe: Stripe = testStripeClient(),
): Promise<string> {
  const { quote } = request;
  if (
    quote.network !== "preprod" ||
    quote.currency !== "USD" ||
    !isPositiveInt(quote.amountMinor) ||
    !isPositiveInt(quote.version) ||
    !request.jobId ||
    !isTestStripeId(request.stripeAccountId, request.stripeCustomerId)
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
  )
    throw new Error("Expired provisioning retry window or quote");
  const metadata = {
    provisioningJob: request.jobId,
    quoteId: quote.id,
    quoteVersion: String(quote.version),
  };
  const intent = await stripe.paymentIntents.create(
    {
      amount: quote.amountMinor,
      currency: quote.currency.toLowerCase(),
      customer: request.stripeCustomerId,
      capture_method: "manual",
      allowed_payment_method_types: ["card"],
      confirm: false,
      metadata,
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
    intent.metadata.provisioningJob !== metadata.provisioningJob ||
    intent.metadata.quoteId !== metadata.quoteId ||
    intent.metadata.quoteVersion !== metadata.quoteVersion
  )
    throw new Error("Provider intent binding mismatch");
  return intent.id;
}
