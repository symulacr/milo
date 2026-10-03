import { z } from "zod";

// Single owner of the browser-facing connection configuration: scripts and
// dev/build validate process.env with publicConfig(), the web client parses
// the /api/public-config response with publicConfigSchema. Both ends of the
// fetch therefore share one definition of the trust boundary.
export const publicConfigSchema = z
  .object({
    privyAppId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .nullish(),
    convexUrl: z
      .url()
      .refine((value: string) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname.endsWith(".convex.cloud") &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      })
      .nullish(),
    midnightNetwork: z.literal("preprod"),
  })
  .strict();
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export function publicConfig(
  env: Record<string, string | undefined>,
): PublicConfig {
  if (env.MIDNIGHT_NETWORK && env.MIDNIGHT_NETWORK !== "preprod") {
    throw new Error("Only Midnight preprod is enabled for browser connections");
  }
  // Empty strings mean unset, as the previous hand-written checks did.
  return publicConfigSchema.parse({
    privyAppId: env.PRIVY_APP_ID || null,
    convexUrl: env.CONVEX_URL || null,
    midnightNetwork: "preprod",
  });
}

export function publicConfigResponse(
  request: Request,
  config: PublicConfig,
): Response {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "GET" },
    });
  }
  // Select fields again so even an extended server object cannot expose secrets.
  return Response.json(
    {
      privyAppId: config.privyAppId,
      convexUrl: config.convexUrl,
      midnightNetwork: config.midnightNetwork,
    },
    { headers },
  );
}

/**
 * Server-side environment. One schema, validated where it is read, so a
 * deployment that is missing a gating variable fails with its name instead of
 * silently taking a default. `.env.example` documents every name below.
 *
 * Empty string means unset everywhere, as the previous hand-written
 * `process.env.X || undefined` checks did.
 */
const trimmed = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value.length > 0 ? value : undefined))
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

/** A comma-separated operator allowlist; absent means "nobody may provision". */
const authorityList = trimmed.transform((value) =>
  value === undefined
    ? undefined
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
);

const positiveInt = (fallback: number) =>
  trimmed.transform((value) => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error(`expected a positive integer, received "${value}"`);
    }
    return parsed;
  });

export const serverEnvSchema = z
  .object({
    // Browser-facing; validated separately by publicConfig().
    CONVEX_URL: trimmed,
    MIDNIGHT_NETWORK: trimmed,
    PRIVY_APP_ID: trimmed,
    // Privy app secret: signs operator-issued test tokens. Never browser-safe.
    PRIVY_APP_SECRET: trimmed,
    // Stripe test-mode credentials. Never browser-safe.
    STRIPE_SECRET_KEY: trimmed,
    STRIPE_WEBHOOK_SECRET: trimmed.refine(
      (value) => value === undefined || /^whsec_[a-zA-Z0-9]+$/.test(value),
      "STRIPE_WEBHOOK_SECRET must match the whsec_ charset",
    ),
    STRIPE_ACCOUNT_ID: trimmed,
    // Operator allowlist that gates every trusted-provisioning write. Absent
    // means no operator may provision (convex/trustedProvisioning.ts:81,212
    // and packages/backend/src/stripe-customer-provisioning.server.ts:50).
    MILO_TRUSTED_PROVISIONING_AUTHORITIES: authorityList,
    // Preprod/integration lane. Never used by a browser or the webhook path.
    MILO_PREPROD_MODE: trimmed,
    MILO_PREPROD_NETWORK_ID: trimmed,
    MILO_PREPROD_GENESIS_HASH: trimmed,
    MILO_PREPROD_ALLOW: trimmed,
    MILO_PREPROD_ALLOW_PREFLIGHT: trimmed,
    MILO_PREPROD_PROOF_HTTP: trimmed,
    MILO_PREPROD_RUNTIME_SPEC_VERSION: trimmed,
    MILO_PREPROD_ARTIFACT_SET_SHA256: trimmed,
    MILO_PREPROD_COMPILE_RECEIPT_SHA256: trimmed,
    MILO_LOCAL_NETWORK_ID: trimmed,
    MILO_LOCAL_GENESIS_HASH: trimmed,
    MILO_LOCAL_TIMEOUT_MS: positiveInt(60_000),
    MILO_LOCAL_BOOTSTRAP_MODE: trimmed,
    MILO_LOCAL_MAINTENANCE_AUDIT: trimmed,
    MILO_LOCAL_RECOVERY_AUDIT: trimmed,
    MILO_LOCAL_ALLOW_TRANSACTIONS: trimmed,
    MILO_AWAIT_TIMEOUT_MS: positiveInt(900_000),
    MILO_SWEEP_RUN_DIR: trimmed,
    MILO_SWEEP_TRAIL: trimmed,
    MILO_SWEEP_ONLY: trimmed,
    MILO_FEE_REPRO: trimmed,
    MIDNIGHT_PREPROD_NODE: trimmed,
    MIDNIGHT_PREPROD_SEED: trimmed,
    MIDNIGHT_PREPROD_RUN_DIR: trimmed,
    MIDNIGHT_PREPROD_ADDRESS: trimmed,
    MIDNIGHT_PREPROD_DUST_ADDRESS: trimmed,
    MIDNIGHT_PREPROD_PROOF_HTTP: trimmed,
    MIDNIGHT_PREPROD_INDEXER_HTTP: trimmed,
    MIDNIGHT_PREPROD_INDEXER_WS: trimmed,
    MIDNIGHT_PREPROD_PROGRESS_INTERVAL_MS: positiveInt(15_000),
    // Operator-only fixtures for scripts/privy-test-login.ts.
    PRIVY_TEST_EMAIL: trimmed,
    PRIVY_TEST_PHONE: trimmed,
  })
  .loose();

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validate one variable at its point of use and return it, or undefined when
 * unset. A malformed value throws with the variable's name rather than being
 * coerced into a default.
 */
export function readServerEnv<K extends keyof ServerEnv>(
  name: K,
  env: Record<string, string | undefined> = process.env,
): ServerEnv[K] {
  const shape: Record<string, z.ZodType> = serverEnvSchema.shape;
  return shape[name].parse(env[name]) as ServerEnv[K];
}
