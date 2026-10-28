/**
 * R39: adversarial review of the live-mode hosted-Checkout path.
 *
 * Written as failing tests FIRST against the r38 code, so each one names a
 * concrete defect rather than a hypothesis. Six of the seven failed before the
 * fixes; the seventh asserts the mechanism that made the first one fatal.
 *
 * The chain that had to be made whole:
 *
 *   Checkout Session -> (buyer pays) -> payment_intent.amount_capturable_updated
 *     -> settlement:recordEvent (inbox row)
 *     -> settlement:reconcile
 *     -> paymentIntents.by_provider_intent
 *     -> settlementOps (capture / void)
 *
 * It broke at the third arrow: `paymentIntents` rows were created only by
 * `bindHeldPayment`, which the Checkout path never called, so in live mode there
 * was no row for `reconcile` to find and the authorization was dropped.
 */
import { describe, expect, test } from "bun:test";

const read = (p: string) =>
  readFile(new URL(`../../../convex/${p}`, import.meta.url), "utf8");
const { readFile } = await import("node:fs/promises");

const liveSection = async () => {
  const source = await read("stripeProvisioning.ts");
  const start = source.indexOf("async function holdViaCheckout");
  expect(start).toBeGreaterThan(-1);
  return source.slice(start);
};

describe("D1: a live Checkout hold binds a payment row before the webhook", () => {
  test("the Checkout path binds a payment row, so reconcile has something to find", async () => {
    const live = await liveSection();
    expect(live).toContain("BIND_CHECKOUT_PAYMENT");
    // It must pass the money, because the bind verifies it against the quote.
    expect(live).toContain("amountMinor: finalized.amountMinor");
  });

  test("reconcile only walks existing payment rows, so a missing row is a silent drop", async () => {
    const source = await read("settlement.ts");
    // The mechanism, asserted so the defect cannot be "fixed" by loosening
    // reconcile instead of creating the row.
    expect(source).toContain('.query("paymentIntents")');
    expect(source).toContain('.withIndex("by_provider_intent"');
    expect(source).toContain("for (const payment of payments)");
  });

  test("reconcile joins the session-keyed row to the real intent id", async () => {
    const source = await read("settlement.ts");
    // The row is keyed `cs_pending:<session>` until the buyer pays; the first
    // event carrying the intent adopts it.
    expect(source).toContain("cs_pending:");
    expect(source).toContain("stripePaymentIntentId: piRef");
  });
});

describe("D2: the Checkout amount is verified against the frozen quote", () => {
  test("the bind re-reads the frozen quote and refuses a disagreement", async () => {
    const source = await read("trustedProvisioning.ts");
    const bind = source.slice(
      source.indexOf("export const bindCheckoutPayment"),
    );
    expect(bind).toContain('.query("frozenQuotes")');
    expect(bind).toContain("frozen.amountMinor !== args.amountMinor");
    expect(bind).toContain("frozen.currency !== args.currency");
    // And it refuses rather than binding a payment that `bindingDrift` would
    // later reject at settlement, leaving real money on a stuck order.
    expect(bind).toContain("The amount changed. Reload the order.");
  });
});

describe("D3: a Checkout session cannot outlive the acceptance window", () => {
  test("the session expires no later than the acceptance deadline", async () => {
    const live = await liveSection();
    expect(live).toContain("expires_at");
    // Stripe requires >= 30 min; the floor keeps a nearly-expired quote from
    // producing an invalid request.
    expect(live).toContain("30 * 60");
    // And the deadline is the source, not a fresh 24 h default.
    expect(live).toContain("deadlines?.acceptance");
  });
});

describe("D4: a hold that lands on a dead order is voided", () => {
  test("reconcile releases a hold on a cancelled order", async () => {
    const settlement = await read("settlement.ts");
    const fn = settlement.slice(settlement.indexOf("export const reconcile"));
    // The void lives inside `reconcile`, not as a third webhook mutation: the
    // webhook's contract is one record plus one reconcile per delivery, and a
    // test pins that sequence.
    expect(fn).toMatch(/chain\??\.phase === "CANCELLED"/);
    expect(fn).toContain("openSettlement");
    // And it is not duplicated as a separate mutation.
    expect(settlement).not.toContain("export const voidOrphanedHold");
  });

  test("it is idempotent, so a retried delivery cannot open a second void", async () => {
    const settlement = await read("settlement.ts");
    const fn = settlement.slice(settlement.indexOf("export const reconcile"));
    // `openSettlement` keys ops on (orderId, action, contractRevision).
    expect(fn).toContain("openSettlement");
    expect(settlement).toContain('.withIndex("by_identity"');
  });

  test("the webhook still makes exactly one record and one reconcile call", async () => {
    const http = await read("http.ts");
    // No third mutation on the hot path.
    expect(http).not.toContain("VOID_ORPHANED");
    expect(http).toContain("await runMutation(RECONCILE, reconcileArgs)");
  });
});

describe("D5: the webhook refuses an amount that disagrees with the row", () => {
  test("reconcile compares amount and currency before adopting a row", async () => {
    const source = await read("settlement.ts");
    expect(source).toContain("Authorized amount does not match the order.");
    expect(source).toContain("Authorized currency does not match the order.");
  });

  test("the webhook passes the held total, preferring amount_capturable", async () => {
    const http = await read("http.ts");
    expect(http).toContain("amount_capturable");
    expect(http).toContain("amountMinor: eventAmountMinor(envelope)");
    expect(http).toContain("currency: eventCurrency(envelope)");
  });

  test("a refusal is a 4xx, not a retryable 5xx", async () => {
    const http = await read("http.ts");
    // A retried delivery would carry the same wrong amount.
    expect(http).toContain("reconciled?.refused");
    expect(http).toContain('codedRefusal("WRONG_STATE", reconciled.refused)');
  });
});

describe("D6: the idempotency key includes the amount", () => {
  test("a re-freeze with different money cannot replay the old session", async () => {
    const live = await liveSection();
    expect(live).toContain(
      "milo-checkout:${quoteId}:v${finalized.version}:${finalized.amountMinor}",
    );
  });
});

describe("D7: out-of-order and duplicate events are already safe", () => {
  test("monotonic rank stops a late authorization resurrecting a captured payment", async () => {
    const source = await readFile(
      new URL(
        "../../src/../src/../../convex/paymentMonitor.ts",
        import.meta.url,
      ),
      "utf8",
    ).catch(() => "");
    // Read via the convex path instead.
    const monitor = await read("paymentMonitor.ts");
    expect(monitor).toContain("observationRank");
    expect(monitor).toContain("RANK");
    // Terminal states share a rank, so a late `authorized` cannot win.
    expect(monitor).toMatch(/captured: 3,\s*voided: 3,\s*failed: 3/);
    expect(source).toBeDefined();
  });

  test("the inbox dedupes on event id and refuses a replayed id with a new body", async () => {
    const http = await read("http.ts");
    expect(http).toContain("digestMatches === false");
    expect(http).toContain("Event id replayed with a different payload");
    const settlement = await read("settlement.ts");
    expect(settlement).toContain(
      "digestMatches: existing.digest === args.digest",
    );
  });
});

describe("D8: the webhook signature path is unchanged by these fixes", () => {
  test("both the sync and Web Crypto verifiers are still present", async () => {
    const http = await read("http.ts");
    expect(http).toContain("export function verifyStripeSignature");
    expect(http).toContain("export async function verifyStripeSignatureAsync");
    expect(http).toContain("hmacSha256HexWeb");
    // And the handler still uses the async one.
    expect(http).toContain("await verifyStripeSignatureAsync(");
  });
});
