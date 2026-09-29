/**
 * QA-only Privy stub so RecoveryKitPanel can mount in a real browser without a
 * live Privy app. Not shipped in the product entry.
 */
export function usePrivy(): {
  ready: boolean;
  authenticated: boolean;
  user: { id: string } | undefined;
  logout: () => Promise<void>;
} {
  const g = globalThis as unknown as {
    __QA_PRIVY__?: {
      ready?: boolean;
      authenticated?: boolean;
      user?: { id: string };
    };
  };
  const state = g.__QA_PRIVY__ ?? {
    ready: true,
    authenticated: true,
    user: { id: "did:privy:qa-buyer" },
  };
  return {
    ready: state.ready ?? true,
    authenticated: state.authenticated ?? true,
    user: state.user,
    logout: async () => {},
  };
}

export function useLogin(): { login: (opts?: unknown) => void } {
  return { login: () => {} };
}

export function PrivyProvider({ children }: { children?: unknown }): unknown {
  return children;
}
