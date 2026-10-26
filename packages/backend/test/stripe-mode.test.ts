import { describe, expect, test } from "bun:test";
import { stripeMode } from "../src/stripe-mode";

describe("Stripe payment mode derives from the configured secret key", () => {
  test("live keys select live mode", () => {
    for (const key of [
      "sk_live_abc123",
      "rk_live_abc123",
      "sk_live_ABCdef0123456789",
    ])
      expect(stripeMode(key)).toBe("live");
  });

  test("test keys select test mode", () => {
    for (const key of ["sk_test_abc123", "rk_test_abc123"]) {
      expect(stripeMode(key)).toBe("test");
    }
  });

  test("missing, publishable, restricted-prefix and malformed keys throw", () => {
    for (const key of [
      undefined,
      "",
      "sk_",
      "sk_live_",
      "sk_test_",
      "pk_live_abc123",
      "pk_test_abc123",
      "sk_abc123",
      "whsec_abc123",
      "sk_live_abc-123",
      "sk_live_abc 123",
      " sk_live_abc123",
      "sk_live_abc123 ",
      "SK_LIVE_ABC123",
    ])
      expect(() => stripeMode(key)).toThrow();
  });

  test("the thrown message never contains the supplied key", () => {
    const key = "sk_unknown_do_not_echo";
    expect(() => stripeMode(key)).toThrow(/must be an sk_live_/);
    try {
      stripeMode(key);
    } catch (error) {
      expect((error as Error).message).not.toContain(key);
    }
  });
});
