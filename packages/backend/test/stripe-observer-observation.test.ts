import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "../src/admission-policy";
import {
  observeTestPayment,
  type TestPaymentBinding,
} from "../src/stripe-observer.server";
import { installStripeDouble } from "./stripe-fetch-double";

const observedAt = 1_800_000_000_000;

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

function authorizedIntent(): Stripe.PaymentIntent {
  return {
    id: binding.stripePaymentIntentId,
    object: "payment_intent",
    livemode: false,
    amount: binding.amountMinor,
    currency: "usd",
    customer: binding.stripeCustomerId,
    capture_method: "manual",
    status: "requires_capture",
    amount_capturable: binding.amountMinor,
    amount_received: 0,
    latest_charge: {
      id: "ch_testfixture",
      object: "charge",
      livemode: false,
      payment_intent: binding.stripePaymentIntentId,
      customer: binding.stripeCustomerId,
      amount: binding.amountMinor,
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
        card: { capture_before: observedAt / 1000 + 600 },
      },
    },
  } as unknown as Stripe.PaymentIntent;
}

async function observe(
  routes: Parameters<typeof installStripeDouble>[0],
  args: TestPaymentBinding = binding,
) {
  const double = installStripeDouble({
    account: { id: args.stripeAccountId, object: "account" },
    ...routes,
  });
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_observercoverage";
  try {
    const result = await observeTestPayment(args);
    return { result, urls: double.urls };
  } finally {
    double.restore();
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  }
}

