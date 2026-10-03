import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  publicConfig,
  publicConfigResponse,
  readServerEnv,
  serverEnvSchema,
} from "../packages/backend/src/public-config";

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

test("empty-string settings mean unset, as before the shared schema", () => {
  expect(publicConfig({ PRIVY_APP_ID: "", CONVEX_URL: "" })).toEqual({
    privyAppId: null,
    convexUrl: null,
    midnightNetwork: "preprod",
  });
});

describe("server environment schema", () => {
  /** Variables whose unset value is a documented default, not "absent". */
  const DEFAULTED = new Set([
    "MILO_LOCAL_TIMEOUT_MS",
    "MILO_AWAIT_TIMEOUT_MS",
    "MIDNIGHT_PREPROD_PROGRESS_INTERVAL_MS",
  ]);

  test("unset and empty-string are the same for every documented variable", () => {
    for (const name of Object.keys(serverEnvSchema.shape)) {
      if (DEFAULTED.has(name)) continue;
      expect(readServerEnv(name as never, {})).toBeUndefined();
      expect(readServerEnv(name as never, { [name]: "" })).toBeUndefined();
      expect(readServerEnv(name as never, { [name]: "   " })).toBeUndefined();
    }
  });

  test("the schema covers every variable documented in .env.example", async () => {
    const example = await readFile(
      new URL("../.env.example", import.meta.url).pathname,
      "utf8",
    );
    const documented = new Set(
      [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    );
    expect(documented.size).toBeGreaterThan(20);
    for (const name of Object.keys(serverEnvSchema.shape))
      expect(documented.has(name), `${name} is not in .env.example`).toBe(true);
    for (const name of documented)
      expect(
        Object.hasOwn(serverEnvSchema.shape, name),
        `${name} is documented but has no schema entry`,
      ).toBe(true);
  });

  test("the webhook secret must match the whsec_ charset", () => {
    expect(
      readServerEnv("STRIPE_WEBHOOK_SECRET", {
        STRIPE_WEBHOOK_SECRET: "whsec_abc123",
      }),
    ).toBe("whsec_abc123");
    expect(() =>
      readServerEnv("STRIPE_WEBHOOK_SECRET", {
        STRIPE_WEBHOOK_SECRET: "sk_live_notanendpointsecret",
      }),
    ).toThrow("whsec_");
  });

  test("the provisioning authority list is split and trimmed, and unset means nobody", () => {
    expect(
      readServerEnv("MILO_TRUSTED_PROVISIONING_AUTHORITIES", {
        MILO_TRUSTED_PROVISIONING_AUTHORITIES: " op-a , op-b ,,",
      }),
    ).toEqual(["op-a", "op-b"]);
    expect(
      readServerEnv("MILO_TRUSTED_PROVISIONING_AUTHORITIES", {}),
    ).toBeUndefined();
  });

  test("timeout variables are positive integers with a documented default", () => {
    expect(readServerEnv("MILO_LOCAL_TIMEOUT_MS", {})).toBe(60_000);
    expect(readServerEnv("MILO_AWAIT_TIMEOUT_MS", {})).toBe(900_000);
    expect(
      readServerEnv("MILO_LOCAL_TIMEOUT_MS", { MILO_LOCAL_TIMEOUT_MS: "5000" }),
    ).toBe(5000);
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      expect(() =>
        readServerEnv("MILO_LOCAL_TIMEOUT_MS", { MILO_LOCAL_TIMEOUT_MS: bad }),
      ).toThrow();
    }
    for (const name of DEFAULTED)
      expect(readServerEnv(name as never, { [name]: "" })).toBeTypeOf("number");
  });

  test("a secret never reaches the public config", () => {
    const config = publicConfig({
      PRIVY_APP_ID: "app",
      PRIVY_APP_SECRET: "privy-secret-value",
      STRIPE_SECRET_KEY: "sk_test_value",
      STRIPE_WEBHOOK_SECRET: "whsec_value",
      MILO_TRUSTED_PROVISIONING_AUTHORITIES: "op-a",
    });
    const serialized = JSON.stringify(config);
    for (const secret of [
      "privy-secret-value",
      "sk_test_value",
      "whsec_value",
      "op-a",
    ])
      expect(serialized).not.toContain(secret);
  });
});
