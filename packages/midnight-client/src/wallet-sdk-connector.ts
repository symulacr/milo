/**
 * RECONSTRUCTED type surface (P8-W1-C) — wallet-SDK-backed provider behind the
 * SAME dapp-connector-api v4 surface LaceWalletConnector uses.
 *
 * Lace injects InitialAPI under window.midnight. This connector takes a
 * wallet-SDK session (testkit MidnightWalletProvider, WalletFacade, or any
 * object with the same shape) and adapts it to the v4 StatusAPI /
 * InitialAPI contracts so verifyPreprodConnection, readAccount, and
 * assertWalletConnected work unchanged.
 *
 * Type truth is the installed `@midnight-ntwrk/dapp-connector-api@4.0.1`
 * `dist/api.d.ts` (see audit/discovery/RESEARCH-LOG.md):
 * - `ConnectedAPI = WalletConnectedAPI & HintUsage` — the full wallet surface,
 *   not a status subset. Methods this connector does not implement throw.
 * - `getConfiguration(): Promise<Configuration>` where `Configuration`
 *   requires `indexerUri`, `indexerWsUri`, `substrateNodeUri`, `networkId`.
 * - `InitialAPI.connect: (networkId: string) => Promise<ConnectedAPI>`.
 *
 * Fail closed on the same network rules as LaceWalletConnector: only PREPROD
 * is accepted, and both status and configuration must agree. Never invents
 * an account ID; surfaces only the unshielded address the session reports.
 *
 * Labels: "VERIFIED via SDK connector" is NOT "VERIFIED with Lace".
 */

