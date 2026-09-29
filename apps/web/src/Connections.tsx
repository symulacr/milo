import {
  Component,
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  discoverLaceWallets,
  LaceConnection,
  type LaceState,
  loadPublicConfig,
  type PublicConfig,
} from "./connection-runtime";

const PrivyConnection = lazy(() => import("./PrivyConnection"));

class IdentityBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        Privy could not initialize. Check configuration and network access, then
        reload this page.
      </p>
    ) : (
      this.props.children
    );
  }
}

/** Real Midnight wallet connector status (Lace API v4). Reused by the order console. */
export function LaceStatus() {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<LaceState>({
    status: "disconnected",
    message: "Not connected. Midnight Lace API v4 is required in this browser.",
  });
  // Enumerate injected wallets once (01 §3.4.2); multiple require user selection.
  const [candidates] = useState(() =>
    typeof window === "undefined" ? [] : discoverLaceWallets(window.midnight),
  );
  const [selected, setSelected] = useState(0);
  const connection = useMemo(() => new LaceConnection(setState), []);
  useEffect(() => {
    const timer = setInterval(() => {
      void connection.refresh();
    }, 15000);
    return () => {
      clearInterval(timer);
      connection.disconnect(false);
    };
  }, [connection]);
  return (
    <>
      <p>
        PREPROD only. Milo reads connection status and network — never keys,
        balances or signatures.
      </p>
      <p role="status">{state.message}</p>
      {state.status !== "connected" && state.status !== "connecting" && (
        <label className="connection-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />{" "}
          I consent to sharing this site’s origin with Lace and checking its
          PREPROD connection.
        </label>
      )}
      <div className="connection-actions">
        {state.status === "connected" ? (
          <button
            className="button"
            type="button"
            onClick={() => {
              void connection.refresh();
            }}
          >
            Recheck wallet status
          </button>
        ) : (
          <>
            {candidates.length > 1 && (
              <label className="field">
                Wallet to connect
                <select
                  value={selected}
                  onChange={(event) => setSelected(Number(event.target.value))}
                >
                  {candidates.map((wallet, index) => (
                    <option key={wallet.rdns || index} value={index}>
                      {wallet.name || `Wallet ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button"
              type="button"
              disabled={!consent || state.status === "connecting"}
              onClick={() => {
                void connection.connect(candidates[selected]);
              }}
            >
              {/* Wallet self-reported name is unauthenticated metadata
                  (01 §3.4.2); rendered as text only. */}
              {candidates.length > 0
                ? `Connect ${candidates[selected]?.name || "the selected wallet"}`
                : "Connect a Midnight wallet"}
            </button>
          </>
        )}
        {(state.status === "connected" || state.status === "connecting") && (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              connection.disconnect();
              setConsent(false);
            }}
          >
            Forget connection
          </button>
        )}
      </div>
      <p className="micro muted">
        Rechecked every 15 seconds. Revoke this site in the wallet to remove
        permission. Installed or enabled a wallet after this page loaded? Reload
        to detect it.
      </p>
    </>
  );
}

export function Connections({
  headingRef: externalHeadingRef,
}: {
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const localHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingRef = externalHeadingRef ?? localHeadingRef;
  return (
    <div className="connections-page">
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1} ref={headingRef}>
            Connection diagnostics
          </h1>
        </div>
      </div>
      <p>
        Real identity and wallet checks that back the order console. Signing in
        does not create agreements, payments or chain submissions. This is a
        development diagnostic surface, not part of the documented order flow.
      </p>
      <PublicConfigGate onRetry={() => headingRef.current?.focus()}>
        {(config) => (
          <>
            <section
              className="panel reading-panel"
              aria-labelledby="identity-title"
            >
              <h2 id="identity-title">Email identity</h2>
              {config.privyAppId ? (
                <IdentityBoundary>
                  <Suspense fallback={<p role="status">Loading Privy…</p>}>
                    <PrivyConnection
                      appId={config.privyAppId}
                      convexUrl={config.convexUrl}
                    />
                  </Suspense>
                </IdentityBoundary>
              ) : (
                <p role="status">
                  Privy is not configured. The operator must set PRIVY_APP_ID
                  and allow this origin in the Privy dashboard before email
                  sign-in is available.
                </p>
              )}
            </section>
            <section
              className="panel reading-panel"
              aria-labelledby="lace-title"
            >
              <h2 id="lace-title">Midnight Lace · PREPROD</h2>
              <LaceStatus />
            </section>
            <section
              className="panel reading-panel"
              aria-labelledby="records-title"
            >
              <h2 id="records-title">Application records</h2>
              <p>
                {config.convexUrl
                  ? config.privyAppId
                    ? "After backend identity verification, the order console loads the chain-backed order record (phase + checkpoint address) from the Convex projection written by the A1 ingest path, and can observe a real quote’s payment monitoring below. No order is created or modified by these controls. No phase label is shown without a backing order record."
                    : "Convex is configured, but Privy is missing. Backend session verification is unavailable."
                  : "Convex is not configured. No authenticated application records are connected. No phase label is shown without a backing order record."}
              </p>
              <p>
                Chain-backed order record path: Convex `orders:read` projection
                of the A1 ingest (`observationIngest` → `chainObservations` →
                `orders`). The console is read-only over that projection.
              </p>
              <p>
                Never paste a recovery phrase, wallet key or app secret into
                Milo. Identity recovery is not recovery of an order’s private
                capability.
              </p>
            </section>
          </>
        )}
      </PublicConfigGate>
      <Link className="text-link" to="/account">
        Back to the account →
      </Link>
    </div>
  );
}

/** Distinct copy per failure mode (04 §10): timeout vs invalid config. */
export function connectionErrorMessage(cause: unknown): string {
  return cause instanceof DOMException && cause.name === "AbortError"
    ? "Loading the connection configuration timed out after 15 seconds. Check network access to the static host, then retry."
    : "Connection configuration could not be loaded or is invalid. No provider was enabled. Ask the operator to check /api/public-config and the PREPROD setting.";
}

/**
 * The one /api/public-config loader: abort + 15s timeout + retry around native
 * fetch, shared by the order console and these diagnostics so the fetch, the
 * timeout and the retry copy live in a single place. There is no transport
 * wrapper here - loadPublicConfig calls fetch directly.
 */
export function PublicConfigGate({
  children,
  onRetry,
}: {
  children: (config: PublicConfig) => ReactNode;
  onRetry?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PublicConfigAttempt
      key={attempt}
      retry={() => {
        setAttempt((value) => value + 1);
        onRetry?.();
      }}
    >
      {children}
    </PublicConfigAttempt>
  );
}

function PublicConfigAttempt({
  children,
  retry,
}: {
  children: (config: PublicConfig) => ReactNode;
  retry: () => void;
}) {
  const [config, setConfig] = useState<PublicConfig>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    void loadPublicConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch((cause) => {
        if (active) setError(connectionErrorMessage(cause));
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
  return (
    <>
      {!config && !error && (
        <p role="status">Loading public connection configuration…</p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="button secondary" type="button" onClick={retry}>
            Retry configuration
          </button>
        </div>
      )}
      {config && children(config)}
    </>
  );
}
