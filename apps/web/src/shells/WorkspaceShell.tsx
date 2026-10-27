import { useConvexConnectionState } from "convex/react";
import {
  Component,
  type ReactNode,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { NavLink, Outlet } from "react-router";
import { Button } from "../components/ui/button";
import { ConnectWallet } from "../components/ui/connect";
import { Loading } from "../components/ui/status";
import { Wordmark } from "../components/Wordmark";
import { errorText } from "../components/workspace";
import { SignIn } from "../routes/SignIn";
import { StaleBuild, useMe } from "../workspace/backend";
import { shortAddress, walletConnector } from "../workspace/wallet";

const NAV = [
  ["/orders", "Orders"],
  ["/account", "Account"],
] as const;
const ONLINE = ["online", "offline"] as const;
const subscribeOnline = (sync: () => void) => {
  for (const event of ONLINE) addEventListener(event, sync);
  return () => {
    for (const event of ONLINE) removeEventListener(event, sync);
  };
};
const isOnline = () => navigator.onLine;

/**
 * Catches a render error in the workspace and shows what actually went wrong.
 *
 * The old version said "The order service is not available" for every failure,
 * which hid the cause: a real one was `Cannot read properties of undefined
 * (reading 'maxField')` from the chain load order. `errorText` already turns an
 * error into one safe sentence (it strips Convex envelopes and stack frames and
 * maps known codes), so the boundary shows that, and falls back to the generic
 * line only when the error has nothing to say. The raw error goes to
 * `console.error` so it stays diagnosable without being rendered.
 */
/** A dynamic import that 404'd because the deploy replaced the chunk. The
 * message is the only signal a bundler-less build gets: Chrome and Firefox say
 * "Failed to fetch dynamically imported module", Safari "Importing a module
 * script failed". Anything else is a real fault and keeps the generic sentence. */
const CHUNK_LOAD =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export class ServiceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; stale: boolean; message: string }
> {
  override state = { failed: false, stale: false, message: "" };
  static getDerivedStateFromError = (error: unknown) => ({
    failed: true,
    stale: CHUNK_LOAD.test(errorText(error)),
    message: errorText(error),
  });
  override componentDidCatch(error: unknown) {
    // One line for the console; never rendered, so internals stay out of the UI.
    console.error("Workspace render failed:", error);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    // A deploy replaced the chunk this tab asked for. The order service is fine;
    // the tab is old, and a reload is the whole fix.
    if (this.state.stale)
      return (
        <StaleBuild
          title="Milo was updated"
          body="This tab is older than the current version. Reload to get it."
        />
      );
    return (
      <div className="mx-auto grid max-w-xl gap-2 p-6">
        <h1 tabIndex={-1} className="text-2xl font-extrabold tracking-tight">
          The order service is not available
        </h1>
        <p role="alert" className="text-sm text-destructive">
          {this.state.message}
        </p>
        <p className="text-sm text-muted-foreground">
          Reload the page. If it fails again, try later.
        </p>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => location.reload()}
        >
          Reload
        </Button>
      </div>
    );
  }
}

export function WorkspaceShell() {
  const { me, loading } = useMe();
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const { hasEverConnected, isWebSocketConnected } = useConvexConnectionState();
  // A ref, not state: "this session existed" must not cost a render, and
  // writing state during render re-runs the component on every parent commit.
  const seen = useRef(false);
  if (me) seen.current = true;
  const lost = hasEverConnected && !isWebSocketConnected;
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void walletConnector().refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="min-h-svh">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      {(!online || lost) && (
        <p
          role="status"
          className="bg-warning-soft px-4 py-1.5 text-center text-sm text-warning"
        >
          {/* Two different failures. The browser knows which one it is, so say
              it: "offline" sends a user to check a connection that is fine. */}
          {online
            ? "Live updates paused. Reload if this stays."
            : "Offline. Milo reconnects on its own."}
        </p>
      )}
      <header className="sticky top-0 z-30 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-x-4 px-4 py-3 sm:gap-x-6">
          <Wordmark />
          {me && (
            <nav
              aria-label="Workspace"
              className="flex gap-5 text-sm font-semibold"
            >
              {NAV.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/account"}
                  className="text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {me && (
              <span className="hidden truncate text-[13px] text-muted-foreground lg:inline">
                {me.email ?? shortAddress(me.walletAddress ?? me.subject)}
              </span>
            )}
            {me && <ConnectWallet to="/account" />}
          </div>
        </div>
      </header>
      <main
        id="workspace"
        className="mx-auto grid max-w-7xl gap-8 px-4 pt-8 pb-20 lg:pt-12"
      >
        {loading ? (
          <Loading label="Loading your account" />
        ) : me ? (
          <ServiceBoundary>
            <Outlet />
          </ServiceBoundary>
        ) : (
          <SignIn expired={seen.current} />
        )}
      </main>
    </div>
  );
}
