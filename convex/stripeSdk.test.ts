/**
 * The settlement action drives the real Stripe SDK. These tests inject a stub
 * `httpClient`, so capture, cancel, every failure class and the idempotency-key
 * header run through the SDK's own code instead of being asserted as source
 * text.
 */
import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../packages/backend/src/stripe-observer.server";
import { outcomeOf, providerIntent, run } from "./stripeSettlement";

type Reply = { status: number; body: unknown } | { network: true };

/** A Stripe HTTP client that records the request and replays one reply. */
function stub(reply: Reply) {
  const calls: {
    path: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  const httpClient = {
    getClientName: () => "milo-test",
    makeRequest: async (
      _h: string,
      _p: string,
      path: string,
      _m: string,
      headers: Record<string, string>,
      body: string,
    ) => {
      calls.push({ path, headers, body });
      if ("network" in reply) throw new Error("socket hang up");
      const { status, body: payload } = reply;
      return {
        getStatusCode: () => status,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toStream: () => null,
        toJSON: async () => payload,
      };
    },
  };
  const stripe = new Stripe("sk_test_fixture", {
    apiVersion: STRIPE_API_VERSION as never,
    maxNetworkRetries: 0,
    httpClient: httpClient as never,
  });
  return { stripe, calls };
}

const CAPTURED = { id: "pi_1", status: "succeeded", amount_received: 90_000 };

describe("settlement drives the real Stripe SDK", () => {
  test("capture sends the key as a header, never a body field", async () => {
    const { stripe, calls } = stub({ status: 200, body: CAPTURED });
    const intent = await stripe.paymentIntents.capture(
      "pi_1",
      {},
      { idempotencyKey: "milo-capture:order-1:7" },
    );
    expect(intent.status).toBe("succeeded");
    expect(intent.amount_received).toBe(90_000);
    expect(calls[0]?.path).toBe("/v1/payment_intents/pi_1/capture");
    // Stripe ignores a body parameter of that name, so a retry would be a
    // second capture.
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("milo-capture:order-1:7");
    expect(calls[0]?.body).not.toContain("idempotency_key");
  });

  test("cancel hits the cancel path with its own key", async () => {
    const { stripe, calls } = stub({
      status: 200,
      body: { ...CAPTURED, status: "canceled", amount_received: 0 },
    });
    const intent = await stripe.paymentIntents.cancel(
      "pi_1",
      {},
      { idempotencyKey: "milo-void:order-1:7" },
    );
    expect(intent.status).toBe("canceled");
    expect(calls[0]?.path).toBe("/v1/payment_intents/pi_1/cancel");
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("milo-void:order-1:7");
  });

  test("a network failure carries no status code", async () => {
    const { stripe } = stub({ network: true });
    const failure = stripe.paymentIntents.capture(
      "pi_1",
      {},
      {
        idempotencyKey: "k",
      },
    );
    await expect(failure).rejects.toMatchObject({ statusCode: undefined });
  });

  // Every status the mapping distinguishes, driven through the SDK.
  for (const [status, expected] of [
    [409, "ambiguous"],
    [425, "ambiguous"],
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [400, "failed"],
    [402, "failed"],
    [404, "failed"],
  ] as const) {
    test(`${status} reaches the action as "${expected}"`, async () => {
      const { stripe } = stub({
        status,
        body: { error: { type: "api_error", message: "provider" } },
      });
      const error = await stripe.paymentIntents
        .capture("pi_1", {}, { idempotencyKey: "k" })
        .catch((cause: unknown) => cause);
      expect(error).toMatchObject({ statusCode: status });
      expect(outcomeOf(error)).toBe(expected);
    });
  }
});

describe("the action registration and its outcome mapping", () => {
  test("is a scheduler-runnable action with a provider query", () => {
    expect((run as { isAction?: boolean }).isAction).toBe(true);
    expect(
      typeof providerIntent === "object" ||
        typeof providerIntent === "function",
    ).toBe(true);
  });

  test("its args fence settlement begin", () => {
    const args =
      (run as unknown as { exportArgs?: () => string }).exportArgs?.() ?? "";
    expect(args).toContain("opId");
    expect(args).toContain("generation");
    expect(args).toContain("attempt");
  });

  // A connection failure or timeout carries no status: the request may have
  // reached Stripe and taken effect, so it is ambiguous, never a clean retry.
  // The shared idempotency key makes the follow-up safe either way.
  test("a missing status is ambiguous, never a silent capture or a blind retry", () => {
    const withStatus = (statusCode?: number) =>
      Object.assign(new Error("provider"), { statusCode });
    expect(outcomeOf(withStatus())).toBe("ambiguous");
    expect(outcomeOf(new Error("socket hang up"))).toBe("ambiguous");
    expect(outcomeOf(null)).toBe("ambiguous");
    expect(outcomeOf("boom")).toBe("ambiguous");
    // A definite 4xx is still a clean failure, and a 5xx/429 still retries.
    expect(outcomeOf(withStatus(402))).toBe("failed");
    expect(outcomeOf(withStatus(503))).toBe("retry");
    expect(outcomeOf(withStatus(429))).toBe("retry");
    expect(outcomeOf(withStatus(409))).toBe("ambiguous");
  });

  // B-04: the only other place that can move money must refuse a live key,
  // exactly as `holdPayment` does. Before the fix the action called the
  // provider with whatever key was configured.
  test("a live key is refused before the provider is called", async () => {
    const real = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_fixture";
    const finished: Array<Record<string, unknown>> = [];
    let providerQueried = false;
    try {
      await (
        run as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<null>;
        }
      )._handler(
        {
          runMutation: async (_ref: unknown, args: unknown) => {
            // `finish` is the only mutation carrying an outcome.
            const a = args as Record<string, unknown>;
            if ("outcome" in a) finished.push(a);
            return null;
          },
          runQuery: async () => {
            providerQueried = true;
            return { stripePaymentIntentId: "pi_1" };
          },
        },
        { opId: "op_1", generation: 1, attempt: 0 },
      );
    } finally {
      if (real === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = real;
    }
    // It never reached the provider, and it recorded a definite failure.
    expect(providerQueried).toBe(false);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ outcome: "failed" });
  });
});
