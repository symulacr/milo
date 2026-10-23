import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import {
  type PublicConfig,
  publicConfigSchema,
} from "../../../packages/backend/src/public-config";

export type { PublicConfig };

const V4_API = /^4\./;
const HINTED_METHODS = ["getConnectionStatus", "getConfiguration"] as const;

const CONFIG_URL = "/api/public-config";
const CONFIG_INIT = {
  cache: "no-store",
  credentials: "same-origin",
} as const;

const NO_WALLET =
  "No compatible Midnight wallet (API v4) was found. Install or unlock the extension, then retry.";
const CONNECTING =
  "Approve the PREPROD connection in Midnight Lace. No signature is requested.";
const CONNECTED =
  "The selected wallet reports a connected PREPROD session. No transaction or account linkage has been performed.";
const CONNECT_FAILED =
  "Connection not established. Permission may have been declined, the wallet may be unavailable, or its network is not PREPROD. Mainnet is blocked.";
const REFRESHED =
  "Lace PREPROD status checked. No transaction or account linkage has been performed.";
const REFRESH_FAILED =
  "Lace is disconnected, unavailable, or no longer on PREPROD. Reconnect after checking the extension.";
const DISCONNECTED =
  "Connection forgotten in Milo. Revoke site permission in Lace to remove the extension’s authorization.";

export async function loadPublicConfig(
  signal?: AbortSignal,
  request: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<PublicConfig> {
  const response = await request(CONFIG_URL, { signal, ...CONFIG_INIT });
  if (!response.ok)
    throw new Error("Public connection configuration is unavailable.");
  const result = publicConfigSchema.safeParse(await response.json());
  if (!result.success)
    throw new Error(
      "Public connection configuration is invalid. Only PREPROD is supported.",
    );
  return result.data;
}

export function discoverLaceWallets(
  registry: Window["midnight"],
): InitialAPI[] {
  if (!registry) return [];
  return Object.values(registry).filter(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet.connect === "function" &&
      V4_API.test(wallet.apiVersion),
  );
}

type StatusAPI = Pick<ConnectedAPI, "getConnectionStatus" | "getConfiguration">;
export type LaceState = {
  status: "disconnected" | "connecting" | "connected" | "error";
  message: string;
};

const PREPROD_REQUIRED = "PREPROD connection required";
const PREPROD_CONFIG_REQUIRED = "PREPROD configuration required";

async function verify(api: StatusAPI): Promise<void> {
  const status = await api.getConnectionStatus();
  if (status.status !== "connected" || status.networkId !== "preprod")
    throw new Error(PREPROD_REQUIRED);
  const configuration = await api.getConfiguration();
  if (configuration.networkId !== "preprod")
    throw new Error(PREPROD_CONFIG_REQUIRED);
}

export class LaceConnection {
  private api: StatusAPI | undefined;
  private revision = 0;
  constructor(private readonly update: (state: LaceState) => void) {}

  async connect(wallet: Pick<InitialAPI, "connect"> | undefined) {
    const revision = ++this.revision;
    this.api = undefined;
    if (!wallet) {
      this.update({ status: "error", message: NO_WALLET });
      return;
    }
    this.update({ status: "connecting", message: CONNECTING });
    try {
      const api = await wallet.connect("preprod");
      if (revision !== this.revision) return;
      await verify(api);
      if (revision !== this.revision) return;
      try {
        await api.hintUsage?.([...HINTED_METHODS]);
      } catch {}
      if (revision !== this.revision) return;
      this.api = api;
      this.update({ status: "connected", message: CONNECTED });
    } catch {
      if (revision !== this.revision) return;
      this.update({ status: "error", message: CONNECT_FAILED });
    }
  }

  async refresh() {
    if (!this.api) return;
    const revision = this.revision;
    try {
      await verify(this.api);
      if (revision === this.revision)
        this.update({ status: "connected", message: REFRESHED });
    } catch {
      if (revision !== this.revision) return;
      this.api = undefined;
      ++this.revision;
      this.update({ status: "error", message: REFRESH_FAILED });
    }
  }

  disconnect(notify = true) {
    ++this.revision;
    this.api = undefined;
    if (notify) this.update({ status: "disconnected", message: DISCONNECTED });
  }
}
