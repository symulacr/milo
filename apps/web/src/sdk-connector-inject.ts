import type { InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  type WalletSdkSession,
  walletSdkInitialApi,
} from "../../../packages/midnight-client/src/wallet-sdk-connector";

const SDK_CONNECTOR_RDNS = "network.midnight.wallet-sdk";
export const MIDNIGHT_REGISTRY_EVENT = "milo:midnight-registry";

type SdkConnectorHandle = {
  inject: typeof injectSdkConnector;
  clear: typeof clearSdkConnector;
  rdns: string;
};

declare global {
  interface Window {
    __MILO_SDK_CONNECTOR__?: SdkConnectorHandle;
  }
}

export function injectSdkConnector(
  session: WalletSdkSession,
  options: { rdns?: string; name?: string } = {},
): void {
  if (typeof window === "undefined")
    throw new Error("SDK connector injection requires a browser window");
  const api = walletSdkInitialApi(session, {
    rdns: options.rdns ?? SDK_CONNECTOR_RDNS,
    name: options.name ?? "Midnight Wallet SDK (injected)",
  });
  if (!window.midnight) window.midnight = {};
  window.midnight[api.rdns] = api;
  window.dispatchEvent(new Event(MIDNIGHT_REGISTRY_EVENT));
}

function clearSdkConnector(rdns: string = SDK_CONNECTOR_RDNS): void {
  if (typeof window === "undefined") return;
  delete window.midnight?.[rdns];
  window.dispatchEvent(new Event(MIDNIGHT_REGISTRY_EVENT));
}

export function installSdkConnectorHandle(): void {
  window.__MILO_SDK_CONNECTOR__ = {
    inject: injectSdkConnector,
    clear: clearSdkConnector,
    rdns: SDK_CONNECTOR_RDNS,
  };
}

export type { InitialAPI, SdkConnectorHandle };
