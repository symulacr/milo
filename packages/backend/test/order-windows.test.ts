/**
 * Item 10: the order windows and the payment authorization window must agree.
 *
 * The contract runs up to 121 h (acceptance 1 h + delivery 24 h + review 48 h +
 * resolution 48 h). Stripe's manual capture limit is 7 days, so the window is
 * inside the provider limit. The risk is Milo's own freshness rule:
 * `PAYMENT_AUTHORIZATION_WINDOW_MS` is 60 s, and `openSettlement` refuses to
 * capture without an observation that is still inside it.
 */
import { describe, expect, test } from "bun:test";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "../src/admission-policy";
import { ORDER_WINDOWS_MS } from "../src/order-windows";
import { usableObservation } from "../src/provisioning-policy";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const authorization = (observedAt: number, captureBeforeMs: number) => ({
  id: "pi-1",
  quoteId: "quote-1",
  quoteVersion: 1,
  buyerAccountId: "buyer-1",
  amountMinor: 90_000,
  currency: "USD",
  usableFrom: observedAt,
  usableUntil: Math.min(
    captureBeforeMs,
    observedAt + PAYMENT_AUTHORIZATION_WINDOW_MS,
  ),
  captureBeforeMs,
  source: "payment-observer" as const,
  status: "authorized" as const,
  providerReceiptFingerprint: "a".repeat(64),
});

describe("item 10 order windows", () => {
  test("the four windows are 1 h, 24 h, 48 h and 48 h", () => {
    expect(ORDER_WINDOWS_MS.acceptance).toBe(HOUR);
    expect(ORDER_WINDOWS_MS.delivery).toBe(24 * HOUR);
    expect(ORDER_WINDOWS_MS.review).toBe(48 * HOUR);
    expect(ORDER_WINDOWS_MS.resolution).toBe(48 * HOUR);
  });

  test("the cumulative window is 121 h, inside Stripe's 7 day manual capture limit", () => {
    const cumulative =
      ORDER_WINDOWS_MS.acceptance +
      ORDER_WINDOWS_MS.delivery +
      ORDER_WINDOWS_MS.review +
      ORDER_WINDOWS_MS.resolution;
    expect(cumulative).toBe(121 * HOUR);
    expect(cumulative).toBeLessThan(7 * DAY);
    expect(7 * DAY - cumulative).toBe(47 * HOUR);
  });
});

describe("item 10 the hold is usable for 60 s, not for the order", () => {
  const now = 1_000_000;

  test("an observation from the hold is usable only for 60 s", () => {
    const hold = authorization(now, now + 7 * DAY);
    expect(usableObservation(hold, now + 59_000, hold.usableFrom)).toBe(true);
    expect(usableObservation(hold, now + 61_000, hold.usableFrom)).toBe(false);
  });

  test("capture 121 h later needs a NEW observation, not the hold one", () => {
    const hold = authorization(now, now + 7 * DAY);
    const atApproval = now + 121 * HOUR;
    expect(usableObservation(hold, atApproval, hold.usableFrom)).toBe(false);
    const fresh = authorization(atApproval, now + 7 * DAY);
    expect(usableObservation(fresh, atApproval, fresh.usableFrom)).toBe(true);
  });

  test("the provider expiry still bounds a fresh observation", () => {
    const atApproval = now + 121 * HOUR;
    const expiring = authorization(atApproval, atApproval + 1_000);
    expect(
      usableObservation(expiring, atApproval + 2_000, expiring.usableFrom),
    ).toBe(false);
  });
});
