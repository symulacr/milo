import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function createMiloAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [convexClient(), crossDomainClient()],
  });
}

export type MiloAuthClient = ReturnType<typeof createMiloAuthClient>;

const clientsByBaseUrl = new Map<string, MiloAuthClient>();
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

const FALLBACK_AUTH_CLIENT = {
  useSession: () => ({ data: null, isPending: false, error: null }),
  signOut: async () => {},
} as unknown as MiloAuthClient;

export function useMiloAuth(): MiloAuthClient {
  return client ?? FALLBACK_AUTH_CLIENT;
}
