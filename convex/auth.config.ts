import type { AuthConfig } from "convex/server";
import { env } from "../packages/backend/src/encoding";

/**
 * The same issuer `session-identity.ts` checks, from the same helper, so the
 * two cannot disagree about what "configured" means. Unset yields the sentinel
 * and no token validates.
 */
const issuer =
  env("CONVEX_SITE_URL") ??
  env("BETTER_AUTH_URL") ??
  "urn:milo:auth-unconfigured";

export default {
  providers: [
    {
      type: "customJwt",
      issuer,
      applicationID: "convex",
      algorithm: "RS256",
      jwks: `${issuer}/api/auth/convex/jwks`,
    },
  ],
} satisfies AuthConfig;
