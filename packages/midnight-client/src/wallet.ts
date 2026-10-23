import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { LockedWalletError } from "./errors.ts";
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

export type StatusAPI = Pick<
  ConnectedAPI,
  "getConnectionStatus" | "getConfiguration" | "getUnshieldedAddress"
>;

const UNSUPPORTED_WALLET =
  "No compatible Midnight wallet (API v4) was found. Install or unlock the extension, then retry.";
const REJECTED_CONNECTION =
  "Connection not established. Permission may have been declined, the wallet may be unavailable, or its network is not PREPROD. Mainnet is blocked.";
const REJECTED_REFRESH =
  "Lace is disconnected, unavailable, or no longer on PREPROD. Reconnect after checking the extension.";

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

export async function verifyPreprodConnection(api: StatusAPI): Promise<void> {
  const status = await api.getConnectionStatus();
  if (status.status !== "connected") {
    throw new LockedWalletError("Wallet is not connected");
  }
  assertSupportedNetwork(status.networkId);
  const configuration = await api.getConfiguration();
  assertSupportedNetwork(configuration.networkId);
}

async function readAccount(api: StatusAPI): Promise<WalletAccount> {
  const { unshieldedAddress } = await api.getUnshieldedAddress();
  if (typeof unshieldedAddress !== "string" || unshieldedAddress.length === 0) {
    throw new LockedWalletError("Wallet returned no unshielded address");
  }
  return { unshieldedAddress };
}

export type WalletConnector<Handle = InitialAPI> = {
  readonly state: WalletConnectionState;
  connect(handle: Handle | undefined): Promise<WalletConnectionState>;
  refresh(): Promise<WalletConnectionState>;
  disconnect(notify?: boolean): void;
};

export abstract class WalletConnectorBase<Handle>
  implements WalletConnector<Handle>
{
  private api: StatusAPI | undefined;
  private current: WalletConnectionState = { status: "disconnected" };
  private revision = 0;

  protected abstract readonly unsupportedMessage: string;
  protected abstract readonly rejectedMessage: string;
  protected abstract readonly refreshMessage: string;

  constructor(
    private readonly onState: (state: WalletConnectionState) => void = () => {},
  ) {}

  get state(): WalletConnectionState {
    return this.current;
  }

  protected abstract open(handle: Handle): Promise<StatusAPI>;

  protected hint(_api: StatusAPI): Promise<void> {
    return Promise.resolve();
  }

  protected update(next: WalletConnectionState): WalletConnectionState {
    this.current = next;
    this.onState(next);
    return next;
  }

  async connect(handle: Handle | undefined): Promise<WalletConnectionState> {
    const revision = ++this.revision;
    this.api = undefined;
    if (!handle) {
      return this.update({ status: "error", message: this.unsupportedMessage });
    }
    this.update({ status: "connecting" });
    try {
      const api = await this.open(handle);
      if (revision !== this.revision) return this.current;
      await verifyPreprodConnection(api);
      if (revision !== this.revision) return this.current;
      await this.hint(api);
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
      return this.update({ status: "error", message: this.rejectedMessage });
    }
  }

  async refresh(): Promise<WalletConnectionState> {
    const api = this.api;
    if (!api) return this.current;
    const revision = this.revision;
    try {
      await verifyPreprodConnection(api);
      const account = await readAccount(api);
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
      return this.update({ status: "error", message: this.refreshMessage });
    }
  }

  disconnect(notify = true): void {
    ++this.revision;
    this.api = undefined;
    this.current = { status: "disconnected" };
    if (notify) this.update(this.current);
  }
}

export class LaceWalletConnector extends WalletConnectorBase<InitialAPI> {
  protected readonly unsupportedMessage = UNSUPPORTED_WALLET;
  protected readonly rejectedMessage = REJECTED_CONNECTION;
  protected readonly refreshMessage = REJECTED_REFRESH;

  protected override open(wallet: InitialAPI): Promise<StatusAPI> {
    return wallet.connect(SUPPORTED_MIDNIGHT_NETWORK);
  }

  protected override async hint(api: StatusAPI): Promise<void> {
    try {
      await (api as ConnectedAPI).hintUsage?.([
        "getConnectionStatus",
        "getConfiguration",
        "getUnshieldedAddress",
      ]);
    } catch {
      return;
    }
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
