/**
 * Round 3, item 1 (variant B): capture must ask the provider's expiry, not the
 * admission freshness rule.
 *
 * `usableObservation` answers "is this observation recent enough to admit a
 * contract" (60 s). Capture happens up to 121 h later, so it must ask "will the
 * provider still capture this hold". `capturableHold` is that question.
 */
import { describe, expect, test } from "bun:test";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "../src/admission-policy";
import { capturableHold, usableObservation } from "../src/provisioning-policy";

const HOUR = 60 * 60_000;

const authorization = (
  observedAt: number,
  captureBeforeMs: number,
  status = "authorized",
) => ({
  id: "pi1",
  quoteId: "quote-1",
  quoteVersion: 1,
  buyerAccountId: "buyer-1",
  amountMinor: 90_000,
  currency: "USD",
  usableFrom: observedAt,
  usableUntil: Math.min(captureBeforeMs, observedAt + 60_000),
  captureBeforeMs,
  source: "payment-observer" as const,
  status: status as "authorized",
  providerReceiptFingerprint: "a".repeat(64),
});

describe("item 1 capturableHold", () => {
  test("a 121 h old hold is still capturable while the provider allows it", () => {
    const now = Date.now();
    const hold = authorization(now - 121 * HOUR, now + 48 * HOUR);
    expect(capturableHold(hold, now)).toBe(true);
    expect(usableObservation(hold, now, hold.usableFrom)).toBe(false);
  });

  test("the provider expiry ends capture", () => {
    const now = Date.now();
    const expired = authorization(now - 121 * HOUR, now - 1);
    expect(capturableHold(expired, now)).toBe(false);
  });

  test("a captured or voided hold is not capturable again", () => {
    const now = Date.now();
    for (const status of ["captured", "voided", "failed", "pending"]) {
      const hold = authorization(now - HOUR, now + HOUR, status);
      expect(capturableHold(hold, now)).toBe(false);
    }
  });

  test("a hold observed in the future is not capturable", () => {
    const now = Date.now();
    expect(capturableHold(authorization(now + HOUR, now + 2 * HOUR), now)).toBe(
      false,
    );
  });

  test("a malformed receipt fingerprint is not capturable", () => {
    const now = Date.now();
    const hold = authorization(now - HOUR, now + HOUR);
    expect(
      capturableHold({ ...hold, providerReceiptFingerprint: "x" }, now),
    ).toBe(false);
  });

  test("the admission rule is unchanged for a fresh observation", () => {
    const now = Date.now();
    const fresh = authorization(now - 1_000, now + HOUR);
    expect(usableObservation(fresh, now, fresh.usableFrom)).toBe(true);
    expect(PAYMENT_AUTHORIZATION_WINDOW_MS).toBe(60_000);
  });
});
