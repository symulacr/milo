import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { requirePrivySubject } from "../src/privy-identity";
import {
  normalizeTestPayment,
  type TestPaymentBinding,
} from "../src/stripe-observer.server";

const now = 1_800_000_000_000;
const binding: TestPaymentBinding = {
  id: "authorization1",
  quoteId: "quote1",
  quoteVersion: 1,
  buyerAccountId: "buyer1",
  stripeAccountId: "acct_testfixture",
  stripeCustomerId: "cus_testfixture",
  stripePaymentIntentId: "pi_testfixture",
  amountMinor: 1200,
  currency: "USD",
  environment: "test",
  network: "preprod",
};

function fixture(): Stripe.PaymentIntent {
  // Only provider fields consumed by normalization; no network/persistence double.
  return {
    id: binding.stripePaymentIntentId,
    livemode: false,
    amount: 1200,
    currency: "usd",
    customer: binding.stripeCustomerId,
    capture_method: "manual",
    status: "requires_capture",
    amount_capturable: 1200,
    amount_received: 0,
    latest_charge: {
      id: "ch_testfixture",
      livemode: false,
      payment_intent: binding.stripePaymentIntentId,
      customer: binding.stripeCustomerId,
      amount: 1200,
      currency: "usd",
      status: "succeeded",
      paid: true,
      captured: false,
      amount_captured: 0,
      refunded: false,
      amount_refunded: 0,
      disputed: false,
      payment_method_details: {
        type: "card",
        card: { capture_before: now / 1000 + 600 },
      },
    },
  } as Stripe.PaymentIntent;
}

describe("Stripe server observation normalization", () => {
  test("matching non-USD intent and immutable binding fail the fixed protocol policy", () => {
    const intent = fixture();
    intent.currency = "eur";
    expect(
      normalizeTestPayment(intent, { ...binding, currency: "EUR" }, now).kind,
    ).toBe("blocked");
  });
  test("uses provider capture expiry and bounds observation freshness", () => {
    const result = normalizeTestPayment(fixture(), binding, now);
    expect(result.kind).toBe("observed");
    if (result.kind !== "observed") throw new Error("missing observation");
    expect(result.authorization).toMatchObject({
      id: binding.id,
      source: "payment-observer",
      status: "authorized",
      captureBeforeMs: now + 600_000,
      usableFrom: now,
      usableUntil: now + 60_000,
      currency: "USD",
    });
    expect(result.authorization.providerReceiptFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  test("never derives expiry from intent metadata or creation time", () => {
    const intent = fixture();
    const charge = intent.latest_charge as Stripe.Charge;
    if (charge.payment_method_details?.card)
      delete charge.payment_method_details.card.capture_before;
    intent.metadata = { capture_before: String(now / 1000 + 99999) };
    expect(normalizeTestPayment(intent, binding, now).kind).toBe("blocked");
  });

  test("expiry boundary cannot authorize", () => {
    const result = normalizeTestPayment(fixture(), binding, now + 600_000);
    expect(result.kind === "observed" && result.authorization.status).toBe(
      "failed",
    );
  });

  test("freshness never extends beyond a nearly expired provider hold", () => {
    const result = normalizeTestPayment(fixture(), binding, now + 590_000);
    expect(result.kind === "observed" && result.authorization.usableUntil).toBe(
      now + 600_000,
    );
  });

  for (const expiry of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    test(`rejects invalid provider capture expiry: ${expiry}`, () => {
      const intent = fixture();
      const charge = intent.latest_charge as Stripe.Charge;
      if (!charge.payment_method_details?.card) throw new Error("missing card");
      charge.payment_method_details.card.capture_before = expiry;
      expect(normalizeTestPayment(intent, binding, now).kind).toBe("blocked");
    });
  }

  for (const [field, value] of Object.entries({
    livemode: true,
    amount: 1199,
    currency: "eur",
    customer: "cus_another",
    id: "pi_another",
    capture_method: "automatic",
    amount_capturable: 1199,
    amount_received: 1,
    latest_charge: "ch_unexpanded",
  })) {
    test(`rejects intent mismatch: ${field}`, () => {
      const intent = { ...fixture(), [field]: value } as Stripe.PaymentIntent;
      expect(normalizeTestPayment(intent, binding, now).kind).toBe("blocked");
    });
  }

  for (const [field, value] of Object.entries({
    livemode: true,
    payment_intent: "pi_another",
    customer: "cus_another",
    captured: true,
    amount_captured: 1,
    disputed: true,
    refunded: true,
    amount_refunded: 1,
    paid: false,
  })) {
    test(`rejects charge mismatch: ${field}`, () => {
      const intent = fixture();
      intent.latest_charge = {
        ...(intent.latest_charge as Stripe.Charge),
        [field]: value,
      };
      expect(normalizeTestPayment(intent, binding, now).kind).toBe("blocked");
    });
  }

  for (const [provider, expected] of [
    ["processing", "pending"],
    ["requires_action", "pending"],
    ["requires_confirmation", "pending"],
    ["requires_payment_method", "pending"],
    ["canceled", "voided"],
  ] as const) {
    test(`${provider} never authorizes admission`, () => {
      const intent = fixture();
      intent.status = provider;
      intent.latest_charge = null;
      const result = normalizeTestPayment(intent, binding, now);
      expect(result.kind === "observed" && result.authorization.status).toBe(
        expected,
      );
    });
  }

  test("captured state is not a reusable authorization", () => {
    const intent = fixture();
    intent.status = "succeeded";
    intent.amount_received = 1200;
    const charge = intent.latest_charge as Stripe.Charge;
    charge.captured = true;
    charge.amount_captured = 1200;
    const result = normalizeTestPayment(intent, binding, now);
    expect(result.kind === "observed" && result.authorization.status).toBe(
      "captured",
    );
    charge.amount_refunded = 1;
    expect(normalizeTestPayment(intent, binding, now).kind).toBe("blocked");
  });

  test("rejects live bindings and invalid clocks", () => {
    expect(
      normalizeTestPayment(
        fixture(),
        { ...binding, environment: "live" } as unknown as TestPaymentBinding,
        now,
      ).kind,
    ).toBe("blocked");
    expect(normalizeTestPayment(fixture(), binding, Number.NaN).kind).toBe(
      "blocked",
    );
    expect(
      normalizeTestPayment(fixture(), binding, Number.MAX_SAFE_INTEGER).kind,
    ).toBe("blocked");
    expect(
      normalizeTestPayment(
        fixture(),
        { ...binding, network: "mainnet" } as unknown as TestPaymentBinding,
        now,
      ).kind,
    ).toBe("blocked");
  });
});

describe("Privy identity boundary", () => {
  test("accepts the subject of a Convex-validated Privy identity", () => {
    expect(
      requirePrivySubject({ issuer: "privy.io", subject: "did:privy:user1" }),
    ).toBe("did:privy:user1");
  });
  test("rejects missing identity, another issuer and malformed subject", () => {
    for (const identity of [
      null,
      { issuer: "another", subject: "did:privy:user1" },
      { issuer: "privy.io", subject: "user1" },
    ]) {
      expect(() => requirePrivySubject(identity)).toThrow(
        "Authenticated Privy identity required",
      );
    }
  });
});
