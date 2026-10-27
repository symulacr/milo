import { describe, expect, test } from "bun:test";
import {
  bodyTooLarge,
  cspReportHandler,
  MAX_REPORT_BYTES,
  parseStripeSignatureHeader,
  summariseCspReport,
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

  test("a non-hex v1 candidate is refused, not thrown (public route must not 500)", () => {
    const good = sign(BODY, SECRET, NOW);
    for (const candidate of ["zzzz", "not-hex-at-all", "abc", "0x00"]) {
      const result = verifyStripeSignature({
        payload: BODY,
        header: `t=${NOW},v1=${candidate}`,
        secret: SECRET,
        now: NOW,
      });
      expect(result.ok).toBe(false);
    }
    // A valid candidate alongside junk still verifies.
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: `t=${NOW},v1=zzzz,v1=${good}`,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  // AUDIT15 A-16: the charset gate is not a strength gate. A one-character
  // secret used to pass and then verify signatures against a brute-forceable
  // key, so the floor is now part of the same regex.
  test("a secret shorter than 16 characters is refused (AUDIT15 A-16)", () => {
    for (const short of ["whsec_a", "whsec_abc", `whsec_${"a".repeat(15)}`]) {
      const result = verifyStripeSignature({
        payload: BODY,
        header: headerFor(BODY, short, NOW),
        secret: short,
        now: NOW,
      });
      expect(result.ok).toBe(false);
    }
    // 16 characters is the floor and still accepted.
    const atFloor = `whsec_${"a".repeat(16)}`;
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: headerFor(BODY, atFloor, NOW),
        secret: atFloor,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });
});

/**
 * R23 K-08: a preflight to the report endpoint must not 404.
 *
 * `httpRouter` takes one method per route, so an unmatched OPTIONS is a 404 —
 * which a browser reports as a *failed* report delivery, hiding the policy
 * violation the report was about.
 */
describe("R23 K-08: /csp-report answers a preflight", () => {
  test("the router declares an OPTIONS route on the same path", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./http.ts", import.meta.url),
      "utf8",
    );
    // Both methods on the one path, so neither can be added without the other.
    expect(source).toContain('path: "/csp-report",\n  method: "POST"');
    expect(source).toContain('path: "/csp-report",\n  method: "OPTIONS"');
  });

  test("the preflight answer is a bodiless 204", async () => {
    // The handler is a plain 204: the endpoint is deliberately origin-agnostic,
    // so there is no allowlist to echo and no body to keep PII-free.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./http.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /method: "OPTIONS",\s*\n\s*handler: httpActionGeneric\(\s*\n?\s*async \(\) => new Response\(null, \{ status: 204 \}\)/,
    );
  });
});

/**
 * ROUND 18 item 8 — the CSP report receiver.
 *
 * Report-Only with no `report-to`/`report-uri` collects nothing, so the header
 * read like a control and provided none. The receiver accepts both wire formats,
 * refuses everything else before parsing, and deliberately stores nothing.
 */
