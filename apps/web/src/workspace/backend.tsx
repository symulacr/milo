import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PublicConfig } from "../../../../packages/backend/src/public-config";
import { api } from "../api";
import { authClientFor } from "../auth-client";
import { Loading } from "../components/ui/status";
import { Alert } from "../components/workspace";
import { loadPublicConfig } from "../notice";

const ConfigContext = createContext<PublicConfig | null>(null);

export const usePublicConfig = () => useContext(ConfigContext);

export function useMe() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me, isAuthenticated ? {} : "skip");
  return {
    loading: isLoading || (isAuthenticated && me === undefined),
    me: isAuthenticated ? (me ?? null) : null,
  };
}

const Notice = ({ title, body }: { title: string; body: string }) => (
  <main className="grid min-h-svh place-content-center gap-3 p-6">
    <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    <Alert>{body}</Alert>
  </main>
);

export function Backend({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // The request is shared and never aborted, so a late resolve is harmless:
    // React ignores a setState on an unmounted component.
    loadPublicConfig().then(setConfig, () => setFailed(true));
  }, []);
  const client = useMemo(
    () =>
      config?.convexUrl
        ? new ConvexReactClient(config.convexUrl, { logger: false })
        : null,
    [config?.convexUrl],
  );
  if (failed)
    return (
      <Notice
        title="Milo cannot start"
        body="The site configuration did not load. Check your connection, then reload the page."
      />
    );
  // The config is one small request, but rendering nothing until it lands
  // leaves the whole workspace blank and makes the first click feel late.
  if (!config) return <Loading label="Loading Milo" />;
  if (!client || !config.betterAuthUrl)
    return (
      <Notice
        title="Milo is not configured"
        body="This site has no backend or sign-in service. The site owner must set them before orders can run."
      />
    );
  return (
    <ConfigContext.Provider value={config}>
      <ConvexBetterAuthProvider
        client={client}
        authClient={authClientFor(config.betterAuthUrl) as never}
      >
        {children}
      </ConvexBetterAuthProvider>
    </ConfigContext.Provider>
  );
}
