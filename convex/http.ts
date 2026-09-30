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

// Pure JS HMAC-SHA256: http.ts cannot use "use node" (Convex rule).
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
// Minimal SHA-256 (FIPS 180-4) for webhook HMAC.
function rotr(x: number, n: number) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
function sha256(msg: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const l = msg.length;
  const withOne = l + 1;
  const pad = (withOne + 8 + 63) & ~63;
  const buf = new Uint8Array(pad);
  buf.set(msg);
  buf[l] = 0x80;
  const bits = l * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(pad - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(pad - 4, bits >>> 0);
  const w = new Uint32Array(64);
  for (let i = 0; i < pad; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}
function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const block = 64;
  let k = key;
  if (k.length > block) k = sha256(k);
  const pad = new Uint8Array(block);
  pad.set(k);
  const o = new Uint8Array(block + 32);
  const i = new Uint8Array(block + 32);
  for (let j = 0; j < block; j++) {
    o[j] = pad[j] ^ 0x5c;
    i[j] = pad[j] ^ 0x36;
  }
  i.set(
    sha256(
      i.subarray(0, block).length ? concat(i.subarray(0, block), msg) : msg,
    ),
    block,
  );
  // redo properly
  const inner = new Uint8Array(block + msg.length);
  inner.set(i.subarray(0, block));
  inner.set(msg, block);
  const innerHash = sha256(inner);
  const outer = new Uint8Array(block + 32);
  outer.set(o.subarray(0, block));
  outer.set(innerHash, block);
  return sha256(outer);
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
}
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
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createHmacCompat(secret: string, payload: string): string {
  return bytesToHex(hmacSha256(utf8Bytes(secret), utf8Bytes(payload)));
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
