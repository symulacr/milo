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

/**
 * R50: the guard the numbers above only describe.
 *
 * Stripe cancels an uncaptured PaymentIntent a fixed number of days after it is
 * created — 7 by default. Capture happens only once the order reaches APPROVED
 * (`settlement.ts`: `settlementAuthorized("capture", phase)`), and the contract
 * can reach APPROVED at two points:
 *
 *   - `approve`, bounded by `reviewDeadline`     = acceptance + delivery + review
 *   - `resolve`, bounded by `resolutionDeadline` = all four windows
 *
 * So the LATEST possible capture is the full cumulative window. If that ever
 * exceeds the provider limit the authorization is already gone when capture
 * runs, and the order fails with nothing to capture — silently, and only for
 * orders that took the long path. Nothing else in the suite would notice: the
 * assertions above hardcode 121 h, so lengthening `review` fails them with
 * "expected 121 to be 169", which says nothing about why 121 mattered.
 *
 * Margin policy: require at least 24 h of slack (cumulative <= 6 days).
 *
 * Why 24 h and not more: today's margin is 47 h, so a 48 h policy would fail on
 * the day it landed — a guard that is red before anyone breaks anything is
 * worse than no guard. 24 h is the largest round number that passes with room
 * to spare while still catching a real change: review 48 h -> 72 h passes
 * (145 h, 23 h margin); review 48 h -> 96 h fails (169 h, -1 h).
 *
 * Why a margin at all: Stripe's 7 days is a *default* an account can lower, the
 * capture call is subject to retry and clock skew, and `capture_before` is a
 * provider-side instant we do not control. One day absorbs all three without
 * pretending we know the account's real setting. The message states the
 * arithmetic so the next person learns why the ceiling exists.
 */
const PROVIDER_AUTH_LIMIT_MS = 7 * DAY;
const REQUIRED_MARGIN_MS = 24 * HOUR;

/** `approve` is bounded by reviewDeadline: the common, earlier capture point. */
const capturePointMs = () =>
  ORDER_WINDOWS_MS.acceptance +
  ORDER_WINDOWS_MS.delivery +
  ORDER_WINDOWS_MS.review;

/** `resolve` is bounded by resolutionDeadline: the latest possible capture. */
const latestCaptureMs = () => capturePointMs() + ORDER_WINDOWS_MS.resolution;

const overrunMessage = (latest: number) =>
  `order windows total ${latest / HOUR} h; Stripe cancels an uncaptured ` +
  `PaymentIntent after ${PROVIDER_AUTH_LIMIT_MS / HOUR} h, so capture at ` +
  `APPROVED would fail with nothing to capture. Shorten a window or raise the ` +
  `Stripe limit; ${REQUIRED_MARGIN_MS / HOUR} h of margin is required.`;

describe("R50 the windows fit inside Stripe's authorization lifetime", () => {
  test("the latest capture point leaves at least a day of margin", () => {
    const latest = latestCaptureMs();
    expect(
      PROVIDER_AUTH_LIMIT_MS - latest >= REQUIRED_MARGIN_MS
        ? "ok"
        : overrunMessage(latest),
    ).toBe("ok");
  });

  test("the earliest capture point is inside the limit by a wide margin", () => {
    const earliest = capturePointMs();
    // The approve path is the common one; it must never be the binding bound.
    expect(
      PROVIDER_AUTH_LIMIT_MS - earliest >= REQUIRED_MARGIN_MS
        ? "ok"
        : `approve is bounded by reviewDeadline = ${earliest / HOUR} h, leaving ` +
            `only ${(PROVIDER_AUTH_LIMIT_MS - earliest) / HOUR} h before Stripe ` +
            `cancels the authorization.`,
    ).toBe("ok");
  });

  test("the guard fires, with the arithmetic, when review is lengthened", () => {
    // The plausible product change this exists to catch: review 48 h -> 96 h.
    const review = 96 * HOUR;
    const latest =
      ORDER_WINDOWS_MS.acceptance +
      ORDER_WINDOWS_MS.delivery +
      review +
      ORDER_WINDOWS_MS.resolution;
    const margin = PROVIDER_AUTH_LIMIT_MS - latest;
    expect(margin).toBeLessThan(REQUIRED_MARGIN_MS);
    expect(margin).toBeLessThan(0);
    const message = overrunMessage(latest);
    expect(message).toContain("169 h");
    expect(message).toContain("168 h");
    expect(message).toContain("nothing to capture");
  });
});
