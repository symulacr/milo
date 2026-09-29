import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
  useQueries,
} from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  backendSessionStatus,
  fetchPrivyAccessToken,
} from "./convex-session-runtime";
import { OrderRecordPanel } from "./OrderRecordPanel";
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
      {status.verified && (
        <>
          <OrderRecordPanel key={`record:${user?.id}`} actorId={user?.id} />
          <PaymentMonitoring key={user?.id} />
        </>
      )}
    </>
  );
}

function ConvexConnection({ url }: { url: string }) {
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

function IdentityStatus() {
  const { ready, authenticated, logout } = usePrivy();
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const { login } = useLogin({
    onComplete: () => setError(""),
    onError: () =>
      setError(
        "Sign-in did not complete. Retry or check the Privy app’s allowed origins and email login settings.",
      ),
  });
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <p role="status">
        {!ready
          ? slow
            ? "Privy has not become ready. Check network access and app configuration, then reload."
            : "Initializing Privy…"
          : authenticated
            ? "Signed in via Privy. This grants no order authority."
            : "Not signed in. Email sign-in is handled by Privy."}
      </p>
      {error && <p role="alert">{error}</p>}
      {authenticated ? (
        <button
          type="button"
          className="button secondary"
          disabled={!ready}
          onClick={() => {
            void logout().catch(() =>
              setError("Sign-out failed. Please retry."),
            );
          }}
        >
          Sign out of Privy
        </button>
      ) : (
        <button
          type="button"
          className="button"
          disabled={!ready}
          onClick={() => {
            setError("");
            login({ loginMethods: ["email"] });
          }}
        >
          Continue to your order
        </button>
      )}
    </>
  );
}

/**
 * The one provider-connection panel: Privy identity wraps the authenticated
 * Convex backend session, so the identity provider and its consumer stay in one
 * module. It is the lazy entry point for both the order console and the
 * connection diagnostics; the public entry never reaches it (01 §7.4).
 */
export default function PrivyConnection({
  appId,
  convexUrl,
  children,
}: {
  appId: string;
  convexUrl?: string | null;
  children?: ReactNode;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <IdentityStatus />
      <h3>Backend session</h3>
      {convexUrl ? (
        <ConvexConnection key={convexUrl} url={convexUrl} />
      ) : (
        <p role="status">
          Convex is not configured. No backend token verification is available.
        </p>
      )}
      {children}
    </PrivyProvider>
  );
}
