/**
 * RECONSTRUCTED — Phase 8 W1-A
 * Stripe HMAC webhook ingress + authenticated private-file transport.
 * Specs: FINDINGS-LEDGER F-04/F-13, W2-A2, W2-A3, IMPLEMENTATION-WB-stripe.
 */
import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";

// HMAC-SHA256 via @noble/hashes (maintained). WebCrypto is preferred in
// verifyStripeSignatureAsync; the sync path exists for tests and non-async call
// sites. Convex default runtime allows pure-JS packages (no "use node").
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function byteLen(s: string | Uint8Array): number {
  return typeof s === "string" ? utf8Bytes(s).length : s.length;
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Constant-time hex compare (equal length, no early exit). */
function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = hexToBytes(aHex);
  const b = hexToBytes(bHex);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256HexWeb(key: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) throw new Error("WebCrypto unavailable");
  const keyBytes = enc.encode(key);
  const cryptoKey = await cryptoObj.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await cryptoObj.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(payload) as unknown as ArrayBuffer,
  );
  return bytesToHex(new Uint8Array(sig));
}

function createHmacCompat(secret: string, payload: string): string {
  return bytesToHex(hmac(sha256, utf8Bytes(secret), utf8Bytes(payload)));
}

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
  const bytes = byteLen(body);
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

export async function verifyStripeSignatureAsync(input: {
  payload: string;
  header: string | null | undefined;
  secret: string;
  now: number;
  toleranceMs?: number;
}): Promise<VerifyResult> {
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
  const tsMs =
    parsed.timestamp < 1e12 ? parsed.timestamp * 1000 : parsed.timestamp;
  const nowMs = now < 1e12 ? now * 1000 : now;
  const skew = tsMs - nowMs;
  if (!Number.isSafeInteger(skew) || Math.abs(skew) > tolerance)
    return refuse("Timestamp outside ±5 minute replay window");
  const signed = `${parsed.timestamp}.${payload}`;
  const expected = await hmacSha256HexWeb(secret, signed);
  for (const candidate of parsed.v1) {
    if (timingSafeEqualHex(candidate, expected)) return { ok: true };
  }
  return refuse("No matching v1 signature");
}

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
  const tsMs =
    parsed.timestamp < 1e12 ? parsed.timestamp * 1000 : parsed.timestamp;
  const nowMs = now < 1e12 ? now * 1000 : now;
  const skew = tsMs - nowMs;
  if (!Number.isSafeInteger(skew) || Math.abs(skew) > tolerance)
    return refuse("Timestamp outside ±5 minute replay window");
  const signed = `${parsed.timestamp}.${payload}`;
  const expected = createHmacCompat(secret, signed);
  for (const candidate of parsed.v1) {
    if (timingSafeEqualHex(candidate, expected)) return { ok: true };
  }
  return refuse("No matching v1 signature");
}

function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  actionCtx: unknown,
  request: Request,
): Promise<Response> {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  const accountId = env("STRIPE_ACCOUNT_ID") ?? "test";
  if (!secret || !WHSEC.test(secret)) {
    return new Response("Stripe webhook secrets are not configured", {
      status: 503,
    });
  }
  const raw = await request.text();
  if (bodyTooLarge(raw)) {
    return new Response("Payload too large", { status: 413 });
  }
  const header = request.headers.get("stripe-signature");
  const verified = await verifyStripeSignatureAsync({
    payload: raw,
    header,
    secret,
    now: Date.now(),
  });
  if (!verified.ok) {
    return new Response(`Signature verification failed: ${verified.reason}`, {
      status: 400,
    });
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
  const runMutation =
    (
      actionCtx as {
        runMutation?: (ref: unknown, args: unknown) => Promise<unknown>;
      }
    )?.runMutation ??
    (
      globalThis as {
        __miloRunMutation?: (ref: unknown, args: unknown) => Promise<unknown>;
      }
    ).__miloRunMutation;
  const args = {
    provider: "stripe" as const,
    accountId,
    eventId: envelope.id,
    eventType: envelope.type,
    digest: createHmacCompat("digest", raw).slice(0, 64),
    paymentIntentRef: paymentIntentRef(envelope),
  };
  let isNew = true;
  if (runMutation) {
    const result = (await runMutation(recordEvent, args)) as { isNew: boolean };
    isNew = result.isNew;
    if (isNew)
      await runMutation(reconcile, { eventId: envelope.id, accountId });
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
  if (!resolved?.bytes) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(
    new Blob([new Uint8Array(resolved.bytes)] as BlobPart[]),
    {
      status: 200,
      headers: {
        "content-type": resolved.contentType || "application/octet-stream",
        "cache-control": "private, no-store",
      },
    },
  );
}

export const stripeWebhook = httpActionGeneric(stripeWebhookHandler);
export const filesGet = httpActionGeneric(filesGetHandler);

const http = httpRouter();
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: stripeWebhook,
});
http.route({
  path: "/files",
  method: "GET",
  handler: filesGet,
});
http.route({
  path: "/debug-hmac",
  method: "GET",
  handler: {
    isHttp: true,
    invokeHttpAction: async () => {
      const mac = await hmacSha256HexWeb(
        "Jefe",
        "what do ya want for nothing?",
      );
      return new Response(JSON.stringify({ mac }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    _handler: async () => new Response("ok"),
  } as never,
});
http.route({
  path: "/debug-verify",
  method: "POST",
  handler: httpActionGeneric(async (_ctx, request) => {
    const raw = await request.text();
    const header = request.headers.get("stripe-signature");
    const secret = env("STRIPE_WEBHOOK_SECRET") ?? "";
    const parsed = parseStripeSignatureHeader(header);
    let expected = "";
    if (parsed) {
      expected = await hmacSha256HexWeb(secret, `${parsed.timestamp}.${raw}`);
    }
    return new Response(
      JSON.stringify({
        rawLen: raw.length,
        parsedTs: parsed?.timestamp ?? null,
        candCount: parsed?.v1.length ?? 0,
        expectedLen: expected.length,
        secretLen: secret.length,
        expectedHead: expected.slice(0, 12),
        candHead: (parsed?.v1[0] ?? "").slice(0, 12),
        signedLen: parsed ? `${parsed.timestamp}.${raw}`.length : 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }),
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
