import type { AdmissionContext } from "../../../convex/admissionContext";
import type {
  FrozenQuote,
  PaymentAuthorization,
} from "../src/admission-policy";
import { PAYMENT_AUTHORIZATION_WINDOW_MS } from "../src/admission-policy";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../src/public-constructor.ts";

type Row = Record<string, unknown>;

/**
 * Shared preprod quote fixture for the backend admission and monitoring
 * suites. Defaults are the common shape; each suite overrides what its
 * assertions actually distinguish (deadline values are load-bearing, see
 * admission-policy.test.ts). Fingerprints are recomputed after overrides so
 * commitment changes cannot desync them. The local-lane harness keeps its own
 * copy in scripts/convex-local-fixtures.ts because that harness copies only
 * convex/ and packages/backend/src.
 */
const HASH = "a".repeat(64);

const IMAGE_PACK_POLICY: {
  serviceVersion: number;
  packQuantity: number;
  outputCount: number;
  unitPriceMinor: number;
} = {
  serviceVersion: 1,
  packQuantity: 1,
  outputCount: 3,
  unitPriceMinor: 1200,
};

type QuoteFixture = FrozenQuote &
  Record<string, unknown> & {
    imagePackPolicy: typeof IMAGE_PACK_POLICY;
    expiresAt?: number;
  };

export function buildQuote(
  overrides: Record<string, unknown> = {},
): QuoteFixture {
  const now = Date.now();
  const defaults = {
    constructorVersion: 1 as const,
    constructorEncoding: CONSTRUCTOR_ENCODING,
    buyerCommitment: "1".repeat(64),
    merchantCommitment: "2".repeat(64),
    operatorCommitment: "3".repeat(64),
    id: "quote-1",
    scopeId: "scope-1",
    network: "preprod",
    nonce: "4".repeat(64),
    version: 1,
    amountMinor: 36000,
    currency: "USD",
    buyerAccountId: "buyer-1",
    termsCommitment: HASH,
    artifactFingerprint: HASH,
    keySetFingerprint: HASH,
    rolesFingerprint: HASH,
    initialStateFingerprint: HASH,
    genesisHash: HASH,
    acceptanceDeadlineSeconds: Math.floor(now / 1000) + 600,
    deliveryDeadlineSeconds: Math.floor(now / 1000) + 1200,
    reviewDeadlineSeconds: Math.floor(now / 1000) + 1800,
    resolutionDeadlineSeconds: Math.floor(now / 1000) + 2400,
    // fresh copy per call: suites mutate the policy on their own quote
    imagePackPolicy: { ...IMAGE_PACK_POLICY },
  };
  // Overrides may replace commitments; the derived fingerprints are recomputed
  // afterwards. The cast is honest: overrides are dynamic test data.
  const quote = { ...defaults, ...overrides } as typeof defaults &
    Record<string, unknown>;
  Object.assign(quote, publicConstructorFingerprints(quote));
  return quote as unknown as QuoteFixture;
}

/**
 * A provider hold observed now: usable for the 60 s admission window and
 * capturable for seven days, which is what makes the two rules distinguishable.
 */
export function buildAuthorization(
  overrides: Partial<PaymentAuthorization> = {},
): PaymentAuthorization {
  const now = Date.now();
  return {
    id: "auth-1",
    quoteId: "quote-1",
    quoteVersion: 1,
    buyerAccountId: "buyer-1",
    amountMinor: 36000,
    currency: "USD",
    usableFrom: now,
    usableUntil: now + PAYMENT_AUTHORIZATION_WINDOW_MS,
    captureBeforeMs: now + 7 * 24 * 60 * 60_000,
    source: "payment-observer",
    status: "authorized",
    providerReceiptFingerprint: "b".repeat(64),
    ...overrides,
  };
}

/** A validator's JSON descriptor, as `exportReturns()` serialises it. */
type Desc = { type: string; value?: unknown };

const H64 = (c: string) => c.repeat(64);

