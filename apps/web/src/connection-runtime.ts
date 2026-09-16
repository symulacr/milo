import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { z } from "zod";

const publicConfigSchema = z
  .object({
    privyAppId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .nullish(),
    convexUrl: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname.endsWith(".convex.cloud") &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      })
      .nullish(),
    midnightNetwork: z.literal("preprod"),
  })
  .strict();
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export async function loadPublicConfig(
  signal?: AbortSignal,
  request: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<PublicConfig> {
  const response = await request("/api/public-config", {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error("Public connection configuration is unavailable.");
  const result = publicConfigSchema.safeParse(await response.json());
  if (!result.success)
    throw new Error(
      "Public connection configuration is invalid. Only PREPROD is supported.",
    );
  return result.data;
}

/**
 * Enumerate window.midnight entries per 01-blueprint §3.4.2: injection keys
 * are UUIDs, not a stable property. Filter to the supported API major and
 * fail closed; the caller handles zero, one or multiple wallets (user
 * selection required for multiples).
 */
export function discoverLaceWallets(
  registry: Window["midnight"],
): InitialAPI[] {
  if (!registry) return [];
  return Object.values(registry).filter(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet.connect === "function" &&
      /^4\./.test(wallet.apiVersion),
  );
}

type StatusAPI = Pick<ConnectedAPI, "getConnectionStatus" | "getConfiguration">;
export type LaceState = {
  status: "disconnected" | "connecting" | "connected" | "error";
  message: string;
};

export class LaceConnection {
  private api: StatusAPI | undefined;
  private revision = 0;
  constructor(private readonly update: (state: LaceState) => void) {}

  async connect(wallet: Pick<InitialAPI, "connect"> | undefined) {
    const revision = ++this.revision;
    this.api = undefined;
    if (!wallet) {
      this.update({
        status: "error",
        message:
          "No compatible Midnight wallet (API v4) was found. Install or unlock the extension, then retry.",
      });
      return;
    }
    this.update({
      status: "connecting",
      message:
        "Approve the PREPROD connection in Midnight Lace. No signature is requested.",
    });
    try {
      const api = await wallet.connect("preprod");
      if (revision !== this.revision) return;
      await this.verify(api);
      if (revision !== this.revision) return;
      this.api = api;
      this.update({
        status: "connected",
        message:
          "The selected wallet reports a connected PREPROD session. No transaction or account linkage has been performed.",
      });
    } catch {
      if (revision !== this.revision) return;
      this.update({
        status: "error",
        message:
          "Connection not established. Permission may have been declined, the wallet may be unavailable, or its network is not PREPROD. Mainnet is blocked.",
      });
    }
  }

  private async verify(api: StatusAPI) {
    const status = await api.getConnectionStatus();
    if (status.status !== "connected" || status.networkId !== "preprod")
      throw new Error("PREPROD connection required");
    const configuration = await api.getConfiguration();
    if (configuration.networkId !== "preprod")
      throw new Error("PREPROD configuration required");
  }

  async refresh() {
    if (!this.api) return;
    const revision = this.revision;
    try {
      await this.verify(this.api);
      if (revision === this.revision)
        this.update({
          status: "connected",
          message:
            "Lace PREPROD status checked. No transaction or account linkage has been performed.",
        });
    } catch {
      if (revision !== this.revision) return;
      this.api = undefined;
      ++this.revision;
      this.update({
        status: "error",
        message:
          "Lace is disconnected, unavailable, or no longer on PREPROD. Reconnect after checking the extension.",
      });
    }
  }

  disconnect(notify = true) {
    ++this.revision;
    this.api = undefined;
    // Connector v4 has no revoke/disconnect method; forget the handle, not the extension permission.
    if (notify)
      this.update({
        status: "disconnected",
        message:
          "Connection forgotten in Milo. Revoke site permission in Lace to remove the extension’s authorization.",
      });
  }
}
