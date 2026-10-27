import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { HEX64, timingSafeEqualHex } from "../src/encoding";
import {
  requireLiveSubject,
  requireSessionSubject,
} from "../src/session-identity";
import type { StripeMode } from "../src/stripe-mode";
import {
  normalizeTestPayment,
  stripeClient,
  type TestPaymentBinding,
} from "../src/stripe-observer.server";

// AUDIT15 A-01: no privy.io fallback, so declare the issuer under test.
process.env.CONVEX_SITE_URL ??= "privy.io";

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

const normalize = (
  intent: Stripe.PaymentIntent,
  b: TestPaymentBinding,
  at: number,
  mode: StripeMode = "test",
) => normalizeTestPayment(intent, b, at, mode);

describe("Stripe server observation normalization", () => {
  test("matching non-USD intent and immutable binding fail the fixed protocol policy", () => {
    const intent = fixture();
    intent.currency = "eur";
    expect(normalize(intent, { ...binding, currency: "EUR" }, now).kind).toBe(
      "blocked",
    );
  });
  test("uses provider capture expiry and bounds observation freshness", () => {
    const result = normalize(fixture(), binding, now);
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
    expect(result.authorization.providerReceiptFingerprint).toMatch(HEX64);
  });

  test("never derives expiry from intent metadata or creation time", () => {
    const intent = fixture();
    const charge = intent.latest_charge as Stripe.Charge;
    if (charge.payment_method_details?.card)
      delete charge.payment_method_details.card.capture_before;
    intent.metadata = { capture_before: String(now / 1000 + 99999) };
    expect(normalize(intent, binding, now).kind).toBe("blocked");
  });

  test("expiry boundary cannot authorize", () => {
    const result = normalize(fixture(), binding, now + 600_000);
    expect(result.kind === "observed" && result.authorization.status).toBe(
      "failed",
    );
  });

  test("freshness never extends beyond a nearly expired provider hold", () => {
    const result = normalize(fixture(), binding, now + 590_000);
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
      expect(normalize(intent, binding, now).kind).toBe("blocked");
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
      expect(normalize(intent, binding, now).kind).toBe("blocked");
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
      expect(normalize(intent, binding, now).kind).toBe("blocked");
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
      const result = normalize(intent, binding, now);
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
    const result = normalize(intent, binding, now);
    expect(result.kind === "observed" && result.authorization.status).toBe(
      "captured",
    );
    charge.amount_refunded = 1;
    expect(normalize(intent, binding, now).kind).toBe("blocked");
  });

  test("rejects live bindings and invalid clocks", () => {
    expect(
      normalize(
        fixture(),
        { ...binding, environment: "live" } as unknown as TestPaymentBinding,
        now,
      ).kind,
    ).toBe("blocked");
    expect(normalize(fixture(), binding, Number.NaN).kind).toBe("blocked");
    expect(normalize(fixture(), binding, Number.MAX_SAFE_INTEGER).kind).toBe(
      "blocked",
    );
    expect(
      normalize(
        fixture(),
        { ...binding, network: "mainnet" } as unknown as TestPaymentBinding,
        now,
      ).kind,
    ).toBe("blocked");
  });

  test("live mode accepts only live intents and charges", () => {
    const live = fixture();
    live.livemode = true;
    (live.latest_charge as Stripe.Charge).livemode = true;
    const result = normalize(live, binding, now, "live");
    expect(result.kind).toBe("observed");
    if (result.kind !== "observed") throw new Error("missing observation");
    expect(result.authorization.status).toBe("authorized");
  });

  test("configured mode rejects a provider object from the other mode", () => {
    const live = fixture();
    live.livemode = true;
    (live.latest_charge as Stripe.Charge).livemode = true;
    expect(normalize(live, binding, now, "test").kind).toBe("blocked");
    expect(normalize(fixture(), binding, now, "live").kind).toBe("blocked");
  });

  test("live mode still rejects a live intent carrying a test charge", () => {
    const live = fixture();
    live.livemode = true;
    expect(normalize(live, binding, now, "live").kind).toBe("blocked");
  });

  test("the Stripe client refuses every key that does not name a mode", () => {
    for (const key of [undefined, "", "pk_live_x", "sk_unknown_x"])
      expect(() => stripeClient(key)).toThrow();
    expect(stripeClient("sk_test_fixture")).toBeInstanceOf(Object);
    expect(stripeClient("sk_live_fixture")).toBeInstanceOf(Object);
  });
});

