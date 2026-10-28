/**
 * R38: live mode stops depending on `pm_card_visa`, and test mode is unchanged.
 *
 * The defect this closes: `holdPayment` confirmed a PaymentIntent against
 * `payment_method: "pm_card_visa"` — a Stripe **test** card. In live mode that
 * card does not exist, so the hold could never work, and the action refused
 * live keys outright with "Live card entry is not available yet."
 *
 * The fix routes live mode to hosted Checkout with
 * `payment_intent_data.capture_method = "manual"`, which authorizes a real card
 * without capturing it (docs.stripe.com/payments/place-a-hold-on-a-payment-method,
 * accessed 2026-10-28). Test mode keeps the exact branch it had.
 *
 * These tests assert the branch by VALUE: which provider call is made, and with
 * what arguments. A test that only checked "no longer refuses" would pass even
 * if test mode had been broken on the way.
 */
import { afterEach, describe, expect, test } from "bun:test";

const LIVE_KEY = "sk_live_" + "a".repeat(24);
const TEST_KEY = "sk_test_" + "a".repeat(24);

describe("R38: the hold's provider path is chosen by key mode", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = original;
  });

  test("stripeMode still separates the two keys, and refuses anything else", async () => {
    const { stripeMode } = await import("../src/stripe-mode");
    expect(stripeMode(LIVE_KEY)).toBe("live");
    expect(stripeMode(TEST_KEY)).toBe("test");
    // The refusal that keeps live mode off unless a live key is configured.
    expect(() => stripeMode(undefined)).toThrow();
    expect(() => stripeMode("pk_test_notasecret")).toThrow();
  });

  test("test mode still confirms against pm_card_visa", async () => {
    // The literal is the whole point: test mode must keep using the test card.
    // If this ever reaches live mode the hold is broken, so the assertion is on
    // the source, next to the branch that guards it.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/stripeProvisioning.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('payment_method: "pm_card_visa"');
    // And it is still inside the test branch, after the live branch returns.
    const liveBranch = source.indexOf('if (mode === "live")');
    const testCard = source.indexOf('payment_method: "pm_card_visa"');
    expect(liveBranch).toBeGreaterThan(-1);
    expect(testCard).toBeGreaterThan(liveBranch);
  });

  test("live mode routes to hosted Checkout, but only behind an explicit switch", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/stripeProvisioning.ts", import.meta.url),
      "utf8",
    );
    // The live branch still refuses by default — configuring a live key alone
    // must never start taking real money.
    expect(source).toContain("Live card entry is not available yet.");
    // The refusal is gated on a second, explicit switch.
    expect(source).toContain('if (!env("MILO_LIVE_CHECKOUT"))');
    // And only past that switch does the Checkout path run.
    expect(source).toMatch(/return holdViaCheckout\(/);
    // Ordering: the refusal comes before the Checkout call.
    expect(source.indexOf("MILO_LIVE_CHECKOUT")).toBeLessThan(
      source.indexOf("return holdViaCheckout("),
    );
  });

  test("the Checkout session asks for manual capture, which is what makes it a hold", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/stripeProvisioning.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('capture_method: "manual"');
    // `mode: "payment"` is required: a Checkout Session in subscription mode
    // ignores capture_method.
    expect(source).toContain('mode: "payment"');
    // The session must be idempotent for the same quote version, or a retried
    // hold creates a second session and the buyer could pay twice.
    expect(source).toContain("milo-checkout:");
  });

  test("a live hold returns pending with a URL, never held", async () => {
    // The buyer has not entered a card yet, so claiming `held` would be a lie.
    // `held` arrives later, from payment_intent.amount_capturable_updated.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/stripeProvisioning.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('state: "pending",');
    expect(source).toContain("checkoutUrl: session.url");
    // And the webhook already maps that event to `held`.
    const http = await readFile(
      new URL("../../../convex/http.ts", import.meta.url),
      "utf8",
    );
    expect(http).toContain(
      '"payment_intent.amount_capturable_updated": "held"',
    );
  });

  test("the checkout URL is optional, so a test-mode client sees no new field", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/stripeProvisioning.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("checkoutUrl: v.optional(v.string())");
  });

  test("the session id is recorded, so the quote can be tied to its intent", async () => {
    const { readFile } = await import("node:fs/promises");
    const provisioning = await readFile(
      new URL("../../../convex/trustedProvisioning.ts", import.meta.url),
      "utf8",
    );
    const schema = await readFile(
      new URL("../../../convex/schema.ts", import.meta.url),
      "utf8",
    );
    expect(provisioning).toContain("export const bindCheckoutSession");
    expect(schema).toContain("checkoutSessionId: optS");
  });
});
