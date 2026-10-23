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
 * One instance per configured base URL.
 *
 * Better Auth's client is an instance, where the previous provider exposed a global
 * `usePrivy()` hook that any descendant could call. Components rendered as children of the
 * connection panel have no prop path to the client, so the instance is held here and created
 * once per base URL — the same ergonomics, without threading a prop through.
 *
 * Keying by `baseURL` matters because the URL arrives from `/api/public-config`: a
 * reconfiguration (or a second deployment in the same tab) must not silently reuse a client
 * pointed at the previous auth origin.
 */
const clientsByBaseUrl = new Map<string, MiloAuthClient>();

/** The most recently resolved client, for the hook below. */
let client: MiloAuthClient | null = null;

export function authClientFor(baseURL: string): MiloAuthClient {
  const existing = clientsByBaseUrl.get(baseURL);
  if (existing) {
    client = existing;
    return existing;
  }
  const created = createMiloAuthClient(baseURL);
  clientsByBaseUrl.set(baseURL, created);
  client = created;
  return created;
}

/**
 * Safe unauthenticated stand-in.
 *
 * `useMiloAuth()` is called by panels that are not necessarily descendants of
 * `SessionConnection` (the recovery-kit panel is mounted on `QuoteView` and `Account`). Those
 * routes must render an honest "not signed in" state rather than crash the tree, so the hook
 * degrades to this object instead of throwing. It reports no session and a no-op sign-out;
 * it never fabricates an identity.
 */
const FALLBACK_AUTH_CLIENT = {
  useSession: () => ({ data: null, isPending: false, error: null }),
  signOut: async () => {},
} as unknown as MiloAuthClient;

/** For descendants of the connection panel; unauthenticated fallback outside it. */
export function useMiloAuth(): MiloAuthClient {
  return client ?? FALLBACK_AUTH_CLIENT;
}
