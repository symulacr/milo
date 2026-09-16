import { usePrivy } from "@privy-io/react-auth";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
  useQueries,
} from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backendSessionStatus,
  fetchPrivyAccessToken,
} from "./convex-session-runtime";
import { PaymentMonitoring } from "./PaymentMonitoring";

const currentSession = makeFunctionReference<
  "query",
  Record<string, never>,
  { subject: string }
>("auth/session:current");

function usePrivyConvexAuth() {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const subject = user?.id;
  const fetchAccessToken = useCallback(async () => {
    if (!ready || !authenticated || !subject) return null;
    return fetchPrivyAccessToken(getAccessToken);
  }, [ready, authenticated, getAccessToken, subject]);
  return useMemo(
    () => ({
      isLoading: !ready,
      isAuthenticated: authenticated && !!subject,
      fetchAccessToken,
    }),
    [ready, authenticated, subject, fetchAccessToken],
  );
}

function BackendSession() {
  const { authenticated: signedIn, user } = usePrivy();
  const { isLoading, isAuthenticated, isRefreshing } = useConvexAuth();
  const results = useQueries(
    signedIn && user?.id && isAuthenticated && !isRefreshing
      ? { session: { query: currentSession, args: {} } }
      : {},
  );
  const status = backendSessionStatus(
    signedIn,
    isLoading,
    isAuthenticated,
    results.session,
    user?.id,
    isRefreshing,
  );
  return (
    <>
      <p role="status">{status.message}</p>
      {status.verified && <PaymentMonitoring key={user?.id} />}
    </>
  );
}

export function ConvexConnection({ url }: { url: string }) {
  const { user, authenticated } = usePrivy();
  if (!authenticated || !user?.id)
    return <p role="status">Sign in to verify the backend session.</p>;
  return <IdentityConvexConnection key={`${url}:${user.id}`} url={url} />;
}

function IdentityConvexConnection({ url }: { url: string }) {
  const [client, setClient] = useState<ConvexReactClient>();
  useEffect(() => {
    // Keep provider diagnostics and authenticated query contents out of browser logs.
    const connection = new ConvexReactClient(url, { logger: false });
    setClient(connection);
    return () => {
      void connection.close();
    };
  }, [url]);
  if (!client) return <p role="status">Initializing backend connection…</p>;
  return (
    <ConvexProviderWithAuth client={client} useAuth={usePrivyConvexAuth}>
      <BackendSession />
    </ConvexProviderWithAuth>
  );
}
