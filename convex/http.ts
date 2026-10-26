import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import {
  bytesToHex,
  env,
  timingSafeEqualHex,
} from "../packages/backend/src/encoding";
import { stripeMode } from "../packages/backend/src/stripe-mode";
import { authComponent, createAuth } from "./auth";

const ENCODER = new TextEncoder();
const utf8 = (s: string): Uint8Array => ENCODER.encode(s);
const byteLen = (s: string | Uint8Array): number =>
  typeof s === "string" ? utf8(s).length : s.length;

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

export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

/** Stripe's own secrets are ~32 chars; a shorter one is a hand-set mistake. */
const WHSEC = /^whsec_[a-zA-Z0-9]{16,}$/;
const EVENT_ID = /^evt_[a-zA-Z0-9]+$/;

/** Stripe caps a delivery at 256 KiB; anything larger is refused unread. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;
export const bodyTooLarge = (body: string | Uint8Array): boolean =>
  byteLen(body) > MAX_WEBHOOK_BYTES;

/**
 * A CSP report is a browser diagnostic, not data: a real one is a few hundred
 * bytes, so 64 KiB is generous. Refused from `content-length` before buffering.
 */
export const MAX_REPORT_BYTES = 64 * 1024;

/**
 * The two wire shapes, normalised to one list. A `report-to` endpoint gets
 * `application/reports+json` (an array of `{type, body, url}` envelopes); a
 * legacy `report-uri` endpoint gets `application/csp-report` (a single
 * `{"csp-report": {...}}` object). Browsers that support `report-to` ignore
 * `report-uri`, so both are sent and both are accepted. Anything else is refused.
 */
export function parseCspReports(
  contentType: string | null,
  raw: string,
): unknown[] | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/reports+json" && type !== "application/csp-report")
    return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return parsed && typeof parsed === "object" ? [parsed] : null;
  } catch {
    return null;
  }
}

/**
 * What an operator needs: which directive broke, on which document, from where.
 * Everything else (`script-sample`, `source-file`, the `document-uri` query
 * string) can carry personal data — an order URL holds a quote id and an invite
 * token — so both URLs are reduced to their origin and the rest is dropped.
 */
