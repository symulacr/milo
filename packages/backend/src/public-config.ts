import { z } from "zod";

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
  })
  .strict();
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export function publicConfig(
  env: Record<string, string | undefined>,
): PublicConfig {
  if (env.MIDNIGHT_NETWORK && env.MIDNIGHT_NETWORK !== "preprod")
    throw new Error("Only Midnight preprod is enabled for browser connections");
  return publicConfigSchema.parse({
    betterAuthUrl: env.BETTER_AUTH_URL || null,
    convexUrl: env.CONVEX_URL || null,
    midnightNetwork: "preprod",
  });
}

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function publicConfigResponse(
  request: Request,
  config: PublicConfig,
): Response {
  if (request.method !== "GET")
    return new Response(null, {
      status: 405,
      headers: { ...HEADERS, Allow: "GET" },
    });
  const { betterAuthUrl, convexUrl, midnightNetwork } = config;
  return Response.json(
    { betterAuthUrl, convexUrl, midnightNetwork },
    {
      headers: HEADERS,
    },
  );
}
