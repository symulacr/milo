import type {
  Configuration,
  ConnectedAPI,
  ConnectionStatus,
  InitialAPI,
  WalletConnectedAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { LockedWalletError, RejectedSignatureError } from "./errors.ts";
import { assertSupportedNetwork } from "./network.ts";
import { type StatusAPI, WalletConnectorBase } from "./wallet.ts";

export type WalletSdkSession = {
  readonly networkId: string;
  readonly unshieldedAddress: string;
  readonly getConnectionStatus?: () => Promise<ConnectionStatus>;
  readonly getConfiguration?: () => Promise<Configuration>;
};

const UNSUPPORTED_SDK_SESSION =
  "No wallet-SDK session was supplied. Build a session from the integration harness (testkit MidnightWalletProvider or WalletFacade) first.";
const REJECTED_SDK_CONNECTION =
  "SDK wallet connection not established. The session is unavailable, disconnected, or its network is not PREPROD. Mainnet is blocked.";
const REJECTED_SDK_REFRESH =
  "SDK wallet is disconnected, unavailable, or no longer on PREPROD. Rebuild the session after checking the network.";

export type WalletSdkStatusAPI = {
  getConnectionStatus(): Promise<ConnectionStatus>;
  getConfiguration(): Promise<Configuration>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
};

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

const UNSUPPORTED_METHODS = [
  "getShieldedBalances",
  "getUnshieldedBalances",
  "getDustBalance",
  "getShieldedAddresses",
  "getDustAddress",
  "getTxHistory",
  "balanceUnsealedTransaction",
  "balanceSealedTransaction",
  "makeTransfer",
  "makeIntent",
  "signData",
  "submitTransaction",
  "getProvingProvider",
] as const satisfies readonly (keyof WalletConnectedAPI)[];

type UnsupportedMethod = (typeof UNSUPPORTED_METHODS)[number];
type UnsupportedStubs = { [M in UnsupportedMethod]: () => never };

function unsupported(methodName: UnsupportedMethod): never {
  throw new RejectedSignatureError(
    `Midnight Wallet SDK connector does not expose ${String(methodName)}. Signing, balancing, and submission belong to the wallet's own ConnectedAPI.`,
  );
}

function unsupportedStubs(): UnsupportedStubs {
  return Object.fromEntries(
    UNSUPPORTED_METHODS.map((method) => [method, () => unsupported(method)]),
  ) as UnsupportedStubs;
}

export function walletSdkConnectedApi(session: WalletSdkSession): ConnectedAPI {
  const status = walletSdkStatusApi(session);
  return {
    ...unsupportedStubs(),
    getConnectionStatus: status.getConnectionStatus,
    getConfiguration: status.getConfiguration,
    getUnshieldedAddress: status.getUnshieldedAddress,
    async hintUsage() {},
  };
}

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

export class MidnightWalletSdkConnector extends WalletConnectorBase<WalletSdkSession> {
  protected readonly unsupportedMessage = UNSUPPORTED_SDK_SESSION;
  protected readonly rejectedMessage = REJECTED_SDK_CONNECTION;
  protected readonly refreshMessage = REJECTED_SDK_REFRESH;

  protected override async open(session: WalletSdkSession): Promise<StatusAPI> {
    assertSdkSessionShape(session);
    return walletSdkStatusApi(session);
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
  if (
    typeof (session as unknown as InitialAPI).connect === "function" &&
    typeof (session as unknown as InitialAPI).apiVersion === "string"
  ) {
    throw new Error(
      "Pass a wallet-SDK session to MidnightWalletSdkConnector.connect. Use LaceWalletConnector for window.midnight InitialAPI values.",
    );
  }
}
