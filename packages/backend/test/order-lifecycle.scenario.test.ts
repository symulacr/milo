/**
 * Cross-component scenario: one order's whole server-side life, from a studio
 * freezing a quote to a settled payment, driven through the pure policy layer
 * and the webhook verifier with fakes only. Each step asserts the gate that
 * must hold at that moment, so a regression anywhere on the path shows up as a
 * named user path failing rather than an anonymous unit.
 */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  parseStripeSignatureHeader,
  verifyStripeSignature,
  WEBHOOK_TOLERANCE_MS,
} from "../../../convex/http";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "../src/admission-policy";
import {
  capturableHold,
  usableObservation,
  validateFreeze,
  validateImagePackPolicy,
} from "../src/provisioning-policy";
import { buildAuthorization, buildQuote } from "./fixtures";

const WHSEC = "whsec_scenario0123456789abcdefghij";
const DAY = 24 * 60 * 60_000;

function signedHeader(payload: string, at: number): string {
  const v1 = createHmac("sha256", WHSEC)
    .update(`${at}.${payload}`, "utf8")
    .digest("hex");
  return `t=${at},v1=${v1}`;
}

describe("scenario: freeze a quote, admit the buyer's hold", () => {
  test("a fresh quote passes both gates; a stale window and a mispriced pack do not", () => {
    const quote = buildQuote();
    const now = Date.now();
    expect(() => validateFreeze(quote, now + 600_000, now)).not.toThrow();
    expect(() => validateFreeze(quote, now - 1, now)).toThrow(/expired/);
    const policy = {
      ...quote.imagePackPolicy,
      unitPriceMinor: quote.amountMinor,
    };
    expect(() => validateImagePackPolicy(quote, policy)).not.toThrow();
    expect(() =>
      validateImagePackPolicy(quote, { ...policy, unitPriceMinor: 1 }),
    ).toThrow(/USD image-pack policy/);
  });

  test("a hold admits the contract only inside the 60 s observation window", () => {
    const auth = buildAuthorization();
    const startedAt = auth.usableFrom;
    expect(usableObservation(auth, auth.usableFrom + 1_000, startedAt)).toBe(
      true,
    );
    expect(
      usableObservation(
        auth,
        auth.usableFrom + PAYMENT_AUTHORIZATION_WINDOW_MS,
        startedAt,
      ),
    ).toBe(false);
  });
});

describe("scenario: approve, then capture days later", () => {
  test("the hold that is too old to admit is still capturable, until the provider deadline", () => {
    const auth = buildAuthorization();
    const startedAt = auth.usableFrom;
    const threeDays = auth.usableFrom + 3 * DAY;
    expect(usableObservation(auth, threeDays, startedAt)).toBe(false);
    expect(capturableHold(auth, threeDays)).toBe(true);
    expect(capturableHold(auth, auth.captureBeforeMs - 1)).toBe(true);
    expect(capturableHold(auth, auth.captureBeforeMs)).toBe(false);
  });

  test("a hold already captured, voided, failed or pending cannot be captured", () => {
    for (const status of ["captured", "voided", "failed", "pending"] as const) {
      expect(capturableHold(buildAuthorization({ status }), Date.now())).toBe(
        false,
      );
    }
  });
});

describe("scenario: the Stripe webhook for that capture, and its replay", () => {
  const payload = JSON.stringify({
    id: "evt_scenario_1",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: "pi_scenario_1" } },
  });

  test("a signed event verifies; a tampered body and a stale replay do not", () => {
    const at = Math.floor(Date.now() / 1000);
    const header = signedHeader(payload, at);
    expect(
      verifyStripeSignature({ payload, header, secret: WHSEC, now: at * 1000 }),
    ).toEqual({ ok: true });
    expect(parseStripeSignatureHeader(header)?.v1).toHaveLength(1);
    expect(
      verifyStripeSignature({
        payload: payload.replace("pi_scenario_1", "pi_attacker"),
        header,
        secret: WHSEC,
        now: at * 1000,
      }).ok,
    ).toBe(false);
    expect(
      verifyStripeSignature({
        payload,
        header,
        secret: WHSEC,
        now: at * 1000 + WEBHOOK_TOLERANCE_MS + 1,
      }).ok,
    ).toBe(false);
  });

  test("a replay inside the window still verifies, so dedupe must be by event id", () => {
    const at = Math.floor(Date.now() / 1000);
    // Same body, same signature, one minute later: the signature check cannot
    // distinguish a replay. The inbox's (provider, account, eventId) key must.
    expect(
      verifyStripeSignature({
        payload,
        header: signedHeader(payload, at),
        secret: WHSEC,
        now: at * 1000 + 60_000,
      }),
    ).toEqual({ ok: true });
    expect(JSON.parse(payload).id).toBe("evt_scenario_1");
  });
});

describe("scenario: every expiry on the order path fails closed", () => {
  test("non-increasing deadlines, a non-preprod network and a malformed commitment are refused", () => {
    const quote = buildQuote();
    const now = Date.now();
    const cases: Record<string, unknown>[] = [
      { deliveryDeadlineSeconds: quote.acceptanceDeadlineSeconds },
      { reviewDeadlineSeconds: quote.deliveryDeadlineSeconds },
      { resolutionDeadlineSeconds: quote.reviewDeadlineSeconds },
      { network: "mainnet" },
      { termsCommitment: "not-hex" },
    ];
    for (const broken of cases) {
      expect(() =>
        validateFreeze({ ...quote, ...broken }, now + 600_000, now),
      ).toThrow();
    }
  });
});
