import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { bytesToHex, hexToBytes } from "../packages/backend/src/encoding";

const ENCODER = new TextEncoder();
const utf8 = (s: string): Uint8Array => ENCODER.encode(s);
const byteLen = (s: string | Uint8Array): number =>
  typeof s === "string" ? utf8(s).length : s.length;

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = hexToBytes(aHex);
  const b = hexToBytes(bHex);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256HexWeb(key: string, payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto unavailable");
  const cryptoKey = await subtle.importKey(
    "raw",
    utf8(key) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign(
    "HMAC",
    cryptoKey,
    utf8(payload) as unknown as ArrayBuffer,
  );
  return bytesToHex(new Uint8Array(sig));
}

const createHmacCompat = (secret: string, payload: string): string =>
  bytesToHex(hmac(sha256, utf8(secret), utf8(payload)));

export const WEBHOOK_MAX_BYTES = 256 * 1024;
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

const WHSEC = /^whsec_[a-zA-Z0-9]+$/;
const EVENT_ID = /^evt_[a-zA-Z0-9]+$/;

export function bodyTooLarge(
  body: string | Uint8Array,
  maxBytes = WEBHOOK_MAX_BYTES,
): boolean {
  return byteLen(body) > maxBytes;
}

export type ParsedSignature = { timestamp: number; v1: string[] };

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
      if (value.length > 128) return null;
      v1.push(value);
    }
  }
  return timestamp === null || v1.length === 0 ? null : { timestamp, v1 };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const refuse = (reason: string): { ok: false; reason: string } => ({
  ok: false,
  reason,
});

type VerifyInput = {
  payload: string;
  header: string | null | undefined;
  secret: string;
  now: number;
  toleranceMs?: number;
};

type Prechecked =
  | { ok: false; reason: string }
  | { ok: true; signed: string; v1: string[] };

function precheck(input: VerifyInput): Prechecked {
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
  return { ok: true, signed: `${parsed.timestamp}.${payload}`, v1: parsed.v1 };
}

const matchAny = (v1: string[], expected: string): VerifyResult =>
  v1.some((candidate) => timingSafeEqualHex(candidate, expected))
    ? { ok: true }
    : refuse("No matching v1 signature");

export function verifyStripeSignature(input: VerifyInput): VerifyResult {
  const pre = precheck(input);
  return pre.ok
    ? matchAny(pre.v1, createHmacCompat(input.secret, pre.signed))
    : pre;
}

export async function verifyStripeSignatureAsync(
  input: VerifyInput,
): Promise<VerifyResult> {
  const pre = precheck(input);
  return pre.ok
    ? matchAny(pre.v1, await hmacSha256HexWeb(input.secret, pre.signed))
    : pre;
}

const env = (name: string): string | undefined => {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

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
  return typeof object.id === "string" && object.id.startsWith("pi_")
    ? object.id
    : null;
}

type RecordEventArgs = {
  provider: "stripe";
  accountId: string;
  eventId: string;
  eventType: string;
  digest: string;
  paymentIntentRef: string | null;
};

const RECORD_EVENT = makeFunctionReference<
  "mutation",
  RecordEventArgs,
  { isNew: boolean }
>("settlement:recordEvent");
const RECONCILE = makeFunctionReference<"mutation">("settlement:reconcile");

type Runner = (ref: unknown, args: unknown) => Promise<unknown>;

const textResponse = (body: string, status: number): Response =>
  new Response(body, { status });

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

export async function stripeWebhookHandler(
  actionCtx: unknown,
  request: Request,
): Promise<Response> {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  const accountId = env("STRIPE_ACCOUNT_ID") ?? "test";
  if (!secret || !WHSEC.test(secret))
    return textResponse("Stripe webhook secrets are not configured", 503);
  const raw = await request.text();
  if (bodyTooLarge(raw)) return textResponse("Payload too large", 413);
  const verified = await verifyStripeSignatureAsync({
    payload: raw,
    header: request.headers.get("stripe-signature"),
    secret,
    now: Date.now(),
  });
  if (!verified.ok)
    return textResponse(
      `Signature verification failed: ${verified.reason}`,
      400,
    );
  const envelope = parseEnvelope(raw);
  if (!envelope) return textResponse("Malformed event envelope", 400);
  if (envelope.livemode !== false)
    return textResponse("Live-mode events are refused", 400);
  if (envelope.account && envelope.account !== accountId)
    return textResponse("Stripe account mismatch", 400);
  const args: RecordEventArgs = {
    provider: "stripe",
    accountId,
    eventId: envelope.id,
    eventType: envelope.type,
    digest: createHmacCompat("digest", raw).slice(0, 64),
    paymentIntentRef: paymentIntentRef(envelope),
  };
  const reconcileArgs = {
    provider: "stripe",
    eventId: envelope.id,
    accountId,
  };
  const runMutation =
    (actionCtx as { runMutation?: Runner } | undefined)?.runMutation ??
    (globalThis as { __miloRunMutation?: Runner }).__miloRunMutation;
  const schedule = (globalThis as { __miloSchedule?: Runner }).__miloSchedule;
  let isNew = true;
  if (runMutation) {
    isNew = ((await runMutation(RECORD_EVENT, args)) as { isNew: boolean })
      .isNew;
    if (isNew) await runMutation(RECONCILE, reconcileArgs);
  } else if (schedule) {
    await schedule(RECORD_EVENT, args);
    await schedule(RECONCILE, reconcileArgs);
  }
  return jsonResponse({ received: true, isNew });
}

export const stripeWebhook = httpActionGeneric(stripeWebhookHandler);

const http = httpRouter();
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: stripeWebhook,
});
export default http;

export const webhookRecordArgs = v.object({
  provider: v.literal("stripe"),
  accountId: v.string(),
  eventId: v.string(),
  eventType: v.string(),
  digest: v.string(),
  paymentIntentRef: v.union(v.string(), v.null()),
});