import type {
  Configuration,
  ConnectedAPI,
  ConnectionStatus,
  InitialAPI,
  WalletConnectedAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { LockedWalletError, RejectedSignatureError } from "./errors.ts";
import {
  assertSupportedNetwork,
  SUPPORTED_MIDNIGHT_NETWORK,
} from "./network.ts";
import type {
  WalletAccount,
  WalletConnectionState,
  WalletConnector,
} from "./wallet.ts";

/**
 * Minimal wallet-SDK session shape. Structural so testkit's
 * MidnightWalletProvider, WalletFacade sessions, and plain test doubles all
 * satisfy it without importing @midnight-ntwrk/wallet-sdk here (that package
 * is a Node/WASM dependency of packages/integration, not this browser layer).
 */
export type WalletSdkSession = {
  /** Network the session is bound to. Must be the supported PREPROD id. */
  readonly networkId: string;
  /** Unshielded address in Bech32m. The only account field we surface. */
  readonly unshieldedAddress: string;
  /**
   * Optional live status. Missing or disconnected fails closed.
   * Defaults to an always-connected view of the constructor networkId.
   */
  readonly getConnectionStatus?: () => Promise<ConnectionStatus>;
  /**
   * Optional live service configuration. Missing falls back to a
   * networkId-only Configuration whose URI fields are empty strings — the v4
   * `Configuration` type requires those fields and a bare SDK session does not
   * report service endpoints. Callers that need URIs must supply this.
   */
  readonly getConfiguration?: () => Promise<Configuration>;
};

const UNSUPPORTED_SDK_SESSION =
  "No wallet-SDK session was supplied. Build a session from the integration harness (testkit MidnightWalletProvider or WalletFacade) first.";
const REJECTED_SDK_CONNECTION =
  "SDK wallet connection not established. The session is unavailable, disconnected, or its network is not PREPROD. Mainnet is blocked.";

/** Status subset this connector actually implements. */
export type WalletSdkStatusAPI = {
  getConnectionStatus(): Promise<ConnectionStatus>;
  getConfiguration(): Promise<Configuration>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
};

/**
 * Adapt a wallet-SDK session to the status subset of dapp-connector-api v4
 * (getConnectionStatus / getConfiguration / getUnshieldedAddress). Same
 * fail-closed network checks as the Lace path.
 */
export function walletSdkStatusApi(
  session: WalletSdkSession,
): WalletSdkStatusAPI {
  if (!session || typeof session.unshieldedAddress !== "string") {
    throw new LockedWalletError(UNSUPPORTED_SDK_SESSION);
  }
  return {
    async getConnectionStatus() {
      if (typeof session.getConnectionStatus === "function") {
        return session.getConnectionStatus();
      }
      return { status: "connected" as const, networkId: session.networkId };
    },
    async getConfiguration() {
      if (typeof session.getConfiguration === "function") {
        return session.getConfiguration();
      }
      // v4 Configuration requires service URIs. A session that does not report
      // them is not a service-config source; empty strings satisfy the type
      // and must not be used as endpoints.
      return {
        networkId: session.networkId,
        indexerUri: "",
        indexerWsUri: "",
        substrateNodeUri: "",
      };
    },
    async getUnshieldedAddress() {
      return { unshieldedAddress: session.unshieldedAddress };
    },
  };
}

function unsupported(methodName: keyof WalletConnectedAPI): never {
  throw new RejectedSignatureError(
    `Midnight Wallet SDK connector does not expose ${String(methodName)}. Signing, balancing, and submission belong to the wallet's own ConnectedAPI.`,
  );
}

/**
 * Present the status subset as a full v4 `ConnectedAPI`. Every
 * WalletConnectedAPI method outside the status/account set throws — this
 * connector is status + account only, matching the Lace wallet.ts scope note.
 */
export function walletSdkConnectedApi(session: WalletSdkSession): ConnectedAPI {
  const statusApi = walletSdkStatusApi(session);
  return {
    getConnectionStatus: statusApi.getConnectionStatus,
    getConfiguration: statusApi.getConfiguration,
    getUnshieldedAddress: statusApi.getUnshieldedAddress,
    async hintUsage() {
      /* Advisory only; SDK sessions have no permission UX. */
    },
    getShieldedBalances: () => unsupported("getShieldedBalances"),
    getUnshieldedBalances: () => unsupported("getUnshieldedBalances"),
    getDustBalance: () => unsupported("getDustBalance"),
    getShieldedAddresses: () => unsupported("getShieldedAddresses"),
    getDustAddress: () => unsupported("getDustAddress"),
    getTxHistory: () => unsupported("getTxHistory"),
    balanceUnsealedTransaction: () => unsupported("balanceUnsealedTransaction"),
    balanceSealedTransaction: () => unsupported("balanceSealedTransaction"),
    makeTransfer: () => unsupported("makeTransfer"),
    makeIntent: () => unsupported("makeIntent"),
    signData: () => unsupported("signData"),
    submitTransaction: () => unsupported("submitTransaction"),
    getProvingProvider: () => unsupported("getProvingProvider"),
  };
}

/**
 * Present a wallet-SDK session as an InitialAPI so the existing
 * LaceWalletConnector.connect(wallet) path can be reused unchanged.
 * apiVersion is pinned to the 4.x family the discovery filter accepts.
 * `connect` returns a full `ConnectedAPI` (dapp-connector-api v4 truth).
 */
export function walletSdkInitialApi(
  session: WalletSdkSession,
  options: { readonly rdns?: string; readonly name?: string } = {},
): InitialAPI {
  return {
    rdns: options.rdns ?? "network.midnight.wallet-sdk",
    name: options.name ?? "Midnight Wallet SDK",
    icon: "data:image/svg+xml,",
    apiVersion: "4.0.1",
    async connect(networkId: string): Promise<ConnectedAPI> {
      assertSupportedNetwork(networkId);
      assertSupportedNetwork(session.networkId);
      return walletSdkConnectedApi(session);
    },
  };
}

/**
 * Wallet-SDK-backed connector. Implements the same WalletConnector contract
 * as LaceWalletConnector, with `WalletSdkSession` as the connect handle:
 * remembered state, connect/refresh/disconnect, and fail-closed PREPROD checks
 * on both status and configuration.
 *
 * This is NOT a Lace verification. Runtime labels must say "VERIFIED via
 * SDK connector" and never "VERIFIED with Lace".
 */
export class MidnightWalletSdkConnector
  implements WalletConnector<WalletSdkSession>
{
  private session: WalletSdkSession | undefined;
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

  /**
   * Connect from a wallet-SDK session. Fail closed when the session is
   * missing, disconnected, or on any network other than PREPROD. The
   * account is only the session's unshielded address — no invented ID.
   *
   * Throws (rather than connecting) if handed a window.midnight InitialAPI:
   * that path belongs to LaceWalletConnector.
   */
  async connect(
    session: WalletSdkSession | undefined,
  ): Promise<WalletConnectionState> {
    const revision = ++this.revision;
    this.session = undefined;
    if (!session) {
      return this.update({ status: "error", message: UNSUPPORTED_SDK_SESSION });
    }
    this.update({ status: "connecting" });
    try {
      assertSdkSessionShape(session);
      if (revision !== this.revision) return this.current;
      const api = walletSdkStatusApi(session);
      // Same two-check fail-closed gate as LaceWalletConnector.
      const status = await api.getConnectionStatus();
      if (status.status !== "connected") {
        throw new LockedWalletError("Wallet is not connected");
      }
      assertSupportedNetwork(status.networkId);
      const configuration = await api.getConfiguration();
      assertSupportedNetwork(configuration.networkId);
      if (revision !== this.revision) return this.current;
      const { unshieldedAddress } = await api.getUnshieldedAddress();
      if (
        typeof unshieldedAddress !== "string" ||
        unshieldedAddress.length === 0
      ) {
        throw new LockedWalletError("Wallet returned no unshielded address");
      }
      if (revision !== this.revision) return this.current;
      const account: WalletAccount = { unshieldedAddress };
      this.session = session;
      return this.update({
        status: "connected",
        networkId: SUPPORTED_MIDNIGHT_NETWORK,
        account,
      });
    } catch {
      if (revision !== this.revision) return this.current;
      return this.update({ status: "error", message: REJECTED_SDK_CONNECTION });
    }
  }

  async refresh(): Promise<WalletConnectionState> {
    if (!this.session) return this.current;
    const revision = this.revision;
    try {
      const api = walletSdkStatusApi(this.session);
      const status = await api.getConnectionStatus();
      if (status.status !== "connected") {
        throw new LockedWalletError("Wallet is not connected");
      }
      assertSupportedNetwork(status.networkId);
      const configuration = await api.getConfiguration();
      assertSupportedNetwork(configuration.networkId);
      const { unshieldedAddress } = await api.getUnshieldedAddress();
      if (
        typeof unshieldedAddress !== "string" ||
        unshieldedAddress.length === 0
      ) {
        throw new LockedWalletError("Wallet returned no unshielded address");
      }
      if (revision !== this.revision) return this.current;
      return this.update({
        status: "connected",
        networkId: SUPPORTED_MIDNIGHT_NETWORK,
        account: { unshieldedAddress },
      });
    } catch {
      if (revision !== this.revision) return this.current;
      this.session = undefined;
      ++this.revision;
      return this.update({
        status: "error",
        message:
          "SDK wallet is disconnected, unavailable, or no longer on PREPROD. Rebuild the session after checking the network.",
      });
    }
  }

  disconnect(notify = true): void {
    ++this.revision;
    this.session = undefined;
    if (notify) {
      this.update({ status: "disconnected" });
    }
  }
}

function assertSdkSessionShape(
  session: WalletSdkSession,
): asserts session is WalletSdkSession {
  if (
    !session ||
    typeof session !== "object" ||
    typeof session.unshieldedAddress !== "string" ||
    session.unshieldedAddress.length === 0 ||
    typeof session.networkId !== "string"
  ) {
    throw new LockedWalletError(UNSUPPORTED_SDK_SESSION);
  }
  // A window.midnight InitialAPI is the wrong handle for this connector.
  if (
    typeof (session as unknown as InitialAPI).connect === "function" &&
    typeof (session as unknown as InitialAPI).apiVersion === "string"
  ) {
    throw new Error(
      "Pass a wallet-SDK session to MidnightWalletSdkConnector.connect. Use LaceWalletConnector for window.midnight InitialAPI values.",
    );
  }
}
