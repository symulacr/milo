import type { AuthConfig } from "convex/server";

/**
 * Convex validates Better Auth's session JWTs through the generic `customJwt` provider - the
 * same shape this file used for the previous provider. That avoids registering Better Auth as
 * a Convex component, which would require convex codegen, and codegen is not offline: it
 * uploads to the deployment.
 *
 * Every value below was MEASURED against a running Better Auth instance
 * (hardening/auth-probe/REPORT.md), not taken from documentation:
 *   - `iss` and `aud` are both the service's own base URL, which is why one variable suffices;
 *   - the JWKS is the jwt plugin's default path under that base;
 *   - the algorithm is RS256 because that is what this config asks the plugin to generate.
 *
 * The plugin's DEFAULT key type is EdDSA/Ed25519, which Convex rejects, so the instance must be
 * configured with `jwt({ jwks: { keyPairConfig: { alg: "RS256" } } })`. Note the nesting:
 * passing `keyPairConfig` at the top level is silently ignored.
 */
const authUrl = process.env.BETTER_AUTH_URL;

if (!authUrl) {
  throw new Error("Set BETTER_AUTH_URL on the Convex deployment");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer: authUrl,
      applicationID: authUrl,
      algorithm: "RS256",
      jwks: `${authUrl}/api/auth/jwks`,
    },
  ],
} satisfies AuthConfig;
