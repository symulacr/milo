import { describe, expect, test } from "bun:test";
import { publicConfig, publicConfigResponse } from "./public-config";

describe("browser public configuration", () => {
  test("allowlists public fields, never provider secrets", async () => {
    const config = publicConfig({
      PRIVY_APP_ID: "test-public-app",
      CONVEX_URL: "https://example.convex.cloud",
      PRIVY_APP_SECRET: "fixture-private-value",
      STRIPE_SECRET_KEY: "fixture-stripe-value",
    });
    expect(config).toEqual({
      privyAppId: "test-public-app",
      convexUrl: "https://example.convex.cloud",
      midnightNetwork: "preprod",
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
      privyAppId: null,
      convexUrl: null,
      midnightNetwork: "preprod",
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
  test("public endpoint is GET-only", async () => {
    const response = publicConfigResponse(
      new Request("https://milo.example/api/public-config", { method: "POST" }),
      publicConfig({}),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});
