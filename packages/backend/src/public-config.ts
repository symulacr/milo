import { z } from "zod";

// An enforcing CSP forbids `new Function`. zod probes for it when the first
// object schema is built (`jit && allowsEval.value` short-circuits only when
// `jit` is already false), and the browser reports the caught probe as a
// `securitypolicyviolation` on every load. This module builds the first schema
// in the browser graph, so the switch belongs here: setting it in a later
// module is too late, because ESM evaluates imports before the importer's body.
z.config({ jitless: true });

const isHttp = (value: string) => /^https?:$/.test(new URL(value).protocol);
const isConvex = (value: string) => {
  const u = new URL(value);
  return (
    u.protocol === "https:" &&
    u.hostname.endsWith(".convex.cloud") &&
    !u.username &&
    !u.password &&
    u.pathname === "/" &&
    !u.search &&
    !u.hash
  );
};

export const publicConfigSchema = z
  .object({
    betterAuthUrl: z.url().refine(isHttp).nullish(),
    convexUrl: z.url().refine(isConvex).nullish(),
    midnightNetwork: z.literal("preprod"),
    paymentsMode: z.enum(["test", "live"]).nullish(),
  })
  .strict();
export type PublicConfig = z.infer<typeof publicConfigSchema>;

const paymentsMode = (key = "") =>
  key.startsWith("pk_live_")
    ? "live"
    : key.startsWith("pk_test_")
      ? "test"
      : null;

export function publicConfig(
  env: Record<string, string | undefined>,
): PublicConfig {
  if (env.MIDNIGHT_NETWORK && env.MIDNIGHT_NETWORK !== "preprod")
    throw new Error("Only Midnight preprod is enabled for browser connections");
  return publicConfigSchema.parse({
    betterAuthUrl: env.BETTER_AUTH_URL || null,
    convexUrl: env.CONVEX_URL || null,
    midnightNetwork: "preprod",
    paymentsMode: paymentsMode(env.STRIPE_PUBLISHABLE_KEY),
  });
}

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Where browsers POST CSP violations. W5 serves this on the Convex site. */
export const CSP_REPORT_PATH = "/csp-report";
/** Stand-in host in the committed `vercel.json`, replaced at build time. */
export const CSP_REPORT_PLACEHOLDER = "https://placeholder.convex.site";

/**
 * Midnight Preprod indexer and node RPC, served by Blockfrost since the
 * Midnight-hosted endpoints were retired on 2026-10-09
 * (docs.midnight.network/guides/networks-and-environments, 2026-10-20).
 * The RPC pair is unused by the current submit path (the wallet relays the
 * transaction) and is listed so a future direct-submit path does not fail
 * silently. W4 owns this list: add or remove scheme-qualified origins only.
 * Loopback proving (`localhost:6300`, `127.0.0.1:6300` — distinct CSP
 * host-sources) is added only when a prover server is configured, because Lace
 * proves in-extension and the page never opens that socket.
 */
const EXTRA_CONNECT = [
  "https://midnight-preprod.blockfrost.io",
  "wss://midnight-preprod.blockfrost.io",
  "https://rpc.midnight-preprod.blockfrost.io",
  "wss://rpc.midnight-preprod.blockfrost.io",
];
const LOOPBACK_CONNECT = ["http://localhost:6300", "http://127.0.0.1:6300"];

type Headers = { source: string; headers: { key: string; value: string }[] }[];

/**
 * Rewrite the shipped `vercel.json` headers for one deployment: substitute the
 * real Convex/auth origins and the real CSP report endpoint, and assert the two
 * invariants that make the policy collectable —
 *   1. no wildcard origin survives in `connect-src`,
 *   2. the report endpoint is itself allowed by `connect-src`, or the browser
 *      blocks the very report it was asked to send.
 * Pure, so `scripts/public-config.test.ts` proves it without a build.
 */
export function narrowCsp(
  manifest: { headers: Headers },
  config: PublicConfig,
  proverConfigured: boolean,
): void {
  const origins = [config.convexUrl, config.betterAuthUrl].filter(
    (value): value is string => Boolean(value),
  );
  const connect = [
    ...origins.flatMap((value) => {
      const url = new URL(value);
      return [url.origin, `wss://${url.host}`];
    }),
    ...EXTRA_CONNECT,
    ...(proverConfigured ? LOOPBACK_CONNECT : []),
  ];
  const reportOrigin = config.betterAuthUrl
    ? new URL(config.betterAuthUrl).origin
    : CSP_REPORT_PLACEHOLDER;
  const connectValue = `connect-src 'self'${connect.map((value) => ` ${value}`).join("")}`;

  for (const rule of manifest.headers)
    for (const header of rule.headers) {
      // One substitution covers all three headers: `Reporting-Endpoints`,
      // `Report-To` and the policy all name the same host. Only the policy also
      // carries `connect-src`, so only it needs the origin rewrite.
      const policy = /^Content-Security-Policy(-Report-Only)?$/.test(
        header.key,
      );
      if (!policy && !/^(Reporting-Endpoints|Report-To)$/.test(header.key))
        continue;
      header.value = header.value
        .replaceAll(CSP_REPORT_PLACEHOLDER, reportOrigin)
        .replace(policy ? /connect-src [^;]+/ : /$^/, connectValue);
      if (!policy) continue;
      // The report endpoint must be reachable under this very policy. With no
      // `connect-src`, `default-src` governs the fetch instead.
      const allowed =
        header.value.match(/connect-src [^;]+/)?.[0] ??
        header.value.match(/default-src [^;]+/)?.[0] ??
        "";
      if (!allowed.includes(reportOrigin))
        throw new Error(
          "CSP report origin is not in connect-src: the browser would block its own reports.",
        );
      if (allowed.includes("*"))
        throw new Error("CSP connect-src still contains a wildcard origin.");
    }
}

export function publicConfigResponse(
  request: Request,
  config: PublicConfig,
): Response {
  if (request.method !== "GET")
    return new Response(null, {
      status: 405,
      headers: { ...HEADERS, Allow: "GET" },
    });
  const { betterAuthUrl, convexUrl, midnightNetwork, paymentsMode } = config;
  return Response.json(
    { betterAuthUrl, convexUrl, midnightNetwork, paymentsMode },
    {
      headers: HEADERS,
    },
  );
}
