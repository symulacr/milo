import type { InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  type ChangeEvent,
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

const SessionConnection = lazy(() => import("./SessionConnection"));
/** Mirrored from sdk-connector-inject: that demo-only module must stay out of this graph. */
const REGISTRY_EVENT = "milo:midnight-registry";
const PROVER_SLOTS =
  "6 required MidnightProviders slots · local prover :6300 vs wallet-delegated prover disclosure";
const DEFAULT_LACE_STATE: LaceState = {
  status: "disconnected",
  message: "Not connected. Midnight Lace API v4 is required in this browser.",
};
/** Wallet session cached per `window`: a route change must not drop a live connection. */
let cachedWindow: Window | undefined;
let cachedState: LaceState = DEFAULT_LACE_STATE;
let cachedConnection: LaceConnection | undefined;
let cachedSink: ((state: LaceState) => void) | undefined;
function laceSession(): LaceConnection | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedWindow !== window) {
    cachedWindow = window;
    cachedState = DEFAULT_LACE_STATE;
    cachedConnection = undefined;
  }
  cachedConnection ??= new LaceConnection((state) => {
    cachedState = state;
    cachedSink?.(state);
  });
  return cachedConnection;
}
const discover = (): InitialAPI[] =>
  typeof window === "undefined" ? [] : discoverLaceWallets(window.midnight);
class IdentityBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="alert">
        Sign-in could not initialize. Check configuration and network access,
        then reload this page.
      </p>
    );
  }
}
type LaceProps = {
  wallets: InitialAPI[];
  rescan: () => InitialAPI[];
  state: LaceState;
  setState: (next: LaceState) => void;
};

