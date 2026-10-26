import { describe, expect, test } from "bun:test";
import {
  CSP_REPORT_PATH,
  CSP_REPORT_PLACEHOLDER,
  narrowCsp,
  publicConfig,
  publicConfigResponse,
} from "../packages/backend/src/public-config";

describe("browser public configuration", () => {
  test("allowlists public fields, never provider secrets", async () => {
    const config = publicConfig({
      BETTER_AUTH_URL: "https://auth.example.com",
      CONVEX_URL: "https://example.convex.cloud",
      PRIVY_APP_SECRET: "fixture-private-value",
      STRIPE_SECRET_KEY: "fixture-stripe-value",
      STRIPE_PUBLISHABLE_KEY: "pk_test_fixture",
    });
    expect(config).toEqual({
      betterAuthUrl: "https://auth.example.com",
      convexUrl: "https://example.convex.cloud",
      midnightNetwork: "preprod",
      paymentsMode: "test",
    });
    const response = publicConfigResponse(
      new Request("https://milo.example/api/public-config"),
      {
        ...config,
        ...{ secret: "fixture-private-value" },
      },
    );
    expect(await response.json()).toEqual(config);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  test("missing configuration stays missing", () => {
    expect(publicConfig({})).toEqual({
      betterAuthUrl: null,
      convexUrl: null,
      midnightNetwork: "preprod",
      paymentsMode: null,
    });
  });
  test("rejects mainnet and unsafe provider URLs", () => {
    for (const network of ["mainnet", "preview", "undeployed"]) {
      expect(() => publicConfig({ MIDNIGHT_NETWORK: network })).toThrow();
    }
    for (const url of [
      "http://example.convex.cloud",
      "https://user:password@example.convex.cloud",
      "https://example.convex.cloud.evil.example",
      "https://example.convex.cloud/?token=secret",
    ]) {
      expect(() => publicConfig({ CONVEX_URL: url })).toThrow();
    }
  });
  test("payment mode follows the publishable key", () => {
    expect(
      publicConfig({ STRIPE_PUBLISHABLE_KEY: "pk_live_x" }).paymentsMode,
    ).toBe("live");
    expect(
      publicConfig({ STRIPE_PUBLISHABLE_KEY: "pk_test_x" }).paymentsMode,
    ).toBe("test");
    expect(
      publicConfig({ STRIPE_PUBLISHABLE_KEY: "sk_live_x" }).paymentsMode,
    ).toBe(null);
  });
  test("public endpoint is GET-only", async () => {
    const response = publicConfigResponse(
      new Request("https://milo.example/api/public-config", { method: "POST" }),
      publicConfig({}),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});

test("empty-string settings mean unset, as before the shared schema", () => {
  expect(publicConfig({ BETTER_AUTH_URL: "", CONVEX_URL: "" })).toEqual({
    betterAuthUrl: null,
    convexUrl: null,
    midnightNetwork: "preprod",
    paymentsMode: null,
  });
});

/**
 * The shipped `vercel.json` is a static file, so it carries a placeholder
 * report host and wildcard origins; `narrowCsp` makes it real at build time.
 * These are the invariants that make the policy *collectable*: a Report-Only
 * policy with no reachable endpoint collects nothing, and a report endpoint
 * outside `connect-src` is blocked by the policy that asked for it.
 */
describe("CSP narrowing", () => {
  const shipped = () => ({
    headers: [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Reporting-Endpoints",
            value: `csp-endpoint="${CSP_REPORT_PLACEHOLDER}${CSP_REPORT_PATH}"`,
          },
          {
            key: "Report-To",
            value: `{"group":"csp-endpoint","endpoints":[{"url":"${CSP_REPORT_PLACEHOLDER}${CSP_REPORT_PATH}"}]}`,
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: `default-src 'self'; connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site; report-to csp-endpoint; report-uri ${CSP_REPORT_PLACEHOLDER}${CSP_REPORT_PATH}`,
          },
        ],
      },
    ],
  });
  const config = publicConfig({
    BETTER_AUTH_URL: "https://deploy.convex.site",
    CONVEX_URL: "https://deploy.convex.cloud",
  });
  const header = (manifest: ReturnType<typeof shipped>, key: string) =>
    manifest.headers[0].headers.find((h) => h.key === key)?.value ?? "";

  test("substitutes the real origins and the real report endpoint", () => {
    const manifest = shipped();
    narrowCsp(manifest, config, false);
    const policy = header(manifest, "Content-Security-Policy-Report-Only");
    expect(policy).not.toContain("placeholder");
    expect(policy).toContain("https://deploy.convex.cloud");
    expect(policy).toContain("wss://deploy.convex.cloud");
    expect(policy).toContain("https://deploy.convex.site");
    expect(policy).toContain(
      `report-uri https://deploy.convex.site${CSP_REPORT_PATH}`,
    );
    expect(header(manifest, "Reporting-Endpoints")).toContain(
      `https://deploy.convex.site${CSP_REPORT_PATH}`,
    );
    expect(header(manifest, "Report-To")).toContain(
      `https://deploy.convex.site${CSP_REPORT_PATH}`,
    );
  });

  test("the report endpoint is allowed by the policy that sends to it", () => {
    const manifest = shipped();
    narrowCsp(manifest, config, false);
    const policy = header(manifest, "Content-Security-Policy-Report-Only");
    const connect = policy.match(/connect-src [^;]+/)?.[0] ?? "";
    expect(connect).toContain("https://deploy.convex.site");
  });

  test("no wildcard origin survives", () => {
    const manifest = shipped();
    narrowCsp(manifest, config, false);
    const connect =
      header(manifest, "Content-Security-Policy-Report-Only").match(
        /connect-src [^;]+/,
      )?.[0] ?? "";
    expect(connect).not.toContain("*");
  });

  test("Midnight Preprod origins are present", () => {
    const manifest = shipped();
    narrowCsp(manifest, config, false);
    const connect =
      header(manifest, "Content-Security-Policy-Report-Only").match(
        /connect-src [^;]+/,
      )?.[0] ?? "";
    // Blockfrost serves Preprod since the Midnight-hosted endpoints retired.
    expect(connect).toContain("https://midnight-preprod.blockfrost.io");
    expect(connect).toContain("wss://midnight-preprod.blockfrost.io");
  });

  test("loopback is added only when a prover server is configured", () => {
    const without = shipped();
    narrowCsp(without, config, false);
    expect(
      header(without, "Content-Security-Policy-Report-Only"),
    ).not.toContain("localhost:6300");
    const withProver = shipped();
    narrowCsp(withProver, config, true);
    const connect =
      header(withProver, "Content-Security-Policy-Report-Only").match(
        /connect-src [^;]+/,
      )?.[0] ?? "";
    // Both spellings: they are distinct CSP host-sources.
    expect(connect).toContain("http://localhost:6300");
    expect(connect).toContain("http://127.0.0.1:6300");
  });

  test("the enforcing header is narrowed too, so the flip is safe", () => {
    const manifest = shipped();
    manifest.headers[0].headers[2].key = "Content-Security-Policy";
    narrowCsp(manifest, config, false);
    const policy = header(manifest, "Content-Security-Policy");
    expect(policy).toContain("https://deploy.convex.site");
    expect(policy).not.toContain("placeholder");
  });

  test("refuses to ship a policy that still points at the placeholder", () => {
    // With no auth origin there is no real host for the report endpoint, so
    // the emitted policy would send reports to a host that does not exist.
    const manifest = shipped();
    expect(() =>
      narrowCsp(
        manifest,
        publicConfig({ CONVEX_URL: "https://x.convex.cloud" }),
        false,
      ),
    ).toThrow(/not in connect-src/);
  });
});
