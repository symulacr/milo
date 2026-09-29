import { describe, expect, test } from "bun:test";
import {
  bodyTooLarge,
  parseStripeSignatureHeader,
  verifyStripeSignature,
} from "./http";

const SECRET = "whsec_testfixturesecret0123456789";
const BODY = JSON.stringify({ id: "evt_1", livemode: false });
const NOW = 1_800_000_000_000;

function sign(body: string, secret: string, timestamp: number): string {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const mac = crypto.createHmac("sha256", secret);
  mac.update(`${timestamp}.${body}`);
  return mac.digest("hex");
}

function headerFor(
  body: string,
  secret: string,
  timestamp: number,
  extra: string[] = [],
) {
  const v1 = sign(body, secret, timestamp);
  return [`t=${timestamp}`, `v1=${v1}`, ...extra].join(",");
}

describe("bodyTooLarge", () => {
  test("accepts a body at the 256 KiB encoded-byte cap and refuses one byte over", () => {
    const atCap = "a".repeat(256 * 1024);
    const overCap = "a".repeat(256 * 1024 + 1);
    expect(bodyTooLarge(atCap)).toBe(false);
    expect(bodyTooLarge(overCap)).toBe(true);
  });
});

describe("parseStripeSignatureHeader", () => {
  test("extracts timestamp and v1 candidates", () => {
    const header = headerFor(BODY, SECRET, NOW);
    const parsed = parseStripeSignatureHeader(header);
    expect(parsed).toEqual({ timestamp: NOW, v1: [sign(BODY, SECRET, NOW)] });
  });
});

describe("verifyStripeSignature (HMAC-SHA256, ±5 min, 256KB, whsec_ only)", () => {
  test("matching signature accepted", () => {
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: headerFor(BODY, SECRET, NOW),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  test("any matching v1 among candidates accepted", () => {
    const good = sign(BODY, SECRET, NOW);
    const header = `t=${NOW},v1=deadbeef,v1=${good},v1=cafebabe`;
    expect(
      verifyStripeSignature({
        payload: BODY,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  test("tampered body refused", () => {
    expect(
      verifyStripeSignature({
        payload: `${BODY} `,
        header: headerFor(BODY, SECRET, NOW),
        secret: SECRET,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  test("foreign secret refused", () => {
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: headerFor(BODY, "whsec_othersecret0123456789abc", NOW),
        secret: SECRET,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  test("timestamp outside ±5 min refused", () => {
    const late = headerFor(BODY, SECRET, NOW - 5 * 60_000 - 1);
    const early = headerFor(BODY, SECRET, NOW + 5 * 60_000 + 1);
    for (const header of [late, early]) {
      expect(
        verifyStripeSignature({
          payload: BODY,
          header,
          secret: SECRET,
          now: NOW,
        }).ok,
      ).toBe(false);
    }
  });

  test("exact ±5 min boundary inclusive", () => {
    for (const ts of [NOW - 5 * 60_000, NOW + 5 * 60_000]) {
      expect(
        verifyStripeSignature({
          payload: BODY,
          header: headerFor(BODY, SECRET, ts),
          secret: SECRET,
          now: NOW,
        }),
      ).toEqual({ ok: true });
    }
  });

  test("missing or malformed header refused", () => {
    for (const header of [
      null,
      undefined,
      "",
      "garbage",
      "t=abc,v1=xyz",
      "v1=only",
    ]) {
      expect(
        verifyStripeSignature({
          payload: BODY,
          header,
          secret: SECRET,
          now: NOW,
        }).ok,
      ).toBe(false);
    }
  });

  test("non-whsec_ endpoint secret refused before comparison", () => {
    const result = verifyStripeSignature({
      payload: BODY,
      header: headerFor(BODY, "sk_test_notanendpointsecret", NOW),
      secret: "sk_test_notanendpointsecret",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/whsec_/);
  });

  test("non-integer / unsafe timestamp refused", () => {
    for (const ts of ["1.5", "NaN", String(Number.MAX_SAFE_INTEGER + 2)]) {
      expect(
        verifyStripeSignature({
          payload: BODY,
          header: `t=${ts},v1=${sign(BODY, SECRET, NOW)}`,
          secret: SECRET,
          now: NOW,
        }).ok,
      ).toBe(false);
    }
  });

  test("an empty v1 candidate is never a match", () => {
    const good = sign(BODY, SECRET, NOW);
    const header = `t=${NOW},v1=,v1=${good}`;
    expect(
      verifyStripeSignature({
        payload: BODY,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true });
    const onlyEmpty = `t=${NOW},v1=`;
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: onlyEmpty,
        secret: SECRET,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  test("endpoint-secret charset gate is fail-closed before comparison (R-09)", () => {
    const badSecret = "whsec_abc+def/ghi=";
    const result = verifyStripeSignature({
      payload: BODY,
      header: headerFor(BODY, badSecret, NOW),
      secret: badSecret,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/whsec_/);
  });
});