/** Real Midnight wallet connector status (Lace API v4). */
function LaceStatus({ wallets, rescan, state, setState }: LaceProps) {
  const [consent, setConsent] = useState(false);
  // Selection is tracked by reverse-DNS id: injection keys are UUIDs and their order is not
  // stable, so an index would point at a different wallet later.
  const [selectedRdns, setSelectedRdns] = useState(
    () => wallets[0]?.rdns ?? "",
  );
  const selected = Math.max(
    0,
    wallets.findIndex((wallet) => wallet.rdns === selectedRdns),
  );
  const connection = useMemo(laceSession, []);
  useEffect(() => {
    cachedSink = setState;
    setState(cachedState);
    const timer = setInterval(() => {
      // A hidden tab needs no wallet round-trip; the next visible tick resumes.
      if (typeof document !== "undefined" && document.hidden) return;
      void connection?.refresh();
    }, 15000);
    // Only the interval is torn down: the connection is cached per window, so leaving the
    // route must not drop a live session. "Forget connection" is the only disconnect.
    return () => {
      cachedSink = undefined;
      clearInterval(timer);
    };
  }, [connection, setState]);
  const busy = state.status === "connected" || state.status === "connecting";
  // Re-enumerate at click time: an extension (or a test) can add a wallet after first paint
  // without firing any event, and the first click must still connect.
  const connect = () => {
    const fresh = rescan();
    void connection?.connect(
      fresh.find((wallet) => wallet.rdns === selectedRdns) ??
        fresh[selected] ??
        fresh[0],
    );
  };
  const pick = (event: ChangeEvent<HTMLSelectElement>) =>
    setSelectedRdns(wallets[Number(event.target.value)]?.rdns ?? "");
  // Wallet self-reported name is unauthenticated metadata (01 §3.4.2).
  const label = wallets[selected]?.name;
  return (
    <>
      <p>
        PREPROD only. Milo reads connection status and network — never keys,
        balances or signatures.
      </p>
      <p role="status">{state.message}</p>
      {!busy && (
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
            onClick={() => void connection?.refresh()}
          >
            Recheck wallet status
          </button>
        ) : (
          <>
            {wallets.length > 1 && (
              <label className="field">
                Wallet to connect
                <select value={selected} onChange={pick}>
                  {wallets.map((wallet, index) => (
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
              onClick={connect}
            >
              {label ? `Connect ${label}` : "Connect a Midnight wallet"}
            </button>
          </>
        )}
        {busy && (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              connection?.disconnect();
              setConsent(false);
            }}
          >
            Forget connection
          </button>
        )}
      </div>
      <p className="micro muted">
        Rechecked every 15 seconds. A wallet enabled after this page loaded is
        detected on focus, on its own announcement, or on connect.
      </p>
    </>
  );
}
type ReadinessProps = {
  config: PublicConfig;
  laceState: LaceState;
  wallets: InitialAPI[];
};

/** Five-stage readiness view. "pass" reports only what the browser can observe, never that the
 * dependency works; stage 4 tracks the live connection rather than mere detection. */
function ConnectionReadiness({ config, laceState, wallets }: ReadinessProps) {
  const count = wallets.length;
  const lace: [string, string] =
    laceState.status === "connected"
      ? ["Connected · PREPROD", "pass"]
      : laceState.status === "error"
        ? ["Connection error", "fail"]
        : count > 0
          ? [
              count === 1
                ? "1 v4 wallet detected"
                : `${count} v4 wallets detected`,
              "warn",
            ]
          : ["No v4 wallet detected", "pending"];
  const flag = (on: boolean) =>
    [on ? "Configured" : "Not configured", on ? "pass" : "pending"] as const;
  const net = config.midnightNetwork.toUpperCase();
  const stages: [string, string, string][] = [
    ["Public config", `/api/public-config loaded: ${net}`, "pass"],
    ["Email identity", ...flag(Boolean(config.betterAuthUrl))],
    ["Convex backend", ...flag(Boolean(config.convexUrl))],
    ["Midnight Lace wallet", ...lace],
    // Slot wiring is a build-time concern the browser cannot verify.
    ["Provider & Prover slots", PROVER_SLOTS, "pending"],
  ];
  return (
    <ol className="health-stepper" aria-label="Connection readiness stages">
      {stages.map(([name, status, state]) => (
        <li key={name} className="health-step" data-state={state}>
          <strong>{name}</strong>
          <span className="health-stepper-status">{status}</span>
        </li>
      ))}
    </ol>
  );
}

export function Connections({
  headingRef: externalHeadingRef,
}: {
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const localHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingRef = externalHeadingRef ?? localHeadingRef;
  const [wallets, setWallets] = useState<InitialAPI[]>(discover);
  const [laceState, setLaceState] = useState<LaceState>(cachedState);
  const rescan = () => {
    const fresh = discover();
    setWallets(fresh);
    return fresh;
  };
  // Late injection: re-enumerate when the SDK connector announces a change and when the window
  // regains focus, since extensions commonly inject after first paint without any event.
  useEffect(() => {
    const sync = () => setWallets(discover());
    window.addEventListener(REGISTRY_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(REGISTRY_EVENT, sync);
      window.removeEventListener("focus", sync);
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
        Real identity and wallet checks that back the order console. Signing in
        does not create agreements, payments or chain submissions.
      </p>
      <PublicConfigGate onRetry={() => headingRef.current?.focus()}>
        {(config) => (
          <>
            <ConnectionReadiness
              config={config}
              laceState={laceState}
              wallets={wallets}
            />
            <section
              className="panel reading-panel"
              aria-labelledby="identity-title"
            >
              <h2 id="identity-title">Email identity</h2>
              {config.betterAuthUrl ? (
                <IdentityBoundary>
                  <Suspense fallback={<p role="status">Loading sign-in…</p>}>
                    <SessionConnection
                      authUrl={config.betterAuthUrl}
                      convexUrl={config.convexUrl}
                    />
                  </Suspense>
                </IdentityBoundary>
              ) : (
                <p role="status">
                  Sign-in is not configured. Set BETTER_AUTH_URL and allow this
                  origin at the auth service.
                </p>
              )}
            </section>
            <section
              className="panel reading-panel"
              aria-labelledby="lace-title"
            >
              <h2 id="lace-title">Midnight Lace · PREPROD</h2>
              <LaceStatus
                wallets={wallets}
                rescan={rescan}
                state={laceState}
                setState={setLaceState}
              />
            </section>
            <section
              className="panel reading-panel"
              aria-labelledby="records-title"
            >
              <h2 id="records-title">Application records</h2>
              <p>
                {config.convexUrl
                  ? config.betterAuthUrl
                    ? "After backend identity verification, the order console loads the chain-backed order record (phase + checkpoint address) from the Convex `orders:read` projection written by the A1 ingest path. No order is created or modified by these controls. Never paste a recovery phrase, wallet key or app secret into Milo."
                    : "Convex is configured, but the auth service is missing. Backend session verification is unavailable."
                  : "Convex is not configured. No authenticated application records are connected. No phase label is shown without a backing order record."}
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

/** The one /api/public-config loader: abort + 15s timeout + retry around native fetch. */
function PublicConfigGate({
  children,
  onRetry,
}: {
  children: (config: PublicConfig) => ReactNode;
  onRetry?: () => void;
}) {
  const [config, setConfig] = useState<PublicConfig>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void attempt;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    void loadPublicConfig(controller.signal)
      .then((value) => live && setConfig(value))
      .catch((cause) => live && setError(connectionErrorMessage(cause)))
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);
  const retry = () => {
    setError("");
    setConfig(undefined);
    setAttempt((value) => value + 1);
    onRetry?.();
  };
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
