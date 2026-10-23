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
