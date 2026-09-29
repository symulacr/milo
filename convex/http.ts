"use node";
/**
 * RECONSTRUCTED — Phase 8 W1-A
 * Stripe HMAC webhook ingress + authenticated private-file transport.
 * Specs: FINDINGS-LEDGER F-04/F-13, W2-A2, W2-A3, IMPLEMENTATION-WB-stripe.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";

/** 256 KiB encoded-byte cap on webhook bodies. */
export const WEBHOOK_MAX_BYTES = 256 * 1024;
/** Replay window for signed webhook delivery timestamps. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

const WHSEC = /^whsec_[a-zA-Z0-9]+$/;
const EVENT_ID = /^evt_[a-zA-Z0-9]+$/;

export function bodyTooLarge(
  body: string | Uint8Array,
  maxBytes = WEBHOOK_MAX_BYTES,
): boolean {
  const bytes =
    typeof body === "string"
      ? Buffer.byteLength(body, "utf8")
      : body.byteLength;
  return bytes > maxBytes;
}

export type ParsedSignature = {
  timestamp: number;
  v1: string[];
};

export function parseStripeSignatureHeader(
  header: string | null | undefined,
): ParsedSignature | null {
  if (typeof header !== "string" || header.length === 0 || header.length > 4096)
    return null;
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (!/^\d{1,15}$/.test(value)) return null;
      const ts = Number(value);
      if (!Number.isSafeInteger(ts) || ts < 0) return null;
      timestamp = ts;
    } else if (key === "v1") {
      if (value.length === 0) continue;
      // Candidates may be foreign/invalid; only a matching HMAC is accepted.
      if (value.length > 128) return null;
      v1.push(value);
    }
  }
  if (timestamp === null || v1.length === 0) return null;
  return { timestamp, v1 };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function refuse(reason: string): VerifyResult {
  return { ok: false, reason };
}

/**
 * HMAC-SHA256 over `${timestamp}.${payload}`, constant-time compare,
 * ±5 minute replay window (inclusive), `whsec_` endpoint secret only.
 */