describe("Privy identity boundary", () => {
  test("accepts the subject of a Convex-validated Privy identity", () => {
    expect(
      requireSessionSubject({ issuer: "privy.io", subject: "did:privy:user1" }),
    ).toBe("did:privy:user1");
  });
  test("rejects missing identity, another issuer and malformed subject", () => {
    for (const identity of [
      null,
      { issuer: "another", subject: "did:privy:user1" },
      { issuer: "privy.io", subject: "user1" },
    ]) {
      expect(() => requireSessionSubject(identity)).toThrow(
        "Authenticated session required",
      );
    }
  });

  // AUDIT15 A-01/A-02: an unset or empty origin must refuse every session
  // rather than fall back to the issuer of a provider this codebase no longer
  // uses. Previously `issuerFor()` returned "privy.io" and a legacy token was
  // accepted.
  test("an unconfigured deployment refuses every session", () => {
    const site = process.env.CONVEX_SITE_URL;
    const auth = process.env.BETTER_AUTH_URL;
    delete process.env.CONVEX_SITE_URL;
    delete process.env.BETTER_AUTH_URL;
    try {
      for (const identity of [
        { issuer: "privy.io", subject: "did:privy:attacker123" },
        { issuer: "urn:milo:auth-unconfigured", subject: "a".repeat(16) },
        { issuer: "", subject: "a".repeat(16) },
      ]) {
        expect(() => requireSessionSubject(identity)).toThrow(
          "Authenticated session required",
        );
      }
    } finally {
      if (site !== undefined) process.env.CONVEX_SITE_URL = site;
      if (auth !== undefined) process.env.BETTER_AUTH_URL = auth;
    }
  });

  // AUDIT15 A-02: `??` does not skip an empty string, so an empty origin used
  // to be treated as configured and an empty issuer was accepted.
  test("an empty origin is treated as unconfigured", () => {
    const site = process.env.CONVEX_SITE_URL;
    process.env.CONVEX_SITE_URL = "";
    try {
      expect(() =>
        requireSessionSubject({ issuer: "", subject: "a".repeat(16) }),
      ).toThrow("Authenticated session required");
    } finally {
      if (site === undefined) delete process.env.CONVEX_SITE_URL;
      else process.env.CONVEX_SITE_URL = site;
    }
  });
});

// R24 I-07: `requireSessionSubject` reads only the JWT; `requireLiveSubject`
// adds the session-row check the caller supplies, which is the read `auth.me`
// already pays on every page load.
describe("R24 I-07: requireLiveSubject refuses a revoked session", () => {
  const identity = { issuer: "privy.io", subject: "did:privy:buyer" };
  const ctxFor = (id: unknown) =>
    ({ auth: { getUserIdentity: async () => id } }) as never;

  test("a live session passes and returns the subject", async () => {
    await expect(
      requireLiveSubject(ctxFor(identity), async () => ({ id: "user-1" })),
    ).resolves.toBe("did:privy:buyer");
  });

  test("a revoked session is refused even with a well-formed JWT", async () => {
    // The whole finding: the token is valid, the session row is gone.
    await expect(
      requireLiveSubject(ctxFor(identity), async () => null),
    ).rejects.toThrow("Authenticated session required");
  });

  test("a bad issuer is refused before the session lookup runs", async () => {
    let looked = false;
    await expect(
      requireLiveSubject(ctxFor({ ...identity, issuer: "evil" }), async () => {
        looked = true;
        return { id: "user-1" };
      }),
    ).rejects.toThrow("Authenticated session required");
    // The cheap check runs first, so a forged token costs no database read.
    expect(looked).toBe(false);
  });

  test("the sync gate is unchanged, so opting in is per call site", () => {
    expect(requireSessionSubject(identity)).toBe("did:privy:buyer");
  });
});

/**
 * R24 I-07, the part that actually closes the finding: Convex checks the JWT's
 * signature and `exp`, never the session row, so the revocation window is
 * exactly the JWT lifetime. The plugin's default is 15 minutes; this asserts
 * the shipped config bounds it to 5. It reads the source because `createAuth`
 * validates env and throws on whatever another test file left behind.
 */
describe("R24 I-07: the revocation window is the JWT lifetime", () => {
  test("createAuth bounds the Convex JWT to 5 minutes", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/auth.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("jwt: { expirationSeconds: 60 * 5 }");
    // The deprecated spelling would be silently ignored by the plugin.
    expect(source).not.toContain("jwtExpirationSeconds");
  });
});

// AUDIT15 A-13: the invite token is a bearer secret, so it is compared in
// constant time. A plain `!==` has the same *result*, so the only honest test is
// that the shared helper is correct and that both invite paths use it.
describe("constant-time invite token compare", () => {
  test("the helper matches only equal hex, and never throws on junk", () => {
    const a = "a".repeat(64);
    expect(timingSafeEqualHex(a, a)).toBe(true);
    expect(timingSafeEqualHex(a, "b".repeat(64))).toBe(false);
    expect(timingSafeEqualHex(a, "a".repeat(63))).toBe(false);
    expect(timingSafeEqualHex(a, "zz")).toBe(false);
    expect(timingSafeEqualHex("zz", a)).toBe(false);
  });

  test("both invite paths use it instead of a raw comparison", async () => {
    for (const f of [
      "../../../convex/orders.ts",
      "../../../convex/trustedProvisioning.ts",
    ]) {
      const src = await Bun.file(new URL(f, import.meta.url).pathname).text();
      expect(src).toContain(
        "timingSafeEqualHex(draft.inviteToken, args.token)",
      );
      expect(src).not.toContain("draft.inviteToken !== args.token");
      expect(src).not.toContain("draft.inviteToken === args.token");
    }
  });
});
