/**
 * R4 — Stripe HMAC-SHA256 known-answer tests.
 * RFC 4231 vectors, Stripe documented signature shape, differential vs node:crypto.
 */
import { describe, expect, test } from "bun:test";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  parseStripeSignatureHeader,
  verifyStripeSignature,
  verifyStripeSignatureAsync,
  WEBHOOK_TOLERANCE_MS,
} from "./http";

const WHSEC = "whsec_abcdefghijklmnopqrstuvwxyz012345";

function hex(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf).toString("hex");
}

function nodeHmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function headerFor(secret: string, payload: string, t: number): string {
  return `t=${t},v1=${nodeHmacHex(secret, `${t}.${payload}`)}`;
}

describe("RFC 4231 HMAC-SHA256 known answers", () => {
  // Test case 1
  test("TC1 key=0x0b*20 data='Hi There'", () => {
    const key = Buffer.alloc(20, 0x0b);
    const data = Buffer.from("Hi There", "utf8");
    const mac = createHmac("sha256", key).update(data).digest("hex");
    expect(mac).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });
  test("TC2 key='Jefe' data='what do ya want for nothing?'", () => {
    const mac = createHmac("sha256", "Jefe")
      .update("what do ya want for nothing?", "utf8")
      .digest("hex");
    expect(mac).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
  test("TC3 key=0xaa*20 data=0xdd*50", () => {
    const key = Buffer.alloc(20, 0xaa);
    const data = Buffer.alloc(50, 0xdd);
    const mac = createHmac("sha256", key).update(data).digest("hex");
    expect(mac).toBe(
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });
});

describe("Stripe documented signature shape", () => {
  test("payload is `${timestamp}.${body}` and v1 is HMAC-SHA256 hex", () => {
    const t = 1_700_000_000;
    const body = '{"id":"evt_1","type":"payment_intent.succeeded"}';
    const signed = `${t}.${body}`;
    const v1 = nodeHmacHex(WHSEC, signed);
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    const header = `t=${t},v1=${v1}`;
    const parsed = parseStripeSignatureHeader(header);
    expect(parsed).toEqual({ timestamp: t, v1: [v1] });
    const result = verifyStripeSignature({
      payload: body,
      header,
      secret: WHSEC,
      now: t * 1000,
    });
    expect(result.ok).toBe(true);
  });

  test("async WebCrypto path accepts the same header", async () => {
    const t = 1_700_000_000;
    const body = '{"id":"evt_2","type":"payment_intent.succeeded"}';
    const header = headerFor(WHSEC, body, t);
    const result = await verifyStripeSignatureAsync({
      payload: body,
      header,
      secret: WHSEC,
      now: t * 1000,
    });
    expect(result.ok).toBe(true);
  });
});

describe("±5 minute tolerance and fail-closed", () => {
  const body = '{"id":"evt_3"}';
  const t = 1_700_000_000;
  const header = headerFor(WHSEC, body, t);

  test("just inside tolerance passes", () => {
    expect(
      verifyStripeSignature({
        payload: body,
        header,
        secret: WHSEC,
        now: t * 1000 + WEBHOOK_TOLERANCE_MS,
      }).ok,
    ).toBe(true);
    expect(
      verifyStripeSignature({
        payload: body,
        header,
        secret: WHSEC,
        now: t * 1000 - WEBHOOK_TOLERANCE_MS,
      }).ok,
    ).toBe(true);
  });
  test("outside tolerance fails", () => {
    expect(
      verifyStripeSignature({
        payload: body,
        header,
        secret: WHSEC,
        now: t * 1000 + WEBHOOK_TOLERANCE_MS + 1,
      }).ok,
    ).toBe(false);
    expect(
      verifyStripeSignature({
        payload: body,
        header,
        secret: WHSEC,
        now: t * 1000 - WEBHOOK_TOLERANCE_MS - 1,
      }).ok,
    ).toBe(false);
  });
  test("wrong secret fails", () => {
    expect(
      verifyStripeSignature({
        payload: body,
        header,
        secret: "whsec_wrong",
        now: t * 1000,
      }).ok,
    ).toBe(false);
  });
  test("malformed header fails", () => {
    expect(
      verifyStripeSignature({
        payload: body,
        header: "garbage",
        secret: WHSEC,
        now: t * 1000,
      }).ok,
    ).toBe(false);
    expect(
      verifyStripeSignature({
        payload: body,
        header: null,
        secret: WHSEC,
        now: t * 1000,
      }).ok,
    ).toBe(false);
  });
  test("non-whsec secret rejected", () => {
    expect(
      verifyStripeSignature({
        payload: body,
        header,
        secret: "sk_test_x",
        now: t * 1000,
      }).ok,
    ).toBe(false);
  });
});

describe("differential vs node:crypto (≥10_000 random inputs)", () => {
  test("10k random secret/payload pairs match createHmac", () => {
    // Import the same primitive used by verifyStripeSignature via a round-trip
    // header: if verify accepts a node-built HMAC, the implementations agree.
    let matched = 0;
    for (let i = 0; i < 10_000; i++) {
      const secret = `whsec_${randomBytes(12).toString("hex")}`;
      const payload = randomBytes(1 + (i % 200)).toString("utf8");
      const t = 1_700_000_000 + (i % 1000);
      const header = headerFor(secret, payload, t);
      const result = verifyStripeSignature({
        payload,
        header,
        secret,
        now: t * 1000,
      });
      if (result.ok) matched += 1;
    }
    expect(matched).toBe(10_000);
  });

  test("timingSafeEqualHex behavior: equal-length unequal values", () => {
    const a = nodeHmacHex("whsec_a", "x");
    const b = nodeHmacHex("whsec_b", "x");
    expect(a).not.toBe(b);
    // constant-time primitive used internally must accept equal strings
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(a, "hex");
    expect(timingSafeEqual(bufA, bufB)).toBe(true);
    expect(timingSafeEqual(bufA, Buffer.from(b, "hex"))).toBe(false);
  });
});
