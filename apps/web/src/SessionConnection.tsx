import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient, useConvexAuth, useQueries } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { authClientFor, type MiloAuthClient } from "./auth-client";
import { backendSessionStatus } from "./convex-session-runtime";
import { OrderRecordPanel } from "./OrderRecordPanel";
import { PaymentMonitoring } from "./PaymentMonitoring";

const currentSession = makeFunctionReference<
  "query",
  Record<string, never>,
  { subject: string }
>("auth/session:current");

const SESSION_QUERY = { session: { query: currentSession, args: {} } };
const NO_QUERY = {};

function BackendSession({ authClient }: { authClient: MiloAuthClient }) {
  const { data: session } = authClient.useSession();
  const subject = session?.user?.id;
  const { isLoading, isAuthenticated, isRefreshing } = useConvexAuth();
  // Keep the subscription mounted while a token refresh is in flight. Swapping to `NO_QUERY`
  // during refresh tore the query down and re-ran it on every refresh, so a slow refresh
  // looked like a failed verification and the record/monitoring panels unmounted and
  // remounted. `isRefreshing` still reaches `backendSessionStatus`, which keeps the
  // verification status fail-closed (unverified, "waiting") for the whole refresh window.
  const results = useQueries(
    subject && isAuthenticated ? SESSION_QUERY : NO_QUERY,
  );
  const status = backendSessionStatus(
    Boolean(subject),
    isLoading,
    isAuthenticated,
    results.session,
    subject,
    isRefreshing,
  );
  return (
    <>
      <p role="status">{status.message}</p>
      {status.verified && (
        <>
          <OrderRecordPanel key={`record:${subject}`} actorId={subject} />
          <PaymentMonitoring key={subject} />
        </>
      )}
    </>
  );
}

function SessionStatus({ authClient }: { authClient: MiloAuthClient }) {
  const { data: session, isPending } = authClient.useSession();
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const signedIn = Boolean(session?.user);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <p role="status">
        {isPending
          ? slow
            ? "Sign-in has not become ready. Check network access and auth service configuration, then reload."
            : "Initializing sign-in…"
          : signedIn
            ? "Signed in. This grants no order authority."
            : "Not signed in."}
      </p>
      {error && <p role="alert">{error}</p>}
      {signedIn ? (
        <button
          type="button"
          className="button secondary"
          disabled={isPending}
          onClick={() => {
            void authClient
              .signOut()
              .catch(() => setError("Sign-out failed. Please retry."));
          }}
        >
          Sign out
        </button>
      ) : (
        // The signed-out state used to render a button whose whole handler was
        // `setError("")`: a control that looked like a navigation CTA and did nothing. A link
        // to the synthetic sample order is the honest action here — it needs no identity and
        // creates nothing.
        <Link className="button secondary" to="/orders/sample-001">
          Continue to sample order ↗
        </Link>
      )}
    </>
  );
}

/**
 * The one provider-connection panel: the identity provider wraps the authenticated Convex
 * backend session, so the provider and its consumer stay in one module. It is the lazy entry
 * point for the connection diagnostics; the public entry never reaches it (01 §7.4).
 */
export default function SessionConnection({
  authUrl,
  convexUrl,
  children,
}: {
  authUrl: string;
  convexUrl?: string | null;
  children?: ReactNode;
}) {
  const authClient = useMemo(() => authClientFor(authUrl), [authUrl]);
  const [client, setClient] = useState<ConvexReactClient>();
  useEffect(() => {
    // `ConvexReactClient` throws "Provided address was not an absolute URL." on an empty
    // string, so an unconfigured deployment crashed this panel before it could report that
    // Convex is not configured. Guard first: no URL means no client, and the render below
    // already has an honest "not configured" state.
    if (!convexUrl) {
      setClient(undefined);
      return;
    }
    // Keep provider diagnostics and authenticated query contents out of browser logs.
    const connection = new ConvexReactClient(convexUrl, {
      logger: false,
    });
    setClient(connection);
    return () => {
      void connection.close();
    };
  }, [convexUrl]);
  return (
    <>
      <SessionStatus authClient={authClient} />
      <h3>Backend session</h3>
      {convexUrl && client ? (
        <ConvexBetterAuthProvider
          client={client}
          // The provider's `AuthClient` type resolves `useSession().data` to `never` against
          // better-auth 1.6.33, even though the runtime contract matches: the provider calls
          // `authClient.convex.token(...)` (an endpoint the server plugin defines),
          // `getSession`, `useSession` and the cross-domain plugin's `updateSession`, all of
          // which this client has. The cast is confined to this one prop.
          authClient={authClient as never}
        >
          <BackendSession authClient={authClient} />
        </ConvexBetterAuthProvider>
      ) : (
        <p role="status">
          Convex is not configured. No backend token verification is available.
        </p>
      )}
      {children}
    </>
  );
}
