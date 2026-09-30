import type { AuthConfig } from "convex/server";

const appId = process.env.PRIVY_APP_ID;
if (!appId || !/^[a-zA-Z0-9_-]+$/.test(appId)) {
  throw new Error("Set PRIVY_APP_ID on the Convex deployment");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "privy.io",
      applicationID: appId,
      algorithm: "ES256",
      jwks: `https://api.privy.io/v1/apps/${appId}/jwks.json`,
    },
  ],
} satisfies AuthConfig;


// R7 option C: local disposable Convex only. Never enable in production.
// Coordinator-owned. See e2e/test-jwt-issuer.ts PROPOSED_AUTH_CONFIG_SNIPPET
// and audit/discovery/R7C-report.md.
const testIssuerEnabled =
  process.env.MILO_TEST_ISSUER === "local-only" &&
  process.env.NODE_ENV !== "production";
export const localTestIssuerEnabled = testIssuerEnabled;