describe("observeTestPayment provider read path", () => {
  test("requires a server-only Stripe TEST key before touching the provider", async () => {
    for (const key of [
      undefined,
      "",
      "sk_live_observercoverage",
      "pk_test_x",
    ]) {
      const double = installStripeDouble();
      const previous = process.env.STRIPE_SECRET_KEY;
      if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = key;
      let caught: unknown;
      try {
        await observeTestPayment(binding);
      } catch (error) {
        caught = error;
      } finally {
        double.restore();
        if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
        else process.env.STRIPE_SECRET_KEY = previous;
      }
      expect((caught as Error).message).toBe(
        "A server-only Stripe test key is required",
      );
      expect(double.urls).toEqual([]);
    }
  });

  test("an invalid binding is refused before the account is read", async () => {
    const invalid: (keyof TestPaymentBinding)[] = [
      "environment",
      "network",
      "stripeAccountId",
      "stripeCustomerId",
      "stripePaymentIntentId",
      "currency",
    ];
    for (const field of invalid) {
      const bad =
        field === "environment"
          ? "live"
          : field === "network"
            ? "mainnet"
            : field === "currency"
              ? "EUR"
              : "not-a-provider-id";
      const { result, urls } = await observe({}, {
        ...binding,
        [field]: bad,
      } as TestPaymentBinding);
      expect(result).toEqual({
        kind: "blocked",
        reason: "Invalid test payment binding",
      });
      expect(urls).toEqual([]);
    }
    for (const [field, value] of [
      ["id", ""],
      ["quoteId", "   "],
      ["buyerAccountId", 42],
      ["quoteVersion", 0],
      ["quoteVersion", 1.5],
      ["amountMinor", 0],
      ["amountMinor", Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      const { result, urls } = await observe({}, {
        ...binding,
        [field]: value,
      } as unknown as TestPaymentBinding);
      expect(result).toEqual({
        kind: "blocked",
        reason: "Invalid test payment binding",
      });
      expect(urls).toEqual([]);
    }
  });

  test("reads the account first, then the expanded intent, and normalizes the result", async () => {
    const { result, urls } = await observe({
      intent: () => authorizedIntent(),
    });
    expect(urls).toEqual([
      "https://api.stripe.com/v1/account",
      "https://api.stripe.com/v1/payment_intents/pi_testfixture?expand[0]=latest_charge",
    ]);
    expect(result.kind).toBe("observed");
    if (result.kind !== "observed") throw new Error("expected observation");
    expect(result.authorization).toMatchObject({
      id: binding.id,
      quoteId: binding.quoteId,
      quoteVersion: binding.quoteVersion,
      buyerAccountId: binding.buyerAccountId,
      amountMinor: binding.amountMinor,
      currency: "USD",
      source: "payment-observer",
      status: "authorized",
    });
    expect(result.authorization.providerReceiptFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result.authorization.usableFrom).toBeGreaterThan(0);
    expect(
      result.authorization.usableUntil - result.authorization.usableFrom,
    ).toBe(PAYMENT_AUTHORIZATION_WINDOW_MS);
  });

  test("the reported authorization never outlives the provider capture expiry", async () => {
    const captureBeforeMs = observedAt + 5_000;
    const { result } = await observe({
      intent: () => {
        const intent = authorizedIntent();
        const charge = intent.latest_charge as unknown as {
          payment_method_details: { card: { capture_before: number } };
        };
        charge.payment_method_details.card.capture_before =
          captureBeforeMs / 1000;
        return intent;
      },
    });
    if (result.kind !== "observed") throw new Error("expected observation");
    expect(result.authorization.captureBeforeMs).toBe(captureBeforeMs);
    expect(result.authorization.usableUntil).toBe(
      Math.min(captureBeforeMs, result.authorization.usableFrom + 60_000),
    );
  });

  test("an account that is not the bound one blocks before the intent read", async () => {
    const { result, urls } = await observe({
      account: { id: "acct_someoneelse", object: "account" },
      intent: () => authorizedIntent(),
    });
    expect(result).toEqual({
      kind: "blocked",
      reason: "Stripe account mismatch",
    });
    expect(urls).toEqual(["https://api.stripe.com/v1/account"]);
  });

  test("a live-mode intent that otherwise matches is still blocked", async () => {
    const { result } = await observe({
      intent: () =>
        ({ ...authorizedIntent(), livemode: true }) as Stripe.PaymentIntent,
    });
    expect(result).toEqual({
      kind: "blocked",
      reason: "Stripe intent does not match immutable test binding",
    });
  });

  test("a non-manual capture method is blocked", async () => {
    const { result } = await observe({
      intent: () =>
        ({
          ...authorizedIntent(),
          capture_method: "automatic",
        }) as Stripe.PaymentIntent,
    });
    expect(result).toEqual({
      kind: "blocked",
      reason: "Stripe intent does not match immutable test binding",
    });
  });

  test("a provider error is redacted into the retry reason", async () => {
    const { result, urls } = await observe({ status: 500 });
    expect(result).toEqual({
      kind: "blocked",
      reason: "Stripe observation unavailable; retry reconciliation",
    });
    expect(JSON.stringify(result)).not.toContain("cus_leak");
    expect(urls[0]).toBe("https://api.stripe.com/v1/account");
  });

  test("an intent the double does not stub fails closed rather than returning a fake authorization", async () => {
    const { result } = await observe({});
    expect(result.kind).toBe("blocked");
  });

  test("an unsupported provider state blocks with the named reason", async () => {
    const { result } = await observe({
      intent: () =>
        ({
          ...authorizedIntent(),
          status: "processing",
        }) as Stripe.PaymentIntent,
    });
    if (result.kind !== "observed")
      throw new Error(`expected observation, got ${JSON.stringify(result)}`);
    expect(result.authorization.status).toBe("pending");

    const { result: unsupported } = await observe({
      intent: () =>
        ({
          ...authorizedIntent(),
          status: "not_a_stripe_state",
        }) as unknown as Stripe.PaymentIntent,
    });
    expect(unsupported).toEqual({
      kind: "blocked",
      reason: "Unsupported Stripe payment state",
    });
  });

  test("every provider state maps to the documented authorization status", async () => {
    const succeededIntent = (charge: Record<string, unknown>) => () => {
      const intent = authorizedIntent();
      Object.assign(intent, { status: "succeeded", amount_received: 1200 });
      (intent as unknown as Record<string, unknown>).latest_charge = {
        ...(intent.latest_charge as unknown as Record<string, unknown>),
        status: "succeeded",
        captured: true,
        amount_captured: 1200,
        ...charge,
      };
      return intent;
    };
    const cases: [string, () => Stripe.PaymentIntent, string][] = [
      ["requires_capture", () => authorizedIntent(), "authorized"],
      ["succeeded", succeededIntent({}), "captured"],
      [
        "canceled",
        () =>
          ({
            ...authorizedIntent(),
            status: "canceled",
          }) as Stripe.PaymentIntent,
        "voided",
      ],
      [
        "requires_payment_method-with-error",
        () =>
          ({
            ...authorizedIntent(),
            status: "requires_payment_method",
            last_payment_error: { code: "card_declined" },
          }) as unknown as Stripe.PaymentIntent,
        "failed",
      ],
      [
        "requires_payment_method",
        () =>
          ({
            ...authorizedIntent(),
            status: "requires_payment_method",
          }) as Stripe.PaymentIntent,
        "pending",
      ],
      [
        "processing",
        () =>
          ({
            ...authorizedIntent(),
            status: "processing",
          }) as Stripe.PaymentIntent,
        "pending",
      ],
      [
        "requires_action",
        () =>
          ({
            ...authorizedIntent(),
            status: "requires_action",
          }) as Stripe.PaymentIntent,
        "pending",
      ],
      [
        "requires_confirmation",
        () =>
          ({
            ...authorizedIntent(),
            status: "requires_confirmation",
          }) as Stripe.PaymentIntent,
        "pending",
      ],
    ];
    for (const [status, build, expected] of cases) {
      const { result } = await observe({ intent: build });
      if (result.kind !== "observed")
        throw new Error(
          `${status}: expected observation, got ${JSON.stringify(result)}`,
        );
      expect(`${status}=${result.authorization.status}`).toBe(
        `${status}=${expected}`,
      );
      expect(result.authorization.source).toBe("payment-observer");
    }
  });

  test("a captured payment still needs its refund and dispute facts reconciled", async () => {
    const build = (patch: Record<string, unknown>) => () => {
      const intent = authorizedIntent();
      Object.assign(intent, { status: "succeeded", amount_received: 1200 });
      (intent as unknown as Record<string, unknown>).latest_charge = {
        ...(intent.latest_charge as unknown as Record<string, unknown>),
        status: "succeeded",
        captured: true,
        amount_captured: 1200,
        ...patch,
      };
      return intent;
    };
    for (const patch of [
      { amount_captured: 1199 },
      { refunded: true },
      { amount_refunded: 1 },
      { disputed: true },
    ]) {
      const { result } = await observe({ intent: build(patch) });
      expect(result).toEqual({
        kind: "blocked",
        reason:
          "Captured payment needs independent refund/dispute reconciliation",
      });
    }
    expect((await observe({ intent: build({}) })).result.kind).toBe("observed");
  });

  test("a capture that already happened cannot be reported as an authorization", async () => {
    const { result } = await observe({
      intent: () => {
        const intent = authorizedIntent();
        const charge = intent.latest_charge as unknown as Record<
          string,
          unknown
        >;
        charge.captured = true;
        return intent;
      },
    });
    expect(result).toEqual({
      kind: "blocked",
      reason:
        "Full manual card authorization and provider capture expiry required",
    });
  });

  test("a missing capture expiry blocks instead of falling back to a default", async () => {
    const { result } = await observe({
      intent: () => {
        const intent = authorizedIntent();
        const charge = intent.latest_charge as unknown as {
          payment_method_details: { card: Record<string, unknown> };
        };
        delete charge.payment_method_details.card.capture_before;
        return intent;
      },
    });
    expect(result).toEqual({
      kind: "blocked",
      reason:
        "Full manual card authorization and provider capture expiry required",
    });
  });

  test("a charge that disagrees with the intent blocks", async () => {
    for (const patch of [
      { livemode: true },
      { payment_intent: "pi_someoneelse" },
      { customer: "cus_someoneelse" },
      { amount: 1199 },
      { currency: "eur" },
    ]) {
      const { result } = await observe({
        intent: () => {
          const intent = authorizedIntent();
          Object.assign(
            intent.latest_charge as unknown as Record<string, unknown>,
            patch,
          );
          return intent;
        },
      });
      expect(result).toEqual({
        kind: "blocked",
        reason: "Stripe charge does not match immutable test binding",
      });
    }
  });

  test("an unexpanded charge string is refused rather than trusted", async () => {
    const { result } = await observe({
      intent: () =>
        ({
          ...authorizedIntent(),
          latest_charge: "ch_testfixture",
        }) as unknown as Stripe.PaymentIntent,
    });
    expect(result).toEqual({
      kind: "blocked",
      reason: "Expanded charge required",
    });
  });

  test("the receipt fingerprint binds the provider facts it was computed from", async () => {
    // observedAt is part of the receipt, so two observations never share a
    // fingerprint. What must hold is that any change to the bound provider
    // facts changes it too, so a replayed receipt cannot be reused.
    const base = await observe({ intent: () => authorizedIntent() });
    const otherCharge = await observe({
      intent: () => {
        const intent = authorizedIntent();
        (intent as unknown as Record<string, unknown>).latest_charge = {
          ...(intent.latest_charge as unknown as Record<string, unknown>),
          id: "ch_a_different_charge",
        };
        return intent;
      },
    });
    if (
      base.result.kind !== "observed" ||
      otherCharge.result.kind !== "observed"
    )
      throw new Error("expected observations");
    expect(base.result.authorization.providerReceiptFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      otherCharge.result.authorization.providerReceiptFingerprint,
    ).not.toBe(base.result.authorization.providerReceiptFingerprint);
  });
});
