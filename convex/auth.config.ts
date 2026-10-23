import type { AuthConfig } from "convex/server";

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
