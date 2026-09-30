/**
 * Demo/E2E-only wallet-SDK connector injection.
 *
 * Production must never ship this module: `main.tsx` loads it behind
 * `process.env.NODE_ENV !== "production"` and Bun.build defines NODE_ENV to
 * `"production"`, so the dynamic import is eliminated from the prod bundle.
 * The public entry (`public-main.tsx`) never reaches this file at all
 * (demo-boundary.test.tsx).
 *
 * Labels: "VERIFIED via SDK connector" is NOT "VERIFIED with Lace".
 */

import type { InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  type WalletSdkSession,
  walletSdkInitialApi,
} from "../../../packages/midnight-client/src/wallet-sdk-connector";

export const SDK_CONNECTOR_RDNS = "network.midnight.wallet-sdk";

type SdkConnectorHandle = {
  inject: (
    session: WalletSdkSession,
    options?: { rdns?: string; name?: string },
  ) => void;
  clear: () => void;
  rdns: string;
};

declare global {
  interface Window {
    __MILO_SDK_CONNECTOR__?: SdkConnectorHandle;
  }
}

/** Register a wallet-SDK session as a discoverable window.midnight InitialAPI. */
export function injectSdkConnector(
  session: WalletSdkSession,
  options: { rdns?: string; name?: string } = {},
): void {
  if (typeof window === "undefined") {
    throw new Error("SDK connector injection requires a browser window");
  }
  const api = walletSdkInitialApi(session, {
    rdns: options.rdns ?? SDK_CONNECTOR_RDNS,
    name: options.name ?? "Midnight Wallet SDK (injected)",
  });
  if (!window.midnight) window.midnight = {};
  window.midnight[api.rdns] = api;
}

export function clearSdkConnector(rdns: string = SDK_CONNECTOR_RDNS): void {
  if (typeof window === "undefined") return;
  delete window.midnight?.[rdns];
}

/** Stable handle for E2E/Playwright: window.__MILO_SDK_CONNECTOR__. */
export function installSdkConnectorHandle(): void {
  if (typeof window === "undefined") return;
  const handle: SdkConnectorHandle = {
    inject: injectSdkConnector,
    clear: clearSdkConnector,
    rdns: SDK_CONNECTOR_RDNS,
  };
  window.__MILO_SDK_CONNECTOR__ = handle;
}

export type { InitialAPI, SdkConnectorHandle };