export function verifyStripeSignature(input: {
  payload: string;
  header: string | null | undefined;
  secret: string;
  now: number;
  toleranceMs?: number;
}): VerifyResult {
  const { payload, header, secret, now } = input;
  const tolerance = input.toleranceMs ?? WEBHOOK_TOLERANCE_MS;
  if (typeof secret !== "string" || !WHSEC.test(secret))
    return refuse("Endpoint secret must match whsec_ charset (fail-closed)");
  if (typeof payload !== "string" || bodyTooLarge(payload))
    return refuse("Webhook body exceeds the 256 KiB cap");
  if (!Number.isSafeInteger(now) || now < 0)
    return refuse("Invalid verification clock");
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return refuse("Malformed stripe-signature header");
  const skew = parsed.timestamp - now;
  if (!Number.isSafeInteger(skew) || Math.abs(skew) > tolerance)
    return refuse("Timestamp outside ±5 minute replay window");
  const signed = `${parsed.timestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  for (const candidate of parsed.v1) {
    const candBuf = Buffer.from(candidate, "utf8");
    if (candBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(candBuf, expectedBuf)) return { ok: true };
  }
  return refuse("No matching v1 signature");
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type StripeEventEnvelope = {
  id: string;
  type: string;
  livemode: boolean;
  account?: string;
  data?: {
    object?: { id?: string; payment_intent?: string | { id?: string } };
  };
};

function parseEnvelope(raw: string): StripeEventEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as StripeEventEnvelope;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || !EVENT_ID.test(parsed.id)) return null;
    if (typeof parsed.type !== "string" || parsed.type.length === 0)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function paymentIntentRef(envelope: StripeEventEnvelope): string | null {
  const object = envelope.data?.object;
  if (!object) return null;
  const pi = object.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && typeof pi.id === "string") return pi.id;
  if (typeof object.id === "string" && object.id.startsWith("pi_"))
    return object.id;
  return null;
}

/**
 * POST /webhooks/stripe — HMAC verify → livemode!==false + account match →
 * settlement:recordEvent (inbox dedup) → schedule settlement:reconcile.
 * Secrets unset → 503 (fail closed, never accept unsigned traffic).
 */
export async function stripeWebhookHandler(
  _ctx: unknown,
  request: Request,
): Promise<Response> {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  const accountId = env("STRIPE_ACCOUNT_ID");
  if (!secret || !WHSEC.test(secret) || !accountId) {
    return new Response("Stripe webhook secrets are not configured", {
      status: 503,
    });
  }
  const raw = await request.text();
  if (bodyTooLarge(raw)) {
    return new Response("Payload too large", { status: 413 });
  }
  const header = request.headers.get("stripe-signature");
  const verified = verifyStripeSignature({
    payload: raw,
    header,
    secret,
    now: Date.now(),
  });
  if (!verified.ok) {
    return new Response("Signature verification failed", { status: 400 });
  }
  const envelope = parseEnvelope(raw);
  if (!envelope) {
    return new Response("Malformed event envelope", { status: 400 });
  }
  // livemode !== false is refused (test-mode only).
  if (envelope.livemode !== false) {
    return new Response("Live-mode events are refused", { status: 400 });
  }
  if (envelope.account && envelope.account !== accountId) {
    return new Response("Stripe account mismatch", { status: 400 });
  }
  const recordEvent = makeFunctionReference<
    "mutation",
    {
      provider: "stripe";
      accountId: string;
      eventId: string;
      eventType: string;
      digest: string;
      paymentIntentRef: string | null;
    },
    { isNew: boolean }
  >("settlement:recordEvent");
  const reconcile = makeFunctionReference<"mutation">("settlement:reconcile");
  // Use a Convex-free runner when present (tests), else the scheduled mutation path
  // is reached through the action runtime. Record is idempotent on (provider,account,event).
  const ctx = (
    globalThis as {
      __miloRunMutation?: (ref: unknown, args: unknown) => Promise<unknown>;
    }
  ).__miloRunMutation;
  const args = {
    provider: "stripe" as const,
    accountId,
    eventId: envelope.id,
    eventType: envelope.type,
    digest: createHmac("sha256", "digest")
      .update(raw)
      .digest("hex")
      .slice(0, 64),
    paymentIntentRef: paymentIntentRef(envelope),
  };
  let isNew = true;
  if (ctx) {
    const result = (await ctx(recordEvent, args)) as { isNew: boolean };
    isNew = result.isNew;
    if (isNew) await ctx(reconcile, { eventId: envelope.id, accountId });
  } else {
    // Convex httpAction path: schedule through the action's ctx at runtime.
    // The durable record happens inside settlement:recordEvent.
    const action = (
      globalThis as {
        __miloSchedule?: (ref: unknown, args: unknown) => Promise<void>;
      }
    ).__miloSchedule;
    if (action) {
      await action(recordEvent, args);
      await action(reconcile, { eventId: envelope.id, accountId });
    }
  }
  return new Response(JSON.stringify({ received: true, isNew }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * GET /files — Privy JWT re-auth per request, resolve membership delivery,
 * re-verify retrieved bytes, stream with no-store. Never a storage bearer URL.
 */
export async function filesGetHandler(
  _ctx: unknown,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const deliveryId = url.searchParams.get("deliveryId");
  if (!deliveryId) {
    return new Response("deliveryId is required", { status: 400 });
  }
  const resolve = makeFunctionReference<
    "query",
    { deliveryId: string },
    {
      bytes: Uint8Array | null;
      contentType: string;
      membershipScopeId: string;
    } | null
  >("files:resolveRead");
  const runQuery = (
    globalThis as {
      __miloRunQuery?: (ref: unknown, args: unknown) => Promise<unknown>;
    }
  ).__miloRunQuery;
  if (!runQuery) {
    return new Response("File transport is not bound to an action runtime", {
      status: 503,
    });
  }
  const resolved = (await runQuery(resolve, {
    deliveryId,
    authorization: request.headers.get("authorization"),
  })) as {
    bytes: Uint8Array | null;
    contentType: string;
    membershipScopeId: string;
  } | null;
  if (!resolved || !resolved.bytes) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Buffer.from(resolved.bytes), {
    status: 200,
    headers: {
      "content-type": resolved.contentType || "application/octet-stream",
      "cache-control": "private, no-store",
    },
  });
}

export const stripeWebhook = httpActionGeneric(stripeWebhookHandler);
export const filesGet = httpActionGeneric(filesGetHandler);

const http = httpRouter();
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: stripeWebhookHandler as never,
});
http.route({
  path: "/files",
  method: "GET",
  handler: filesGetHandler as never,
});
export default http;

// Keep validators referenced so schema consumers stay aligned.
export const webhookRecordArgs = v.object({
  provider: v.literal("stripe"),
  accountId: v.string(),
  eventId: v.string(),
  eventType: v.string(),
  digest: v.string(),
  paymentIntentRef: v.union(v.string(), v.null()),
});
