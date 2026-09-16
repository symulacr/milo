import {
  Component,
  lazy,
  type ReactNode,
  type Ref,
  type RefObject,
  Suspense,
  useEffect,
  useMemo,
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

function LaceStatus() {
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
  headingRef,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt > 0) headingRef.current?.focus();
  }, [attempt, headingRef]);
  return (
    <ConnectionDiagnostics
      key={attempt}
      headingRef={headingRef}
      retry={() => setAttempt((value) => value + 1)}
    />
  );
}

/** Distinct copy per failure mode (04 §10): timeout vs invalid config. */
export function connectionErrorMessage(cause: unknown): string {
  return cause instanceof DOMException && cause.name === "AbortError"
    ? "Loading the connection configuration timed out after 15 seconds. Check network access to the static host, then retry."
    : "Connection configuration could not be loaded or is invalid. No provider was enabled. Ask the operator to check /api/public-config and the PREPROD setting.";
}

function ConnectionDiagnostics({
  retry,
  headingRef,
}: {
  retry: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const [config, setConfig] = useState<PublicConfig>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setConfig(undefined);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 15000);
    void loadPublicConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch((cause) => {
        if (!active) return;
        setError(connectionErrorMessage(cause));
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
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
        Real identity and wallet checks, separate from the sample workspace.
        Signing in does not create agreements, payments or chain submissions.
        This is a development diagnostic surface, not part of the documented
        order flow.
      </p>
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
      {config && (
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
                Privy is not configured. The operator must set PRIVY_APP_ID and
                allow this origin in the Privy dashboard before email sign-in is
                available.
              </p>
            )}
          </section>
          <section className="panel reading-panel" aria-labelledby="lace-title">
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
                  ? "After backend identity verification, use a real quote ID in the payment monitoring section below. Sample orders are never connected to these controls."
                  : "Convex is configured, but Privy is missing. Backend session verification is unavailable."
                : "Convex is not configured. No authenticated application records are connected."}
            </p>
            <p>
              Never paste a recovery phrase, wallet key or app secret into Milo.
              Identity recovery is not recovery of an order’s private
              capability.
            </p>
          </section>
        </>
      )}
      <Link className="text-link" to="/account">
        Back to the sample account →
      </Link>
    </div>
  );
}
