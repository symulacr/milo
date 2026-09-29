export interface PublicConfig {
  privyAppId: string | null;
  convexUrl: string | null;
  midnightNetwork: "preprod";
}

export function publicConfig(
  env: Record<string, string | undefined>,
): PublicConfig {
  if (env.MIDNIGHT_NETWORK && env.MIDNIGHT_NETWORK !== "preprod") {
    throw new Error("Only Midnight preprod is enabled for browser connections");
  }
  const privyAppId = env.PRIVY_APP_ID || null;
  if (privyAppId && !/^[a-zA-Z0-9_-]{1,128}$/.test(privyAppId)) {
    throw new Error("Invalid public Privy app ID");
  }
  const convexUrl = env.CONVEX_URL || null;
  if (convexUrl) {
    const url = new URL(convexUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.endsWith(".convex.cloud") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Expected an HTTPS Convex deployment URL");
  }
  return { privyAppId, convexUrl, midnightNetwork: "preprod" };
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
