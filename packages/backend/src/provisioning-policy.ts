import type { FrozenQuote, PaymentAuthorization } from "./admission-policy";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "./admission-policy";
import { HEX64 } from "./encoding.ts";
import { validPublicConstructor } from "./public-constructor.ts";

export const PROVIDER_RETRY_WINDOW_MS = 23 * 60 * 60_000;
export const PROVIDER_LEASE_MS = 60_000;

const nonNegative = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export function validJobClock(
  job: { generation: number; startedAt: number; firstAttemptAt?: number },
  now: number,
) {
  return (
    nonNegative(now) &&
    Number.isSafeInteger(job.generation) &&
    job.generation > 0 &&
    job.generation < Number.MAX_SAFE_INTEGER &&
    nonNegative(job.startedAt) &&
    job.startedAt <= now &&
    (job.firstAttemptAt === undefined ||
      (nonNegative(job.firstAttemptAt) && job.firstAttemptAt <= job.startedAt))
  );
}

/**
 * The image-pack policy an approved quote implies when the row predates the
 * field. `imagePackPolicy` was added as a required object in a later build, so a
 * quote approved before that revision has no such field and was permanently
 * unreadable (R21 I-05). The policy is *derived* from `amountMinor` anyway, so
 * defaulting it is a reconstruction, not a guess: there is exactly one policy
 * shape (`serviceVersion 1`, one pack, three outputs) and its price is the
 * quote's own amount.
 */
export function imagePackPolicyFor(quote: { amountMinor: number }) {
  return {
    serviceVersion: 1 as const,
    packQuantity: 1 as const,
    outputCount: 3 as const,
    unitPriceMinor: quote.amountMinor,
  };
}

export function validateImagePackPolicy(
  quote: FrozenQuote,
  policy: {
    serviceVersion: number;
    packQuantity: number;
    outputCount: number;
    unitPriceMinor: number;
  },
) {
  if (
    policy?.serviceVersion !== 1 ||
    policy.packQuantity !== 1 ||
    policy.outputCount !== 3 ||
    !Number.isSafeInteger(policy.unitPriceMinor) ||
    policy.unitPriceMinor <= 0 ||
    policy.unitPriceMinor !== quote.amountMinor ||
    quote.currency !== "USD"
  )
    throw new Error("Approved USD image-pack policy required");
}

export function validateFreeze(
  quote: FrozenQuote,
  expiresAt: number,
  now: number,
) {
  if (
    !validPublicConstructor(quote) ||
    !nonNegative(now) ||
    quote.network !== "preprod" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    !Number.isSafeInteger(quote.version) ||
    quote.version < 1 ||
    !Number.isSafeInteger(quote.amountMinor) ||
    quote.amountMinor <= 0 ||
    quote.currency !== "USD" ||
    ![quote.id, quote.nonce, quote.buyerAccountId].every(
      (value) => value.trim().length > 0,
    ) ||
    ![
      quote.termsCommitment,
      quote.artifactFingerprint,
      quote.keySetFingerprint,
      quote.rolesFingerprint,
      quote.initialStateFingerprint,
      quote.genesisHash,
    ].every((value) => HEX64.test(value))
  )
    throw new Error("Approved preprod quote is invalid or expired");
  let previous = Math.floor(now / 1000);
  for (const deadline of [
    quote.acceptanceDeadlineSeconds,
    quote.deliveryDeadlineSeconds,
    quote.reviewDeadlineSeconds,
    quote.resolutionDeadlineSeconds,
  ]) {
    if (!Number.isSafeInteger(deadline) || deadline <= previous)
      throw new Error("Quote deadlines must be future and strictly ordered");
    previous = deadline;
  }
}

export function usableObservation(
  authorization: PaymentAuthorization,
  now: number,
  startedAt: number,
) {
  return (
    nonNegative(now) &&
    nonNegative(startedAt) &&
    startedAt <= now &&
    Number.isSafeInteger(authorization.usableFrom) &&
    Number.isSafeInteger(authorization.usableUntil) &&
    authorization.usableFrom >= startedAt &&
    authorization.usableFrom <= now &&
    now - authorization.usableFrom < PAYMENT_AUTHORIZATION_WINDOW_MS &&
    authorization.usableUntil >= authorization.usableFrom &&
    authorization.usableUntil - authorization.usableFrom <=
      PAYMENT_AUTHORIZATION_WINDOW_MS &&
    now < authorization.usableUntil &&
    HEX64.test(authorization.providerReceiptFingerprint)
  );
}

/**
 * A hold is capturable when the provider still allows the capture, whatever the
 * observation's age. `usableObservation` answers a different question: is this
 * observation recent enough to admit a contract. Capture happens days later, so
 * it must ask the provider's expiry, not the admission freshness rule.
 */
export function capturableHold(
  authorization: PaymentAuthorization,
  now: number,
) {
  return (
    nonNegative(now) &&
    authorization.status === "authorized" &&
    Number.isSafeInteger(authorization.usableFrom) &&
    Number.isSafeInteger(authorization.captureBeforeMs) &&
    authorization.captureBeforeMs > authorization.usableFrom &&
    now >= authorization.usableFrom &&
    now < authorization.captureBeforeMs &&
    HEX64.test(authorization.providerReceiptFingerprint)
  );
}

/** The window question admission asks, asked again at capture. */
export const captureCoversResolution = (
  authorization: PaymentAuthorization,
  resolutionDeadlineSeconds: number,
  captureSafetyMarginMs: number,
): boolean =>
  BigInt(resolutionDeadlineSeconds) * 1000n + BigInt(captureSafetyMarginMs) <
  BigInt(authorization.captureBeforeMs);
