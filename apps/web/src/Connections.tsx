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
const REGISTRY_EVENT = "milo:midnight-registry";
const DEFAULT_LACE_STATE: LaceState = {
  status: "disconnected",
  message: "Not connected. Midnight Lace API v4 is required in this browser.",
};

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

function LaceStatus({ wallets, rescan, state, setState }: LaceProps) {
  const [consent, setConsent] = useState(false);
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
      if (typeof document !== "undefined" && document.hidden) return;
      void connection?.refresh();
    }, 15000);
    return () => {
      cachedSink = undefined;
      clearInterval(timer);
    };
  }, [connection, setState]);
  const busy = state.status === "connected" || state.status === "connecting";
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
  const label = wallets[selected]?.name;
  return (
    <>
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
    </>
  );
}

type ReadinessProps = {
  config: PublicConfig;
  laceState: LaceState;
  wallets: InitialAPI[];
};

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
  const stages: [string, string, string][] = [
    ["Public config", `${config.midnightNetwork.toUpperCase()} loaded`, "pass"],
    ["Email identity", ...flag(Boolean(config.betterAuthUrl))],
    ["Convex backend", ...flag(Boolean(config.convexUrl))],
    ["Midnight Lace wallet", ...lace],
    ["Provider & Prover slots", "Build-time only", "pending"],
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

function Panel({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel reading-panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
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
  useEffect(() => {
    const sync = () => setWallets(discover());
    window.addEventListener(REGISTRY_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(REGISTRY_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  const records = (config: PublicConfig) =>
    config.convexUrl
      ? config.betterAuthUrl
        ? "Order records load from the Convex orders:read projection after backend verification."
        : "Convex is configured, but the auth service is missing. Backend session verification is unavailable."
      : "Convex is not configured. No authenticated application records are connected. No phase label is shown without a backing order record.";
  return (
    <div className="connections-page">
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1} ref={headingRef}>
            Connection diagnostics
          </h1>
        </div>
      </div>
      <PublicConfigGate onRetry={() => headingRef.current?.focus()}>
        {(config) => (
          <>
            <ConnectionReadiness
              config={config}
              laceState={laceState}
              wallets={wallets}
            />
            <Panel id="identity-title" title="Email identity">
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
            </Panel>
            <Panel id="lace-title" title="Midnight Lace · PREPROD">
              <LaceStatus
                wallets={wallets}
                rescan={rescan}
                state={laceState}
                setState={setLaceState}
              />
            </Panel>
            <Panel id="records-title" title="Application records">
              <p>{records(config)}</p>
            </Panel>
          </>
        )}
      </PublicConfigGate>
      <Link className="text-link" to="/account">
        Back to the account →
      </Link>
    </div>
  );
}

export function connectionErrorMessage(cause: unknown): string {
  return cause instanceof DOMException && cause.name === "AbortError"
    ? "Loading the connection configuration timed out after 15 seconds. Check network access to the static host, then retry."
    : "Connection configuration could not be loaded or is invalid. No provider was enabled. Ask the operator to check /api/public-config and the PREPROD setting.";
}

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
