import { z } from "zod";

// Single owner of the browser-facing connection configuration: scripts and
// dev/build validate process.env with publicConfig(), the web client parses
// the /api/public-config response with publicConfigSchema. Both ends of the
// fetch therefore share one definition of the trust boundary.
export const publicConfigSchema = z
  .object({
    betterAuthUrl: z
      .url()
      .refine((value: string) => /^https?:$/.test(new URL(value).protocol))
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
    betterAuthUrl: env.BETTER_AUTH_URL || null,
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
      betterAuthUrl: config.betterAuthUrl,
      convexUrl: config.convexUrl,
      midnightNetwork: config.midnightNetwork,
    },
    { headers },
  );
}
