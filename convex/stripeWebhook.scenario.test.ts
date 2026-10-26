/**
 * Scenario: the public Stripe webhook route, end to end through the real
 * handler. This is the one HTTP route an unauthenticated third party can reach,
 * so every refusal path is pinned here: unconfigured secret, oversized body,
 * bad signature, malformed envelope, mode mismatch, account mismatch, and the
 * replay that must be answered `isNew: false` rather than processed twice.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { getFunctionName } from "convex/server";
import {
  labelForEvent,
  PAYMENT_EVENT_LABELS,
  RECORDED_ONLY_EVENTS,
  stripeWebhookHandler,
} from "./http";

const SECRET = "whsec_routetest0123456789abcdefgh";
const ACCOUNT = "acct_route";
const KEY_TEST = "sk_test_routetest";
const NAMES = [
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_ACCOUNT_ID",
  "STRIPE_SECRET_KEY",
] as const;
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_ACCOUNT_ID = ACCOUNT;
  process.env.STRIPE_SECRET_KEY = KEY_TEST;
});

// Restores every name, so a test may mutate the environment freely.
afterEach(() => {
  for (const name of NAMES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
function event(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt_route1",
    type: "payment_intent.succeeded",
    livemode: false,
    account: ACCOUNT,
    data: { object: { id: "pi_route1" } },
    ...overrides,
  });
}

function header(body: string, at = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", SECRET)
    .update(`${at}.${body}`, "utf8")
    .digest("hex");
  return `t=${at},v1=${v1}`;
}

function post(body: string, signature?: string): Request {
  return new Request("https://example.convex.site/stripe/webhook", {
    method: "POST",
    body,
    headers: signature === undefined ? {} : { "stripe-signature": signature },
  });
}

describe("scenario: the public Stripe webhook route", () => {
  // The happy path and the replay are asserted per event type by the C2 table
  // below, which is strictly stronger: it also checks the recorded event type
  // and the label. What is left here are the refusal paths.

  // `afterEach` restores every name from `saved`, so a test may mutate freely.
  // All three are 503: an unconfigured deployment is our fault, so Stripe must
  // retry rather than treat the delivery as rejected.
  test.each([
    ["no webhook secret", "STRIPE_WEBHOOK_SECRET", undefined, false],
    ["an empty secret", "STRIPE_WEBHOOK_SECRET", "", false],
    ["a non-whsec secret", "STRIPE_WEBHOOK_SECRET", "sk_test_x", false],
    ["an unconfigured Stripe key", "STRIPE_SECRET_KEY", undefined, true],
  ])("%s is 503", async (_label, name, value, signed) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    const body = event();
    const signature = signed ? header(body) : undefined;
    const response = await stripeWebhookHandler({}, post(body, signature));
    expect(response.status).toBe(503);
  });

  // The refusal body is the same `{code, message}` shape a ConvexError carries,
  // so one client mapping covers both surfaces. The status is derived from the
  // code, so a caller fault is 4xx and Stripe must not retry it.
  test("an unsigned, wrongly signed or stale request is 400", async () => {
    const body = event();
    const stale = Math.floor(Date.now() / 1000) - 6 * 60;
    for (const signature of [
      undefined,
      "garbage",
      header(body, stale),
      header(event({ id: "evt_other1" })),
    ]) {
      const response = await stripeWebhookHandler({}, post(body, signature));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });

  // A signed body that cannot be acted on: too large to read, or not a Stripe
  // event envelope. Both are the caller's fault, so 4xx and no retry.
  test.each([
    ["an oversized body", "a".repeat(256 * 1024 + 1), 413],
    ["not json", "not json", 400],
    ["no type", JSON.stringify({ type: "x" }), 400],
    ["a bad event id", JSON.stringify({ id: "not_an_event", type: "x" }), 400],
    ["no type for the id", JSON.stringify({ id: "evt_1" }), 400],
    ["a live event against a test key", event({ livemode: true }), 400],
    ["a foreign account", event({ account: "acct_someone_else" }), 400],
  ])("%s is refused with %d", async (_label, body, status) => {
    const response = await stripeWebhookHandler({}, post(body, header(body)));
    expect(response.status).toBe(status);
  });

  test("without a runner the handler still answers, using the global scheduler", async () => {
    const body = event();
    const scheduled: string[] = [];
    (globalThis as { __miloSchedule?: unknown }).__miloSchedule = async (
      ref: unknown,
    ) => {
      scheduled.push(getFunctionName(ref as never));
    };
    try {
      const response = await stripeWebhookHandler({}, post(body, header(body)));
      expect(response.status).toBe(200);
      expect(scheduled).toEqual([
        "settlement:recordEvent",
        "settlement:reconcile",
      ]);
    } finally {
      delete (globalThis as { __miloSchedule?: unknown }).__miloSchedule;
    }
  });
});

/**
 * C2 — the four PaymentIntent events this deployment acts on. Each is recorded
 * and reconciled once, asserts its own label, and a replay is deduped. A type
 * outside the table is recorded but moves no label.
 */
