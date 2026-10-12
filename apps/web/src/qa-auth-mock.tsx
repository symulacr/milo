/**
 * QA-only auth stub so RecoveryKitPanel can mount in a real browser without a live auth
 * service. Not shipped in the product entry.
 *
 * The panel reads identity through `useMiloAuth().useSession()`, so the stub mirrors the real
 * client's session shape: `data` is `{ user, session }` when signed in and `null` when not.
 */
export type QaSessionState = {
  authenticated: boolean;
  user: { id: string } | undefined;
};

export function qaAuthClient(state: QaSessionState) {
  return {
    useSession: () => ({
      data:
        state.authenticated && state.user
          ? { user: state.user, session: { id: "qa-session" } }
          : null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: async () => {},
    }),
    signOut: async () => {},
  };
}