export function summariseCspReport(report: unknown): Record<string, string> {
  const envelope = (report ?? {}) as {
    type?: unknown;
    url?: unknown;
    body?: Record<string, unknown>;
    "csp-report"?: Record<string, unknown>;
  };
  // `reports+json` nests the payload in `body`, the legacy format in
  // `csp-report`, and a bare payload has neither.
  const body = (envelope.body ??
    envelope["csp-report"] ??
    report ??
    {}) as Record<string, unknown>;
  const text = (value: unknown): string =>
    typeof value === "string" ? value.slice(0, 200) : "";
  const origin = (value: unknown): string => {
    try {
      return new URL(text(value)).origin;
    } catch {
      return "";
    }
  };
  return {
    type: text(envelope.type) || "csp-violation",
    directive: text(body["effective-directive"] ?? body.effectiveDirective),
    blocked: origin(body["blocked-uri"] ?? body.blockedURL),
    document: origin(body["document-uri"] ?? body.documentURL ?? envelope.url),
  };
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

type Refusal = { ok: false; reason: string };

export type VerifyResult = { ok: true } | Refusal;

const refuse = (reason: string): Refusal => ({ ok: false, reason });

type VerifyInput = {
  payload: string;
  header: string | null | undefined;
  secret: string;
  now: number;
};

type Prechecked = Refusal | { ok: true; signed: string; v1: string[] };

function precheck(input: VerifyInput): Prechecked {
  const { payload, header, secret, now } = input;
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
  if (!Number.isSafeInteger(skew) || Math.abs(skew) > WEBHOOK_TOLERANCE_MS)
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

type StripeEventEnvelope = {
  id: string;
  type: string;
  livemode: boolean;
  account?: string;
  data?: {
    object?: {
      id?: string;
      payment_intent?: string | { id?: string };
      /**
       * Present on a `payment_intent.canceled` event, whose `data.object` is the
       * PaymentIntent itself. Stripe added `expired` in API `2025-03-31.basil`.
       */
      cancellation_reason?: string | null;
    };
  };
};

/**
 * The PaymentIntent events this deployment acts on, and the label each asserts.
 * An unlisted type is still recorded so a replay is deduped, but it moves no
 * label.
 *
 * `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` and
 * `charge.expired` are recorded so a refund, a chargeback, its outcome and a
 * lapsed hold are all visible in the diagnostics inbox instead of silently
 * turning the payment observation into `blocked`. They assert no order label:
 * the smallest honest handling is to surface them, not to invent a settlement
 * action, because money has already moved outside this code's control.
 *
 * `charge.dispute.closed` fires on `won`, `lost` and `warning_closed`, so a
 * dispute now reaches an outcome in Milo's records instead of staying open
 * forever. `charge.expired` is the uncaptured-charge counterpart of
 * `payment_intent.canceled` with `cancellation_reason: "expired"`.
 * (`payment_intent.expired` does not exist as a public event.)
 */
export const PAYMENT_EVENT_LABELS = {
  "payment_intent.amount_capturable_updated": "held",
  "payment_intent.succeeded": "captured",
  "payment_intent.canceled": "released",
  "payment_intent.payment_failed": "failed",
} as const;

/** Events that are recorded for operator visibility but move no order label. */
export const RECORDED_ONLY_EVENTS = [
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.expired",
] as const;

export type PaymentEventLabel =
  (typeof PAYMENT_EVENT_LABELS)[keyof typeof PAYMENT_EVENT_LABELS];

/**
 * The label an event type asserts, or null when the type moves no label.
 *
 * A cancellation is two different facts and Stripe distinguishes them for us:
 * `cancellation_reason: "expired"` means the authorization lapsed on its own
 * (nobody released anything — the money never moved), while `requested_by_
 * customer`/`abandoned`/`automatic` mean a deliberate void. Labelling an expiry
 * "released" told the operator the hold had been deliberately given back. The
 * `expired` case reuses the existing `failed` label rather than adding a new
 * one, so the order-page union and its web copy stay as they are.
 */
export const labelForEvent = (
  type: string,
  cancellationReason?: string | null,
): PaymentEventLabel | null => {
  if (type === "payment_intent.canceled" && cancellationReason === "expired")
    return "failed";
  return (
    (PAYMENT_EVENT_LABELS as Record<string, PaymentEventLabel>)[type] ?? null
  );
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
  cancellationReason?: string | null;
};

const RECORD_EVENT = makeFunctionReference<
  "mutation",
  RecordEventArgs,
  { isNew: boolean }
>("settlement:recordEvent");
const RECONCILE = makeFunctionReference<"mutation">("settlement:reconcile");

type Runner = (ref: unknown, args: unknown) => Promise<unknown>;

/**
 * A coded refusal. The status follows the code: a caller fault is 4xx and
 * Stripe must not retry it, while an unconfigured deployment or a real fault is
 * 5xx and Stripe will. The body is the same `{code, message}` shape as
 * `ConvexError`, so one client mapping covers both surfaces.
 */
const STATUS: Record<string, number> = {
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
};
const NO_STORE = { headers: { "cache-control": "no-store" } };
const codedRefusal = (code: string, message: string) =>
  Response.json(
    { code, message },
    { ...NO_STORE, status: STATUS[code] ?? 400 },
  );
export async function stripeWebhookHandler(
  actionCtx: unknown,
  request: Request,
): Promise<Response> {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  const accountId = env("STRIPE_ACCOUNT_ID");
  if (!secret || !WHSEC.test(secret))
    return codedRefusal("PROVIDER_UNAVAILABLE", "Webhook secret unconfigured");
  // Fail closed on a missing account id: the per-account inbox identity is what
  // keeps two accounts' events apart, so a placeholder would weaken dedupe.
  if (!accountId)
    return codedRefusal("PROVIDER_UNAVAILABLE", "Stripe account unconfigured");
  // Refuse an oversized body before buffering it. The cap is enforced from the
  // declared length, with the post-read check as the backstop.
  const raw = await readCapped(request, MAX_WEBHOOK_BYTES);
  if (raw === null)
    return codedRefusal("PAYLOAD_TOO_LARGE", "Payload too large");
  const verified = await verifyStripeSignatureAsync({
    payload: raw,
    header: request.headers.get("stripe-signature"),
    secret,
    now: Date.now(),
  });
  if (!verified.ok)
    return codedRefusal(
      "UNAUTHENTICATED",
      `Signature failed: ${verified.reason}`,
    );
  const envelope = parseEnvelope(raw);
  if (!envelope)
    return codedRefusal("INVALID_INPUT", "Malformed event envelope");
  let mode: "test" | "live";
  try {
    mode = stripeMode(env("STRIPE_SECRET_KEY"));
  } catch {
    return codedRefusal("PROVIDER_UNAVAILABLE", "Stripe mode unconfigured");
  }
  if (envelope.livemode !== (mode === "live"))
    return codedRefusal("WRONG_STATE", "Event mode does not match the key");
  if (envelope.account && envelope.account !== accountId)
    return codedRefusal("FORBIDDEN", "Stripe account mismatch");
  const args: RecordEventArgs = {
    provider: "stripe",
    accountId,
    eventId: envelope.id,
    eventType: envelope.type,
    // Keyed with the endpoint secret, not a public literal: this field is named
    // `digest` and stored for audit, so it should not be recomputable by anyone
    // who merely has the body.
    digest: createHmacCompat(secret, raw).slice(0, 64),
    paymentIntentRef: paymentIntentRef(envelope),
    // Read from the event so an expiry is distinguishable from a void after the
    // request is gone. Absent for every other type, so the row stays clean.
    cancellationReason: envelope.data?.object?.cancellation_reason ?? undefined,
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
  try {
    if (runMutation) {
      const recorded = (await runMutation(RECORD_EVENT, args)) as {
        isNew: boolean;
        digestMatches?: boolean;
      };
      isNew = recorded.isNew;
      // A known event id carrying a different body is not a duplicate. Refuse
      // it so the disagreement is visible instead of silently discarded.
      if (recorded.digestMatches === false)
        return codedRefusal(
          "WRONG_STATE",
          "Event id replayed with a different payload",
        );
      // Always reconcile, not only on a new row: a delivery whose record
      // committed but whose reconcile did not leaves the row unprocessed, and
      // Stripe's retry must finish that work. `reconcile` is itself a no-op for
      // a row that is already processed.
      await runMutation(RECONCILE, reconcileArgs);
    } else if (schedule) {
      await schedule(RECORD_EVENT, args);
      await schedule(RECONCILE, reconcileArgs);
    }
  } catch {
    // Our fault, not the caller's: 5xx so Stripe retries the delivery. A
    // replay is still 200 because the inbox dedupes on the event id.
    return codedRefusal("PROVIDER_UNAVAILABLE", "Retry: not recorded");
  }
  return Response.json({ received: true, isNew }, NO_STORE);
}

export const stripeWebhook = httpActionGeneric(stripeWebhookHandler);

/**
 * Read a request body under a byte cap. The declared length is checked first so
 * an oversized post never allocates; the post-read check is the backstop for a
 * lying or absent `Content-Length`. Both public routes need exactly this.
 */
async function readCapped(
  request: Request,
  cap: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isSafeInteger(declared) && declared > cap) return null;
  const raw = await request.text();
  return byteLen(raw) > cap ? null : raw;
}

/**
 * The CSP report receiver, so `Content-Security-Policy-Report-Only` stops being
 * a header that collects nothing.
 *
 * **Log only, no table.** A report's `script-sample` and `document-uri` can
 * carry personal data — an order URL holds a quote id and an invite token — so
 * persisting them would create a PII store with no retention policy and no
 * deletion path. Convex's log retention applies instead, and the operator still
 * gets the signal from the four fields `summariseCspReport` keeps.
 *
 * Unauthenticated by design (a browser posts it, with no session), so it is
 * bounded twice before parsing: the size cap and the content-type gate.
 */
export async function cspReportHandler(
  _ctx: unknown,
  request: Request,
): Promise<Response> {
  const raw = await readCapped(request, MAX_REPORT_BYTES);
  if (raw === null)
    return codedRefusal("PAYLOAD_TOO_LARGE", "Report too large");
  const reports = parseCspReports(request.headers.get("content-type"), raw);
  if (!reports) return codedRefusal("INVALID_INPUT", "Not a CSP report");
  // Bounded: one page can emit a burst, and a log line per report is the point,
  // not a log flood.
  for (const report of reports.slice(0, 20))
    console.warn("csp-report", JSON.stringify(summariseCspReport(report)));
  // 204: the browser ignores the body, and a body would be one more thing to
  // keep free of the data this handler refuses to store.
  return new Response(null, { status: 204, headers: NO_STORE.headers });
}

export const cspReport = httpActionGeneric(cspReportHandler);

const http = httpRouter();
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: stripeWebhook,
});
// W3: put this exact path in `vercel.json` as both `Reporting-Endpoints`
// (`csp-endpoint="https://<deployment>.convex.site/csp-report"`) and the CSP's
// `report-to csp-endpoint` / `report-uri https://<deployment>.convex.site/csp-report`.
http.route({
  path: "/csp-report",
  method: "POST",
  handler: cspReport,
});
// `cors: true` lets the auth component answer preflights, but it does not
// choose the allowlist: that is `trustedOrigins` in `auth.ts`, which reads
// SITE_URL through `required()`. A missing origin therefore fails closed at
// sign-in rather than silently widening CORS to a default, which is the coupling
// AUDIT15 A-17 flagged.
authComponent.registerRoutes(http, createAuth, { cors: true });
export default http;