describe("ROUND18 item 8: the CSP report receiver", () => {
  const post = (body: string, type: string) =>
    new Request("https://example.convex.site/csp-report", {
      method: "POST",
      headers: { "content-type": type, "content-length": String(body.length) },
      body,
    });

  test("accepts the report-to array format", async () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        url: "https://app.example/orders/quote_1",
        body: {
          "effective-directive": "script-src",
          "blocked-uri": "https://evil.example/x.js",
          "document-uri": "https://app.example/orders/quote_1?invite=secret",
        },
      },
    ]);
    const response = await cspReportHandler(
      {},
      post(body, "application/reports+json"),
    );
    expect(response.status).toBe(204);
    // No body: the browser ignores it, and a body would be one more place the
    // refused data could leak into.
    expect(await response.text()).toBe("");
  });

  test("accepts the legacy csp-report object format", async () => {
    const body = JSON.stringify({
      "csp-report": {
        "document-uri": "https://app.example/",
        "effective-directive": "img-src",
        "blocked-uri": "https://cdn.example/a.png",
      },
    });
    const response = await cspReportHandler(
      {},
      post(body, "application/csp-report"),
    );
    expect(response.status).toBe(204);
    // The legacy payload is nested under `csp-report`, so reading only `body`
    // would summarise it as four empty strings and silently lose the report.
    expect(
      summariseCspReport({
        "csp-report": {
          "document-uri": "https://app.example/",
          "effective-directive": "img-src",
          "blocked-uri": "https://cdn.example/a.png",
        },
      }),
    ).toEqual({
      type: "csp-violation",
      directive: "img-src",
      blocked: "https://cdn.example",
      document: "https://app.example",
    });
  });

  test("a content-type suffix still parses", async () => {
    const response = await cspReportHandler(
      {},
      post("[]", "application/reports+json; charset=utf-8"),
    );
    expect(response.status).toBe(204);
  });

  test.each([
    ["a json body with the wrong type", "{}", "application/json", 400],
    ["no content type", "{}", "", 400],
    ["not json", "nope", "application/reports+json", 400],
    ["a bare string", '"x"', "application/reports+json", 400],
  ])("%s is refused with %d", async (_label, body, type, status) => {
    const response = await cspReportHandler({}, post(body, type));
    expect(response.status).toBe(status);
  });

  test("an oversized report is refused from content-length", async () => {
    const big = "a".repeat(MAX_REPORT_BYTES + 1);
    const response = await cspReportHandler(
      {},
      post(big, "application/reports+json"),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  // The storage decision, asserted: only four fields are kept, and the two that
  // can carry personal data are reduced to an origin. An order URL holds a quote
  // id and an invite token, so logging it whole would be a PII store.
  test("the summary drops paths, queries and the script sample", () => {
    const summary = summariseCspReport({
      type: "csp-violation",
      url: "https://app.example/orders/quote_1?invite=secret",
      body: {
        "effective-directive": "script-src",
        "blocked-uri": "https://evil.example/x.js?a=1",
        "document-uri": "https://app.example/orders/quote_1?invite=secret",
        "script-sample": "alert(document.cookie)",
      },
    });
    expect(summary).toEqual({
      type: "csp-violation",
      directive: "script-src",
      blocked: "https://evil.example",
      document: "https://app.example",
    });
    expect(JSON.stringify(summary)).not.toContain("invite");
    expect(JSON.stringify(summary)).not.toContain("quote_1");
    expect(JSON.stringify(summary)).not.toContain("cookie");
  });

  test("a malformed origin is dropped, not passed through", () => {
    expect(
      summariseCspReport({
        body: { "blocked-uri": "inline", "document-uri": "not a url" },
      }),
    ).toMatchObject({ blocked: "", document: "" });
  });
});

/**
 * ROUND 18 item 6 — the magic-link verify response must not leak the token.
 *
 * The token is in the query string, so any `Referer` the page emits hands it to
 * a third party. OWASP's guidance for URL-borne secrets is
 * `Referrer-Policy: no-referrer` on the landing response. The header is added by
 * a Better Auth after-hook, which is the documented way for a hook to set one.
 */
describe("ROUND18 item 6: no-referrer on the magic-link verify hop", () => {
  test("the hook targets the verify path and nothing else", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./auth.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('ctx.path === "/magic-link/verify"');
    expect(source).toContain('ctx.setHeader("referrer-policy", "no-referrer")');
    // Registered on the one `hooks` object, so it runs on the response. R24
    // added a `before` hook to the same object for G-02, so this asserts both
    // are registered rather than pinning the exact literal — pinning it would
    // fail on any addition and say nothing about the header itself.
    expect(source).toMatch(/hooks: \{[^}]*after: noReferrerOnVerify[^}]*\}/);
    expect(source).toMatch(/hooks: \{[^}]*before: confirmMagicLink[^}]*\}/);
  });

  test("the hook is wired into createAuth, not a wrapper route", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./http.ts", import.meta.url),
      "utf8",
    );
    // No bespoke verify route: the auth component still owns the path, so the
    // token check and the origin check stay in one place.
    expect(source).not.toContain('path: "/api/auth/magic-link/verify"');
    expect(source).toContain("authComponent.registerRoutes(http, createAuth");
  });
});
