import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The one Better Auth client.
 *
 * The base URL is the deployment's auth service, passed in from the public config the rest of
 * the browser surface reads, so an unconfigured deployment degrades to "auth not configured"
 * rather than requesting a URL that does not exist.
 *
 * `crossDomainClient` is required because on this route the auth service is a separate origin
 * from the app; `convexClient` is what hands Convex its tokens. Both are also what type the
 * client so `ConvexBetterAuthProvider` accepts it.
 *
 * Note: the Better Auth server lives outside this repository, so the client cannot infer its
 * endpoint types from a server instance as a single-repo setup would. The surface is the
 * plugin set plus Better Auth's built-in API.
 */
function createMiloAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [convexClient(), crossDomainClient()],
  });
}

export type MiloAuthClient = ReturnType<typeof createMiloAuthClient>;

/**
 * The one instance for the page.
 *
 * Better Auth's client is an instance, where the previous provider exposed a global
 * `usePrivy()` hook that any descendant could call. Components rendered as children of the
 * connection panel have no prop path to the client, so the instance is held here and created
 * once from the configured base URL — the same ergonomics, without threading a prop through.
 */
let client: MiloAuthClient | null = null;

export function authClientFor(baseURL: string): MiloAuthClient {
  client ??= createMiloAuthClient(baseURL);
  return client;
}

/** For descendants of the connection panel. Throws if the panel never initialised one. */
export function useMiloAuth(): MiloAuthClient {
  if (!client) {
    throw new Error(
      "Auth client is not initialised: render it inside SessionConnection",
    );
  }
  return client;
}
