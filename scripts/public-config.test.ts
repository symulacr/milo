import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CSP_REPORT_PATH,
  CSP_REPORT_PLACEHOLDER,
  narrowCsp,
  publicConfig,
  publicConfigResponse,
} from "../packages/backend/src/public-config";

describe("social tags", () => {
  // F-05: Open Graph requires absolute URLs; a relative og:image is dropped by
  // every consumer, so a shared Milo link has no card. The build rewrites these
  // exact strings, so the strings must exist for the rewrite to have a target.
  const landing = readFileSync("apps/web/index.html", "utf8");
  test("the social card and the canonical URL are absolute at build time", () => {
    expect(landing).toContain(
      'property="og:image" content="./public/og-card.png"',
    );
    expect(landing).toContain('property="og:url" content="./"');
    expect(landing).toContain('rel="canonical" href="./"');
  });
  test("the build substitutes the deployment origin", () => {
    const build = readFileSync("scripts/build.ts", "utf8");
    expect(build).toContain("SITE_URL");
    expect(build).toContain('content="${siteOrigin}/og-card.png"');
  });
});

describe("shipped cache policy", () => {
  // F-01: a deploy replaces every hashed chunk name and deletes the old file. A
  // tab or a cached shell still asking for the old entry gets a 404 on the module
  // itself, so no JavaScript runs and the page is blank. The shell must therefore
  // revalidate; the chunks, whose names are content addresses, stay immutable.
  const manifest = JSON.parse(
    readFileSync("apps/web/public/vercel.json", "utf8"),
  ) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const cacheFor = (source: string) =>
    manifest.headers
      .filter((rule) => rule.source === source)
      .flatMap((rule) => rule.headers)
      .find((header) => header.key === "Cache-Control")?.value ?? "";

  test("the shell revalidates and the hashed chunks are immutable", () => {
    expect(cacheFor("/(.*)")).toContain("must-revalidate");
    expect(cacheFor("/(.*)")).not.toContain("immutable");
    for (const source of ["/(.*).js", "/(.*).wasm"])
      expect(cacheFor(source)).toContain("immutable");
    // The config endpoint must never be cached: it names the live origins.
    expect(cacheFor("/api/public-config")).toBe("no-store");
  });

  /**
   * Vercel applies the LAST matching rule, so a rule's position decides whether
   * it wins. `cacheFor` above matches an exact `source` string and so cannot see
   * precedence at all — which is exactly how K-07 happened. This resolves a real
   * path against every rule in order and keeps the last match.
   *
   * The matcher is written out rather than pulled from `path-to-regexp`: the
   * shipped rules use only three forms, and spelling them out keeps the test
   * honest about what it does and does not model.
   */
  const ruleMatches = (source: string, path: string): boolean => {
    if (source === "/(.*)") return true;
    const wildcardSuffix = source.match(/^\/\(\.\*\)(\.[a-z]+)$/);
    if (wildcardSuffix) return path.endsWith(wildcardSuffix[1]);
    if (source === "/zk/([0-9a-f]{16})/(.*)")
      return /^\/zk\/[0-9a-f]{16}\//.test(path);
    return source === path;
  };

  const cacheForPath = (path: string): string => {
    let value = "";
    for (const rule of manifest.headers) {
      if (!ruleMatches(rule.source, path)) continue;
      const header = rule.headers.find((h) => h.key === "Cache-Control");
      if (header) value = header.value;
    }
    return value;
  };

  test("the content-addressed artifact path is immutable and wins over the shell", () => {
    const versioned = "/zk/453af640523557a4/keys/escalateUnreviewed.verifier";
    const unversioned = "/zk/keys/escalateUnreviewed.verifier";
    expect(cacheForPath(versioned)).toContain("immutable");
    expect(cacheForPath(versioned)).toContain("max-age=31536000");
    expect(cacheForPath(unversioned)).toContain("must-revalidate");
    expect(cacheForPath(unversioned)).not.toContain("immutable");
  });

  test("the immutable rule sits after the catch-all, so it can win", () => {
    const sources = manifest.headers.map((rule) => rule.source);
    const catchAll = sources.indexOf("/(.*)");
    const versioned = sources.indexOf("/zk/([0-9a-f]{16})/(.*)");
    expect(catchAll).toBeGreaterThan(-1);
    expect(versioned).toBeGreaterThan(catchAll);
  });
});

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