/**
 * A valid `writeQuoteDraft` / `createQuote` argument set. Three suites built
 * the same twenty lines by hand; the only variation is the scope and the odd
 * override, so those are the parameters.
 */
export const quoteArgs = (
  scopeId: string,
  overrides: Record<string, unknown> = {},
) => ({
  scopeId,
  title: "Three hero images",
  brief: "A short brief for the fixed-price image pack.",
  amountUsd: 900,
  clientEmail: "client@example.com",
  orderNonce: H64("a"),
  merchantCommitment: H64("b"),
  termsCommitment: H64("d"),
  terms: {
    unitPrice: "90000",
    total: "90000",
    scopeDigest: H64("e"),
    rightsDigest: H64("f"),
    paymentPolicy: H64("1"),
    salt: H64("2"),
  },
  ...overrides,
});

/** The `_handler` behind a registered Convex function. */
export const handlerOf = <A = Row, R = unknown, C = AdmissionContext>(
  fn: unknown,
) => (fn as { _handler: (ctx: C, args: A) => Promise<R> })._handler;

/**
 * Walk a validator's JSON descriptor. `strict` is the whole difference between
 * checking arguments and checking returns: an argument the function declares but
 * the caller omitted is a bug, while a return field the validator declares but
 * the handler omitted is Convex's business, not the test's.
 */
function walkDescriptor(
  d: Desc,
  v: unknown,
  at: string,
  strict: boolean,
): void {
  const walk = (n: Desc, x: unknown, at: string): void => {
    if (n.type === "union") {
      const errs: string[] = [];
      for (const b of n.value as Desc[])
        try {
          walk(b, x, at);
          return;
        } catch (e) {
          errs.push(String(e));
        }
      throw new Error(`${at}: no union branch (${errs.join("; ")})`);
    }
    if (n.type === "array") {
      if (Array.isArray(x))
        x.forEach((i, k) => {
          walk(n.value as Desc, i, `${at}[${k}]`);
        });
      return;
    }
    if (n.type !== "object") return;
    if (typeof x !== "object" || x === null) {
      if (strict) throw new Error(`${at}: expected an object`);
      return;
    }
    const f = n.value as Record<
      string,
      { fieldType: Desc; optional?: boolean }
    >;
    for (const [k, inner] of Object.entries(x)) {
      if (!(k in f))
        throw new Error(
          `${at}: Object contains extra field ${k} that is not in the validator`,
        );
      walk(f[k].fieldType, inner, `${at}.${k}`);
    }
    if (!strict) return;
    for (const [k, spec] of Object.entries(f))
      if (!spec.optional && !(k in (x as object)))
        throw new Error(`${at}: required field ${k} is missing`);
  };
  walk(d, v, at);
}

/**
 * Reject any key a handler returned that its own `returns` validator does not
 * declare. `handlerOf(...)` calls `_handler` directly, so unit tests bypass the
 * return validator: that is how `createQuote` shipped returning
 * `{...draft, emailed}` — a superset of `quoteReturns` — and failed live with
 * `ReturnsValidationError: Object contains extra field inviteToken`. tsc cannot
 * see it, because a spread adds keys at runtime. `exportReturns()` is the
 * function's own descriptor, so this walks the real validator.
 */
export function checkReturns(fn: unknown, v: unknown, at = "$"): void {
  walkDescriptor(
    JSON.parse((fn as { exportReturns: () => string }).exportReturns()) as Desc,
    v,
    at,
    false,
  );
}

/**
 * The mirror for arguments: reject a field the function never reads, and a
 * required field the caller forgot. A form that sends `{amount}` where the
 * server takes `{amountUsd}` fails live with an ArgumentValidationError that no
 * type-checker sees, because the browser builds the object at runtime. Called
 * before every handler in the web harness, so the form and the server agree by
 * construction rather than by review.
 */
export function checkArgs(fn: unknown, v: unknown, at = "$"): void {
  walkDescriptor(
    JSON.parse((fn as { exportArgs: () => string }).exportArgs()) as Desc,
    v,
    at,
    true,
  );
}
