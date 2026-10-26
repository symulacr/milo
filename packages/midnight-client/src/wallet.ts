import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { LockedWalletError, WrongNetworkError } from "./errors.ts";
import {
  assertSupportedNetwork,
  SUPPORTED_MIDNIGHT_NETWORK,
  type SupportedMidnightNetwork,
} from "./network.ts";

export type WalletRegistry = Window["midnight"] | undefined | null;

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

export const UNSUPPORTED_WALLET =
  "No compatible Midnight wallet (API v4) was found. Install the extension or open it, then retry.";
export const REJECTED_CONNECTION =
  "Connection not established. The request may have been declined, the wallet may be unavailable, or its network is not PREPROD. Mainnet is blocked.";
export const REJECTED_REFRESH =
  "The wallet is disconnected, unavailable, or no longer on PREPROD. Reconnect after checking the extension.";
export const WRONG_NETWORK_MESSAGE =
  "Set your wallet to Midnight Preprod. Milo does not use other networks.";

/** The connector major this app implements. */
const SUPPORTED_API_MAJOR = 4;

export type WalletChoice = {
  readonly rdns: string;
  readonly name: string;
  readonly icon: string;
  readonly api: InitialAPI;
  /** True when more than one injection claims this rdns. */
  readonly duplicate: boolean;
};

/** Compare two dotted versions numerically, component by component. */
const compareVersions = (left: string, right: string) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** Wallets whose reported apiVersion is in the range this app implements. */
const supported = (wallet: InitialAPI) =>
  typeof wallet.connect === "function" &&
  typeof wallet.apiVersion === "string" &&
  Number.parseInt(wallet.apiVersion, 10) === SUPPORTED_API_MAJOR;

/**
 * One row per rdns, highest supported apiVersion first. Keys are not stable
 * (a wallet may use a fresh key per page load), so identity is the rdns.
 */
export function walletChoices(registry: WalletRegistry): WalletChoice[] {
  if (!registry) return [];
  const byRdns = new Map<string, InitialAPI[]>();
  for (const wallet of Object.values(registry)) {
    if (!wallet || !supported(wallet)) continue;
    const group = byRdns.get(wallet.rdns) ?? [];
    group.push(wallet);
    byRdns.set(wallet.rdns, group);
  }
  return [...byRdns]
    .map(([rdns, group]) => {
      const api = [...group].sort((left, right) =>
        compareVersions(right.apiVersion, left.apiVersion),
      )[0] as InitialAPI;
      return {
        rdns,
        name: api.name,
        icon: api.icon,
        api,
        duplicate: group.length > 1,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export type WatchWalletsOptions = {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
};

export function watchWallets(
  read: () => WalletRegistry,
  onChange: (wallets: InitialAPI[]) => void,
  options: WatchWalletsOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? Date.now;
  const started = now();
  let seen: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const tick = () => {
    const wallets = walletChoices(read()).map((choice) => choice.api);
    const signature = wallets.map((wallet) => wallet.rdns).join(",");
    if (signature !== seen) {
      seen = signature;
      onChange(wallets);
    }
    if (wallets.length > 0 || now() - started >= timeoutMs) return stop();
    timer = setTimeout(tick, intervalMs);
  };
  tick();
  return stop;
}

/** The preprod check every connect and refresh runs, returning the account it read.
 * Both the status and the configuration carry a network id, and a wallet can report
 * them inconsistently, so both are reconciled. */
export async function verifyPreprodConnection(
  api: StatusAPI,
): Promise<WalletAccount> {
  const status = await api.getConnectionStatus();
  if (status.status !== "connected")
    throw new LockedWalletError("Wallet is not connected");
  assertSupportedNetwork(status.networkId);
  assertSupportedNetwork((await api.getConfiguration()).networkId);
  const { unshieldedAddress } = await api.getUnshieldedAddress();
  if (typeof unshieldedAddress !== "string" || unshieldedAddress.length === 0)
    throw new LockedWalletError("Wallet returned no unshielded address");
  return { unshieldedAddress };
}

/** The connected state both connect and refresh end in. */
const connected = (account: WalletAccount): WalletConnectionState => ({
  status: "connected",
  networkId: SUPPORTED_MIDNIGHT_NETWORK,
  account,
});

/** Any wallet that implements the DApp connector. */
export class DappWalletConnector {
  private api: StatusAPI | undefined;
  private current: WalletConnectionState = { status: "disconnected" };
  private revision = 0;

  constructor(
    private readonly onState: (state: WalletConnectionState) => void = () => {},
  ) {}

  get state(): WalletConnectionState {
    return this.current;
  }

  connectedApi(): ConnectedAPI | undefined {
    return this.api as ConnectedAPI | undefined;
  }

  private update(next: WalletConnectionState): WalletConnectionState {
    this.current = next;
    this.onState(next);
    return next;
  }

  async connect(
    handle: InitialAPI | undefined,
  ): Promise<WalletConnectionState> {
    const revision = ++this.revision;
    this.api = undefined;
    if (!handle)
      return this.update({ status: "error", message: UNSUPPORTED_WALLET });
    this.update({ status: "connecting" });
    try {
      const api = await handle.connect(SUPPORTED_MIDNIGHT_NETWORK);
      if (revision !== this.revision) return this.current;
      const account = await verifyPreprodConnection(api);
      if (revision !== this.revision) return this.current;
      // Lace 2.4.3 registers hintUsage but the method throws "Method not
      // implemented." synchronously (lace#2270), and an optional call does not
      // catch a synchronous throw: `x.m?.(...).catch(...)` still propagates it.
      // A typeof guard plus try/catch is the only shape that survives both a
      // missing method and a throwing one. A hint is advisory, so neither is fatal.
      const hint = (api as ConnectedAPI).hintUsage;
      if (typeof hint === "function") {
        try {
          await hint.call(api, ["getConnectionStatus", "getConfiguration"]);
        } catch {
          // A wallet that cannot take a hint is still connected.
        }
      }
      if (revision !== this.revision) return this.current;
      this.api = api;
      return this.update(connected(account));
    } catch (error) {
      if (revision !== this.revision) return this.current;
      return this.update({
        status: "error",
        message:
          error instanceof WrongNetworkError
            ? WRONG_NETWORK_MESSAGE
            : REJECTED_CONNECTION,
      });
    }
  }

  async refresh(): Promise<WalletConnectionState> {
    const api = this.api;
    if (!api) return this.current;
    const revision = this.revision;
    try {
      const account = await verifyPreprodConnection(api);
      if (revision !== this.revision) return this.current;
      return this.update(connected(account));
    } catch (error) {
      if (revision !== this.revision) return this.current;
      this.api = undefined;
      ++this.revision;
      // A wallet switched to another network mid-flow is the common case here, and it
      // has its own fix ("set it to Preprod"), so it must not read as a dropped link.
      return this.update({
        status: "error",
        message:
          error instanceof WrongNetworkError
            ? WRONG_NETWORK_MESSAGE
            : REJECTED_REFRESH,
      });
    }
  }

  disconnect(notify = true): void {
    ++this.revision;
    this.api = undefined;
    this.current = { status: "disconnected" };
    if (notify) this.update(this.current);
  }
}

export function assertWalletConnected(
  state: WalletConnectionState,
): asserts state is Extract<WalletConnectionState, { status: "connected" }> {
  if (state.status !== "connected") {
    throw new LockedWalletError("A connected PREPROD wallet is required.");
  }
  assertSupportedNetwork(state.networkId);
}
