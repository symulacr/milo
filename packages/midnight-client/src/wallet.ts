import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import {
  isWrongNetworkError,
  LockedWalletError,
  WrongNetworkError,
} from "./errors.ts";
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
  "You declined the connection request. Approve it in your wallet to continue.";
export const PERMISSION_BLOCKED =
  "Your wallet is blocking Milo. Allow this site in your wallet's settings, then try again.";
export const WALLET_DISCONNECTED =
  "Your wallet disconnected. Open the extension, unlock it, then reconnect.";
export const WALLET_INTERNAL =
  "Your wallet could not complete the request. Update the extension, then try again.";
export const WALLET_BAD_REQUEST =
  "Milo sent the wallet a request it could not read. Reload the page, then try again.";
export const WRONG_NETWORK_MESSAGE =
  "Set your wallet to Midnight Preprod. Milo does not use other networks.";
export const CONNECT_FAILED =
  "The wallet did not complete the connection. Open the extension, then try again.";
export const DIFFERENT_ACCOUNT =
  "A different wallet account is connected. Switch back to the account you used for this order.";

/**
 * The network a wallet reports, named for a sentence. Only the four ids Midnight
 * documents get a display name; anything else passes through verbatim, because
 * capitalizing an id we do not recognise would invent a name for it.
 */
const NETWORK_NAMES: Record<string, string> = {
  preprod: "Preprod",
  preview: "Preview",
  mainnet: "Mainnet",
  undeployed: "Undeployed",
};
export const networkName = (networkId: string): string => {
  const id = networkId.trim();
  return NETWORK_NAMES[id.toLowerCase()] ?? id;
};

/** "Your wallet is on Mainnet. Switch it to Preprod." */
export const wrongNetworkMessage = (networkId: string): string =>
  `Your wallet is on ${networkName(networkId)}. Switch it to Preprod.`;

/**
 * The Bech32m prefix names the network, so an address is a second, independent
 * signal: a wallet can report one network id and hand back an address from
 * another. `mn_addr_preprod` is Preprod; the bare `mn_addr` is mainnet.
 */
export const networkOfAddress = (address: string): string | null => {
  const prefix = address.split("1")[0] ?? "";
  if (prefix === "mn_addr") return "mainnet";
  if (prefix.startsWith("mn_addr_")) return prefix.slice("mn_addr_".length);
  return null;
};

type ConnectorError = { type?: unknown; code?: unknown; reason?: unknown };

/** The network id a WrongNetworkError recorded when it refused. */
const networkOf = (error: unknown): string | null => {
  const detail = (error as { detail?: { network?: unknown } }).detail;
  return typeof detail?.network === "string" ? detail.network : null;
};

/**
 * One sentence for any connect failure: the wallet's own network when it is a
 * network refusal, otherwise the connector code, otherwise the generic line.
 */
export const connectMessage = (error: unknown): string => {
  if (isWrongNetworkError(error)) {
    const network = networkOf(error);
    return network ? wrongNetworkMessage(network) : WRONG_NETWORK_MESSAGE;
  }
  return connectFailureMessage(error);
};

/**
 * The one place a connector error becomes a sentence.
 *
 * `APIError` is not a class (docs: "Do not use `instanceof` checks"), so this
 * reads `type` then `code`. Anything unrecognised falls back to the generic
 * sentence rather than pretending to know the cause.
 */
export function connectFailureMessage(error: unknown): string {
  const failure = (error ?? {}) as ConnectorError;
  const code =
    failure.type === "DAppConnectorAPIError" ? String(failure.code) : "";
  switch (code) {
    case "Rejected":
      return REJECTED_CONNECTION;
    case "PermissionRejected":
      return PERMISSION_BLOCKED;
    case "Disconnected":
      return WALLET_DISCONNECTED;
    case "InternalError":
      return WALLET_INTERNAL;
    case "InvalidRequest":
      return WALLET_BAD_REQUEST;
    default:
      // Not a connector error: a thrown Error from the wallet, or something
      // else. Say what is true without inventing a cause.
      return CONNECT_FAILED;
  }
}

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
  // The address prefix names its network, so it is a second, independent
  // signal: a wallet can report one network id and hand back an address from
  // another. Refuse the mismatch and name the network the ADDRESS is on.
  const addressNetwork = networkOfAddress(unshieldedAddress);
  if (addressNetwork && addressNetwork !== SUPPORTED_MIDNIGHT_NETWORK)
    throw new WrongNetworkError(
      `Only PREPROD is enabled. This address is on "${addressNetwork}".`,
      { network: addressNetwork },
    );
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
      return this.update({ status: "error", message: connectMessage(error) });
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
      // A wallet switched to another network mid-flow is the common case here,
      // and it has its own fix ("switch it to Preprod"), so it must not read as
      // a dropped link. `connectMessage` gives it that sentence.
      return this.update({ status: "error", message: connectMessage(error) });
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
