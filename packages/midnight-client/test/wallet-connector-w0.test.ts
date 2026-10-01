/**
 * W0 — injected test connector surface (dapp-connector v4).
 * Not a Lace confirmation. Production bundle must not include this.
 */
import { describe, expect, test } from "bun:test";
import {
  walletSdkInitialApi,
  walletSdkStatusApi,
} from "../src/wallet-sdk-connector";

const session = {
  networkId: "preprod" as const,
  unshieldedAddress: "mn_addr_preprod1w0test",
  getConnectionStatus: async () => ({
    status: "connected" as const,
    networkId: "preprod" as const,
  }),
  getConfiguration: async () => ({
    networkId: "preprod",
    indexerUri: "",
    indexerWsUri: "",
    substrateNodeUri: "",
  }),
};

describe("W0 test connector", () => {
  test("walletSdkInitialApi is discoverable InitialAPI v4", () => {
    const api = walletSdkInitialApi(session);
    expect(api.apiVersion).toMatch(/^4\./);
    expect(typeof api.connect).toBe("function");
  });

  test("connect returns status values from the session", async () => {
    const api = walletSdkInitialApi(session);
    const connected = await api.connect("preprod");
    const status = await (
      connected as {
        getConnectionStatus: () => Promise<{ networkId: string }>;
      }
    ).getConnectionStatus();
    expect(status.networkId).toBe("preprod");
  });

  test("wrong network fails closed", async () => {
    const api = walletSdkInitialApi({
      ...session,
      networkId: "mainnet" as never,
    });
    await expect(api.connect("preprod")).rejects.toThrow();
  });

  test("status API surfaces unshielded address", async () => {
    const st = walletSdkStatusApi(session);
    const addr = await st.getUnshieldedAddress();
    expect(addr.unshieldedAddress).toBe("mn_addr_preprod1w0test");
  });
});
