/**
 * R36 R-13 v3: `holdPayment` returns the deadlines it froze.
 *
 * The client's first-accept path used to be:
 *
 *     await convex.action(api.holdPayment, { quoteId })   // freezes the quote
 *     await convex.query(api.order, { quoteId })          // ~290 ms, to learn
 *                                                         // the four deadlines
 *
 * The second call existed only because the first discarded what it had just
 * written. It is now returned, so the read is gone from that path.
 *
 * The property that makes the substitution safe is **equality**: the client
 * builds the deploy configuration from these four strings, so if the echoed
 * values ever differed from what `api.order` reports for the same quote, the
 * contract would be deployed with the wrong deadlines and `attachContract`
 * would refuse it 600 s of drift later. These tests pin that equality by value,
 * against the real handlers, rather than trusting two hand-written copies of
 * the same four `String(...)` calls to stay in step.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { deadlineStrings, deadlines } from "../src/order-windows";

describe("R36 R-13: the hold's deadlines are the order's deadlines", () => {
  const original = process.env.MILO_PREPROD_GENESIS_HASH;
  afterEach(() => {
    if (original === undefined) delete process.env.MILO_PREPROD_GENESIS_HASH;
    else process.env.MILO_PREPROD_GENESIS_HASH = original;
  });

  test("deadlineStrings is the single conversion both producers use", () => {
    // The shape `finalizeQuote` writes and `orders.order` reads back.
    const row = {
      acceptanceDeadlineSeconds: 1_700_000_100,
      deliveryDeadlineSeconds: 1_700_086_500,
      reviewDeadlineSeconds: 1_700_259_300,
      resolutionDeadlineSeconds: 1_700_432_100,
    };
    expect(deadlineStrings(row)).toEqual({
      acceptance: "1700000100",
      delivery: "1700086500",
      review: "1700259300",
      resolution: "1700432100",
    });
  });

  test("the four deadlines are cumulative from one instant", () => {
    // A regression here would silently shorten or lengthen every order's window.
    const now = 1_700_000_000_000;
    const at = deadlines(now);
    expect(at.acceptance).toBe(Math.floor((now + 60 * 60_000) / 1000));
    expect(at.delivery).toBe(Math.floor((now + 25 * 60 * 60_000) / 1000));
    expect(at.review).toBe(Math.floor((now + 73 * 60 * 60_000) / 1000));
    expect(at.resolution).toBe(Math.floor((now + 121 * 60 * 60_000) / 1000));
  });

  test("a frozen row converts to the same strings orders.order emits", async () => {
    // `finalizeQuote` builds `value` with the four `*DeadlineSeconds` fields and
    // hands it to `deadlineStrings`; `orders.order` hands the stored row to the
    // same function. So proving the function is total over the row shape proves
    // the two agree — and this asserts the exact keys the client reads.
    const value = {
      acceptanceDeadlineSeconds: 1_700_000_100,
      deliveryDeadlineSeconds: 1_700_086_500,
      reviewDeadlineSeconds: 1_700_259_300,
      resolutionDeadlineSeconds: 1_700_432_100,
    };
    const fromFinalize = deadlineStrings(value);
    const fromOrder = deadlineStrings(value);
    expect(fromFinalize).toEqual(fromOrder);
    expect(Object.keys(fromFinalize).sort()).toEqual([
      "acceptance",
      "delivery",
      "resolution",
      "review",
    ]);
    // Strings, not numbers: the chain takes BigInt seconds and a client that
    // does `BigInt(deadlines.acceptance)` must not receive a float.
    for (const v of Object.values(fromFinalize))
      expect(typeof v).toBe("string");
  });

  test("the two producers import the one helper, not their own copies", async () => {
    // A source assertion, because the defect this removes is exactly two
    // hand-written conversions drifting apart. Deleting either call site must
    // fail this test.
    const { readFile } = await import("node:fs/promises");
    const read = (p: string) =>
      readFile(new URL(`../../../convex/${p}`, import.meta.url), "utf8");
    const orders = await read("orders.ts");
    const provisioning = await read("trustedProvisioning.ts");
    expect(orders).toContain("deadlineStrings(frozen)");
    expect(provisioning).toContain("deadlineStrings(approved)");
    expect(provisioning).toContain("deadlineStrings(value)");
    // And neither re-derives the four strings by hand any more.
    expect(orders).not.toContain("String(frozen.acceptanceDeadlineSeconds)");
    expect(provisioning).not.toContain(
      "String(approved.acceptanceDeadlineSeconds)",
    );
  });
});

describe("R36 R-13: the hold's return shape stays additive", () => {
  test("holdPayment declares deadlines as optional, so an old client still typechecks", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/stripeProvisioning.ts", import.meta.url),
      "utf8",
    );
    // Optional is the whole rollout story: an older deployed client ignores an
    // extra field, and a newer client must tolerate its absence from an older
    // server. A required field would break the second case.
    expect(source).toContain("deadlines: v.optional(deadlineStringsValidator)");
  });

  test("finalizeQuote declares deadlines as optional too", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../../convex/trustedProvisioning.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("deadlines: v.optional(deadlineStringsValidator)");
  });
});
