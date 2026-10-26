import { useConvexConnectionState } from "convex/react";
import {
  Component,
  type ReactNode,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { NavLink, Outlet } from "react-router";
import { ConnectWallet } from "../components/ui/connect";
import { Loading } from "../components/ui/status";
import { Wordmark } from "../components/Wordmark";
import { SignIn } from "../routes/SignIn";
import { useMe } from "../workspace/backend";
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

export class ServiceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto grid max-w-xl gap-2 p-6">
        <h1 tabIndex={-1} className="text-2xl font-extrabold tracking-tight">
          The order service is not available
        </h1>
        <p role="alert" className="text-sm text-destructive">
          Reload the page. If it fails again, try later.
        </p>
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
          Offline. Milo reconnects on its own.
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
