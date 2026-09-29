/**
 * Browser wallet connector (Lace / @midnight-ntwrk/dapp-connector-api v4).
 *
 * Scope is status + connect + account. No signing, balancing, or submission
 * methods are exposed: those belong to the Wave B circuit-call path and must
 * go through the wallet's own ConnectedAPI once a call is actually proven.
 *
 * Enumeration rules follow 01-blueprint §3.4.2: injection keys under
 * `window.midnight` are UUIDs, not a stable property; filter to API major 4
 * and fail closed. Do not assume the connector supplies a standard account ID.
 */

import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import {
  assertSupportedNetwork,
  SUPPORTED_MIDNIGHT_NETWORK,
  type SupportedMidnightNetwork,
} from "./network";

export type WalletRegistry = Window["midnight"] | undefined | null;

/** The account fields this package is willing to surface. No invented ID. */
export type WalletAccount = {
  readonly unshieldedAddress: string;
};

export type WalletConnectionState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | {
      readonly status: "connected";
      readonly networkId: SupportedMidnightNetwork;
      readonly account: WalletAccount;
    }
  | { readonly status: "error"; readonly message: string };

type StatusAPI = Pick<
  ConnectedAPI,
  "getConnectionStatus" | "getConfiguration" | "getUnshieldedAddress"
>;

const UNSUPPORTED_WALLET =
  "No compatible Midnight wallet (API v4) was found. Install or unlock the extension, then retry.";
const REJECTED_CONNECTION =
  "Connection not established. Permission may have been declined, the wallet may be unavailable, or its network is not PREPROD. Mainnet is blocked.";

/**
 * Enumerate `window.midnight` entries that implement dapp-connector-api v4.
 * Zero, one or many may be returned; multi-wallet selection is the caller's job.
 */
export function discoverWallets(registry: WalletRegistry): InitialAPI[] {
  if (!registry) return [];
  return Object.values(registry).filter(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet.connect === "function" &&
      typeof wallet.apiVersion === "string" &&
      /^4\./.test(wallet.apiVersion),
  );
}

/**
 * Fail closed unless the wallet reports a connected PREPROD session in both
 * status and configuration. Mainnet (or any other id) is rejected.
 */
export async function verifyPreprodConnection(api: StatusAPI): Promise<void> {
  const status = await api.getConnectionStatus();
  if (status.status !== "connected") {
    throw new Error("Wallet is not connected");
  }
  assertSupportedNetwork(status.networkId);
  const configuration = await api.getConfiguration();
  assertSupportedNetwork(configuration.networkId);
}

async function readAccount(api: StatusAPI): Promise<WalletAccount> {
  const { unshieldedAddress } = await api.getUnshieldedAddress();
  if (typeof unshieldedAddress !== "string" || unshieldedAddress.length === 0) {
    throw new Error("Wallet returned no unshielded address");
  }
  return { unshieldedAddress };
}

/**
 * Connector contract. `Handle` is what `connect` accepts: Lace takes an
 * `InitialAPI`, the SDK connector takes a `WalletSdkSession`. Both share
 * state/refresh/disconnect and the same PREPROD fail-closed rules.
 */
export type WalletConnector<Handle = InitialAPI> = {
  readonly state: WalletConnectionState;
  connect(handle: Handle | undefined): Promise<WalletConnectionState>;
  refresh(): Promise<WalletConnectionState>;
  disconnect(notify?: boolean): void;
};

/**
 * Lace-oriented connector. Remembers only a verified PREPROD session; any
 * wrong-network or failed check drops back to error/disconnected.
 */
export class LaceWalletConnector implements WalletConnector {
  private api: StatusAPI | undefined;
  private current: WalletConnectionState = { status: "disconnected" };
  private revision = 0;

  constructor(
    private readonly onState: (state: WalletConnectionState) => void = () => {},
  ) {}

  get state(): WalletConnectionState {
    return this.current;
  }

  private update(next: WalletConnectionState): WalletConnectionState {
    this.current = next;
    this.onState(next);
    return next;
  }

  async connect(wallet: InitialAPI | undefined) {
    const revision = ++this.revision;
    this.api = undefined;
    if (!wallet) {
      return this.update({ status: "error", message: UNSUPPORTED_WALLET });
    }
    this.update({ status: "connecting" });
    try {
      const api = (await wallet.connect(
        SUPPORTED_MIDNIGHT_NETWORK,
      )) as StatusAPI;
      if (revision !== this.revision) return this.current;
      await verifyPreprodConnection(api);
      if (revision !== this.revision) return this.current;
      // Advisory only (v4 spec): older wallets may not implement it.
      try {
        await (api as ConnectedAPI).hintUsage?.([
          "getConnectionStatus",
          "getConfiguration",
          "getUnshieldedAddress",
        ]);
      } catch {
        // Hint-only failure: keep the verified connection.
      }
      if (revision !== this.revision) return this.current;
      const account = await readAccount(api);
      if (revision !== this.revision) return this.current;
      this.api = api;
      return this.update({
        status: "connected",
        networkId: SUPPORTED_MIDNIGHT_NETWORK,
        account,
      });
    } catch {
      if (revision !== this.revision) return this.current;
      return this.update({ status: "error", message: REJECTED_CONNECTION });
    }
  }

  async refresh() {
    if (!this.api) return this.current;
    const revision = this.revision;
    try {
      await verifyPreprodConnection(this.api);
      const account = await readAccount(this.api);
      if (revision !== this.revision) return this.current;
      return this.update({
        status: "connected",
        networkId: SUPPORTED_MIDNIGHT_NETWORK,
        account,
      });
    } catch {
      if (revision !== this.revision) return this.current;
      this.api = undefined;
      ++this.revision;
      return this.update({
        status: "error",
        message:
          "Lace is disconnected, unavailable, or no longer on PREPROD. Reconnect after checking the extension.",
      });
    }
  }

  disconnect(notify = true) {
    ++this.revision;
    this.api = undefined;
    // Connector v4 has no revoke/disconnect method; forget the handle only.
    if (notify) return this.update({ status: "disconnected" });
    return this.current;
  }
}

/**
 * Fail closed unless a verified PREPROD wallet session is present.
 */
export function assertWalletConnected(
  state: WalletConnectionState,
): asserts state is Extract<WalletConnectionState, { status: "connected" }> {
  if (state.status !== "connected") {
    throw new Error("A connected PREPROD wallet is required.");
  }
  assertSupportedNetwork(state.networkId);
}
