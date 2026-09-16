// Synthetic I/O boundary for the isolated native scheduler harness, not application code.
import type { PaymentAuthorization } from "../packages/backend/src/admission-policy";
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

export async function observeTestPayment(
  binding: TestPaymentBinding,
): Promise<PaymentObservation> {
  if (
    !binding.quoteId.startsWith("local-monitor-") ||
    binding.environment !== "test" ||
    binding.network !== "preprod"
  )
    throw new Error("Synthetic monitoring fixture required");
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const now = Date.now();
  return {
    kind: "observed",
    authorization: {
      id: binding.id,
      quoteId: binding.quoteId,
      quoteVersion: binding.quoteVersion,
      buyerAccountId: binding.buyerAccountId,
      amountMinor: binding.amountMinor,
      currency: binding.currency,
      usableFrom: now,
      usableUntil: now + 59_000,
      captureBeforeMs: now + 600_000,
      source: "payment-observer",
      status: "authorized",
      providerReceiptFingerprint: "b".repeat(64),
    },
  };
}