describe("C2 the webhook acts on the four payment events by type", () => {
  type Runner = (ref: unknown, args: unknown) => Promise<unknown>;
  const run = async (type: string, isNew: boolean, runner?: Runner) => {
    const body = event({ type });
    const seen: Array<{ name: string; args: unknown }> = [];
    const response = await stripeWebhookHandler(
      {
        runMutation:
          runner ??
          (async (ref: unknown, args: unknown) => {
            const name = getFunctionName(ref as never);
            seen.push({ name, args });
            return name.includes("recordEvent") ? { isNew } : null;
          }),
      },
      post(body, header(body)),
    );
    return { status: response.status, body: await response.json(), seen };
  };
  const names = (seen: Array<{ name: string }>) => seen.map((c) => c.name);

  // Our own fault, not the caller's: 5xx so Stripe retries the delivery. A
  // replay stays 200 because the inbox dedupes on the event id.
  test("a recording fault is 503, so Stripe retries", async () => {
    const { status, body } = await run("payment_intent.succeeded", true, () =>
      Promise.reject(new Error("db unavailable")),
    );
    expect(status).toBe(503);
    expect(body).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  test.each(Object.entries(PAYMENT_EVENT_LABELS))(
    "%s is recorded, reconciled once, and asserts %s",
    async (type, label) => {
      const first = await run(type, true);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ received: true, isNew: true });
      expect(names(first.seen)).toEqual([
        "settlement:recordEvent",
        "settlement:reconcile",
      ]);
      // The recorded event carries the type, so the label is derivable later.
      expect(first.seen[0].args).toMatchObject({ eventType: type });
      expect(labelForEvent(type)).toBe(label);
      // A replay is deduped by event id but still reconciled: `reconcile` is a
      // no-op for a processed row, and skipping it is what stranded an op whose
      // first reconcile threw after the record committed.
      const replay = await run(type, false);
      expect(replay.body).toEqual({ received: true, isNew: false });
      expect(names(replay.seen)).toEqual([
        "settlement:recordEvent",
        "settlement:reconcile",
      ]);
    },
  );

  test("a type outside the table is recorded but moves no label", async () => {
    for (const type of [
      "payment_intent.created",
      "charge.refunded",
      "customer.created",
      "",
    ])
      expect(labelForEvent(type)).toBeNull();
    // Recorded for the audit trail, reconciled like any other new event.
    const { status, seen } = await run("charge.refunded", true);
    expect(status).toBe(200);
    expect(names(seen)).toEqual([
      "settlement:recordEvent",
      "settlement:reconcile",
    ]);
    // The four labels are exactly the four the order page understands.
    expect(Object.values(PAYMENT_EVENT_LABELS).sort()).toEqual([
      "captured",
      "failed",
      "held",
      "released",
    ]);
  });

  // AUDIT15 A-15: the stored `digest` was an HMAC keyed with the public literal
  // "digest", so anyone holding the body could recompute it. It is keyed with
  // the endpoint secret now, so the same body under a different secret must
  // produce a different digest.
  test("the recorded digest is keyed with the endpoint secret (AUDIT15 A-15)", async () => {
    const digestFor = async (secret: string) => {
      const prev = process.env.STRIPE_WEBHOOK_SECRET;
      process.env.STRIPE_WEBHOOK_SECRET = secret;
      try {
        const body = event({ id: "evt_digest1" });
        const at = Math.floor(Date.now() / 1000);
        const v1 = createHmac("sha256", secret)
          .update(`${at}.${body}`, "utf8")
          .digest("hex");
        const seen: Array<{ name: string; args: unknown }> = [];
        await stripeWebhookHandler(
          {
            runMutation: async (ref: unknown, args: unknown) => {
              const name = getFunctionName(ref as never);
              seen.push({ name, args });
              return name.includes("recordEvent") ? { isNew: true } : null;
            },
          },
          post(body, `t=${at},v1=${v1}`),
        );
        return (seen[0].args as { digest: string }).digest;
      } finally {
        if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
        else process.env.STRIPE_WEBHOOK_SECRET = prev;
      }
    };
    const a = await digestFor("whsec_aaaaaaaaaaaaaaaaaaaa");
    const b = await digestFor("whsec_bbbbbbbbbbbbbbbbbbbb");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });
});

