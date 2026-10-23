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
  const message = isPending
    ? slow
      ? "Sign-in has not become ready. Check network access and auth service configuration, then reload."
      : "Initializing sign-in…"
    : signedIn
      ? "Signed in."
      : "Not signed in.";
  return (
    <>
      <p role="status">{message}</p>
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
        <Link className="button secondary" to="/orders/sample-001">
          Continue to sample order ↗
        </Link>
      )}
    </>
  );
}

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
    if (!convexUrl) {
      setClient(undefined);
      return;
    }
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