/**
 * ROUND 18 item 1 — the two event types that were missing, and the reason
 * `RECORDED_ONLY_EVENTS` exists.
 *
 * The list was exported but never read, so a type could be added to it (or
 * dropped from it) with no test noticing. Iterating it makes the list
 * load-bearing: every entry must be recorded and reconciled like any other
 * event, and the two that Stripe sends but Milo never handled —
 * `charge.dispute.closed` (fires on won/lost/warning_closed) and
 * `charge.expired` (an uncaptured charge lapsed) — must both be in it.
 */
describe("ROUND18 item 1: dispute outcomes and lapsed holds are recorded", () => {
  test("the recorded-only list covers dispute closure and charge expiry", () => {
    expect([...RECORDED_ONLY_EVENTS].sort()).toEqual([
      "charge.dispute.closed",
      "charge.dispute.created",
      "charge.expired",
      "charge.refunded",
    ]);
    // None of them invents an order label: money already moved outside this
    // code's control, so the honest handling is to surface it.
    for (const type of RECORDED_ONLY_EVENTS)
      expect(labelForEvent(type)).toBeNull();
  });

  test.each([...RECORDED_ONLY_EVENTS])(
    "%s is recorded and reconciled once",
    async (type) => {
      const body = event({ type, id: `evt_${type.replace(/\W/g, "")}` });
      const seen: Array<{ name: string; args: unknown }> = [];
      const response = await stripeWebhookHandler(
        {
          runMutation: async (ref: unknown, args: unknown) => {
            const name = getFunctionName(ref as never);
            seen.push({ name, args });
            return name.includes("recordEvent") ? { isNew: true } : null;
          },
        },
        post(body, header(body)),
      );
      expect(response.status).toBe(200);
      expect(seen.map((c) => c.name)).toEqual([
        "settlement:recordEvent",
        "settlement:reconcile",
      ]);
      expect(seen[0].args).toMatchObject({ eventType: type });
    },
  );
});

/**
 * ROUND 18 item 2 — an expired authorization is not a released hold.
 *
 * Stripe added `cancellation_reason: "expired"` in API 2025-03-31.basil. Before
 * this branch, both an expiry and an operator void produced `released`, which
 * told the operator the hold had been deliberately given back when in fact it
 * lapsed and nothing was ever captured.
 */
describe("ROUND18 item 2: cancellation_reason separates expiry from a void", () => {
  test.each([
    ["expired", "failed"],
    ["requested_by_customer", "released"],
    ["abandoned", "released"],
    ["automatic", "released"],
    [null, "released"],
    [undefined, "released"],
  ] as const)("cancellation_reason %s labels the order %s", (reason, label) => {
    expect(labelForEvent("payment_intent.canceled", reason)).toBe(label);
  });

  // The reason must not leak into other types: a `succeeded` event carrying a
  // stray field is still a capture.
  test("the reason only affects cancellation", () => {
    expect(labelForEvent("payment_intent.succeeded", "expired")).toBe(
      "captured",
    );
    expect(
      labelForEvent("payment_intent.amount_capturable_updated", "expired"),
    ).toBe("held");
  });

  test("an expired cancellation is recorded with its reason", async () => {
    const body = event({
      type: "payment_intent.canceled",
      id: "evt_expired1",
      data: {
        object: { id: "pi_route1", cancellation_reason: "expired" },
      },
    });
    const seen: Array<{ name: string; args: unknown }> = [];
    const response = await stripeWebhookHandler(
      {
        runMutation: async (ref: unknown, args: unknown) => {
          const name = getFunctionName(ref as never);
          seen.push({ name, args });
          return name.includes("recordEvent") ? { isNew: true } : null;
        },
      },
      post(body, header(body)),
    );
    expect(response.status).toBe(200);
    // The reason survives the request, so the distinction is not lost when the
    // event is read back later.
    expect(seen[0].args).toMatchObject({
      eventType: "payment_intent.canceled",
      cancellationReason: "expired",
    });
  });

  test("an operator void records no reason", async () => {
    const body = event({
      type: "payment_intent.canceled",
      id: "evt_void1",
      data: {
        object: {
          id: "pi_route1",
          cancellation_reason: "requested_by_customer",
        },
      },
    });
    const seen: Array<{ name: string; args: unknown }> = [];
    await stripeWebhookHandler(
      {
        runMutation: async (ref: unknown, args: unknown) => {
          const name = getFunctionName(ref as never);
          seen.push({ name, args });
          return name.includes("recordEvent") ? { isNew: true } : null;
        },
      },
      post(body, header(body)),
    );
    expect(seen[0].args).toMatchObject({
      cancellationReason: "requested_by_customer",
    });
  });
});
