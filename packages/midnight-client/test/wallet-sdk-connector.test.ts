import { describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "@midnight-ntwrk/dapp-connector-api";
import { LockedWalletError, RejectedSignatureError } from "../src/errors.ts";
import type { WalletConnectionState } from "../src/wallet.ts";
import {
  MidnightWalletSdkConnector,
  type WalletSdkSession,
  walletSdkConnectedApi,
  walletSdkInitialApi,
  walletSdkStatusApi,
} from "../src/wallet-sdk-connector.ts";

const ADDRESS = "mn_addr_preprod1q5connectorcoverage";

function session(overrides: Partial<WalletSdkSession> = {}): WalletSdkSession {
  return {
    networkId: "preprod",
    unshieldedAddress: ADDRESS,
    ...overrides,
  };
}

function connectedStatus(
  overrides: Partial<ConnectionStatus> = {},
): ConnectionStatus {
  return {
    status: "connected",
    networkId: "preprod",
    ...overrides,
  } as ConnectionStatus;
}

const configuration = {
  networkId: "preprod",
  indexerUri: "https://indexer.example.invalid",
  indexerWsUri: "wss://indexer.example.invalid",
  substrateNodeUri: "https://node.example.invalid",
};

describe("walletSdkStatusApi", () => {
  test("refuses a handle that is not an SDK session", () => {
    for (const handle of [
      undefined,
      null,
      "session",
      42,
      {},
      { unshieldedAddress: 42 },
    ]) {
      expect(() => walletSdkStatusApi(handle as never)).toThrow(
        LockedWalletError,
      );
    }
  });

  test("reports connected on the constructor network when the session has no live status", async () => {
    const api = walletSdkStatusApi(session({ networkId: "preprod" }));
    expect(await api.getConnectionStatus()).toEqual({
      status: "connected",
      networkId: "preprod",
    });
    expect(await api.getUnshieldedAddress()).toEqual({
      unshieldedAddress: ADDRESS,
    });
  });

  test("the default status view echoes the session network rather than PREPROD", async () => {
    const api = walletSdkStatusApi(session({ networkId: "mainnet" }));
    expect(await api.getConnectionStatus()).toEqual({
      status: "connected",
      networkId: "mainnet",
    });
  });

  test("delegates to the session's live status when it reports one", async () => {
    const seen: string[] = [];
    const api = walletSdkStatusApi(
      session({
        getConnectionStatus: async () => {
          seen.push("status");
          return { status: "disconnected" } as const;
        },
      }),
    );
    expect(await api.getConnectionStatus()).toEqual({
      status: "disconnected",
    });
    expect(seen).toEqual(["status"]);
  });

  test("delegates to the session's live configuration when it reports one", async () => {
    const api = walletSdkStatusApi(
      session({ getConfiguration: async () => configuration }),
    );
    expect(await api.getConfiguration()).toEqual(configuration);
  });

  test("a session without service endpoints gets empty URIs, never invented endpoints", async () => {
    const api = walletSdkStatusApi(session());
    const config = await api.getConfiguration();
    expect(config).toEqual({
      networkId: "preprod",
      indexerUri: "",
      indexerWsUri: "",
      substrateNodeUri: "",
    });
  });
});

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
] as const;

describe("walletSdkConnectedApi", () => {
  test("is status plus account only; every wallet method throws by name", () => {
    const api = walletSdkConnectedApi(session()) as unknown as Record<
      string,
      () => unknown
    >;
    for (const method of UNSUPPORTED_METHODS) {
      expect(typeof api[method]).toBe("function");
      expect(() => api[method]()).toThrow(RejectedSignatureError);
      expect(() => api[method]()).toThrow(
        `does not expose ${method}. Signing, balancing, and submission belong`,
      );
    }
  });

  test("hintUsage is advisory, resolves, and never prompts", async () => {
    const api = walletSdkConnectedApi(session());
    expect(await api.hintUsage(["getConnectionStatus"])).toBeUndefined();
    expect(await api.hintUsage([])).toBeUndefined();
  });

  test("the status and account methods are the session's own", async () => {
    const api = walletSdkConnectedApi(
      session({
        getConnectionStatus: async () => connectedStatus(),
        getConfiguration: async () => configuration,
      }),
    );
    expect(await api.getConnectionStatus()).toEqual({
      status: "connected",
      networkId: "preprod",
    });
    expect(await api.getConfiguration()).toEqual(configuration);
    expect(await api.getUnshieldedAddress()).toEqual({
      unshieldedAddress: ADDRESS,
    });
  });

  test("an invalid handle is refused before any API object is built", () => {
    expect(() => walletSdkConnectedApi(undefined as never)).toThrow(
      LockedWalletError,
    );
  });
});

describe("walletSdkInitialApi", () => {
  test("advertises a discoverable API v4 identity with the default rdns and name", () => {
    const api = walletSdkInitialApi(session());
    expect(api.apiVersion).toBe("4.0.1");
    expect(api.rdns).toBe("network.midnight.wallet-sdk");
    expect(api.name).toBe("Midnight Wallet SDK");
    expect(typeof api.icon).toBe("string");
  });

  test("the injection overrides replace the advertised identity", () => {
    const api = walletSdkInitialApi(session(), {
      rdns: "network.midnight.injected",
      name: "Injected",
    });
    expect(api.rdns).toBe("network.midnight.injected");
    expect(api.name).toBe("Injected");
  });

  test("connect refuses a requested network other than PREPROD", async () => {
    for (const networkId of ["mainnet", "undeployed", "", "PREPROD"]) {
      await expect(
        walletSdkInitialApi(session()).connect(networkId),
      ).rejects.toThrow(/Unsupported Midnight network/);
    }
  });

  test("connect refuses a PREPROD request bound to a non-PREPROD session", async () => {
    await expect(
      walletSdkInitialApi(session({ networkId: "mainnet" })).connect("preprod"),
    ).rejects.toThrow(/Unsupported Midnight network/);
  });

  test("connect returns a working ConnectedAPI over PREPROD", async () => {
    const api = walletSdkInitialApi(
      session({
        getConnectionStatus: async () => connectedStatus(),
        getConfiguration: async () => configuration,
      }),
    );
    const connected = await api.connect("preprod");
    expect(await connected.getUnshieldedAddress()).toEqual({
      unshieldedAddress: ADDRESS,
    });
    expect(
      (connected as unknown as Record<string, () => unknown>).getDustAddress,
    ).toBeTypeOf("function");
  });

  test("connect fails closed on a missing session, though not with the typed error", async () => {
    let caught: unknown;
    try {
      await walletSdkInitialApi(undefined as never).connect("preprod");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toMatch(/session\.networkId/);
  });
});

function recorder() {
  const states: WalletConnectionState[] = [];
  return {
    states,
    onState: (state: WalletConnectionState) => {
      states.push(state);
    },
  };
}

describe("MidnightWalletSdkConnector.connect", () => {
  test("starts disconnected and never notifies before the first call", () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    expect(connector.state).toEqual({ status: "disconnected" });
    expect(states).toEqual([]);
  });

  test("no handle at all is an error state, not a connection", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    const state = await connector.connect(undefined);
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toContain(
      "No wallet-SDK session was supplied",
    );
    expect(states.map((s) => s.status)).toEqual(["error"]);
    expect(connector.state).toBe(state);
  });

  test("a verified PREPROD session connects and surfaces only its unshielded address", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    const state = await connector.connect(
      session({
        getConnectionStatus: async () => connectedStatus(),
        getConfiguration: async () => configuration,
      }),
    );
    expect(state).toEqual({
      status: "connected",
      networkId: "preprod",
      account: { unshieldedAddress: ADDRESS },
    });
    expect(states).toEqual([
      { status: "connecting" },
      {
        status: "connected",
        networkId: "preprod",
        account: { unshieldedAddress: ADDRESS },
      },
    ]);
  });

  test("a bare session with no live methods still verifies PREPROD end to end", async () => {
    const connector = new MidnightWalletSdkConnector();
    expect((await connector.connect(session())).status).toBe("connected");
  });

  test("fails closed when the session reports a status other than connected", async () => {
    for (const status of [
      { status: "disconnected" },
      { status: "connecting" },
    ]) {
      const connector = new MidnightWalletSdkConnector();
      const state = await connector.connect(
        session({
          getConnectionStatus: async () => status as ConnectionStatus,
        }),
      );
      expect(state.status).toBe("error");
      expect(state.status === "error" && state.message).toBe(
        "SDK wallet connection not established. The session is unavailable, disconnected, or its network is not PREPROD. Mainnet is blocked.",
      );
    }
  });

  test("fails closed on a non-PREPROD status network", async () => {
    const connector = new MidnightWalletSdkConnector();
    const state = await connector.connect(
      session({
        getConnectionStatus: async () =>
          connectedStatus({ networkId: "mainnet" }),
      }),
    );
    expect(state.status).toBe("error");
    expect(connector.state.status).toBe("error");
  });

  test("fails closed when status says PREPROD but the configuration does not", async () => {
    const reached: string[] = [];
    const connector = new MidnightWalletSdkConnector();
    const state = await connector.connect(
      session({
        getConnectionStatus: async () => {
          reached.push("status");
          return connectedStatus();
        },
        getConfiguration: async () => {
          reached.push("configuration");
          return { ...configuration, networkId: "mainnet" };
        },
      }),
    );
    expect(reached).toEqual(["status", "configuration"]);
    expect(state.status).toBe("error");
  });

  test("fails closed when the session address is absent or not a string", async () => {
    for (const unshieldedAddress of ["", undefined, 7, null]) {
      const connector = new MidnightWalletSdkConnector();
      const state = await connector.connect({
        networkId: "preprod",
        unshieldedAddress,
        getConnectionStatus: async () => connectedStatus(),
        getConfiguration: async () => configuration,
      } as never);
      expect(state.status).toBe("error");
    }
  });

  test("a whitespace-only address is surfaced verbatim, matching LaceWalletConnector", async () => {
    const connector = new MidnightWalletSdkConnector();
    const state = await connector.connect(session({ unshieldedAddress: " " }));
    expect(state).toEqual({
      status: "connected",
      networkId: "preprod",
      account: { unshieldedAddress: " " },
    });
  });

  test("the address guard reads the session address, not a separate getter", async () => {
    let reads = 0;
    const connector = new MidnightWalletSdkConnector();
    const state = await connector.connect({
      networkId: "preprod",
      get unshieldedAddress() {
        reads += 1;
        return reads <= 3 ? ADDRESS : "";
      },
    } as never);
    expect(reads).toBeGreaterThan(1);
    expect(state.status).toBe("error");
  });

  test("refuses a window.midnight InitialAPI handed to the SDK connector", async () => {
    const connector = new MidnightWalletSdkConnector();
    const state = await connector.connect({
      rdns: "network.midnight.lace",
      name: "Lace",
      icon: "data:,",
      apiVersion: "4.0.1",
      connect: async () => walletSdkConnectedApi(session()),
    } as never);
    expect(state.status).toBe("error");
    expect(connector.state.status).toBe("error");
  });

  test("refuses structurally invalid sessions before any provider call", async () => {
    let called = 0;
    for (const handle of [
      "session",
      42,
      {},
      { unshieldedAddress: ADDRESS },
      { networkId: "preprod" },
      { networkId: "preprod", unshieldedAddress: "" },
      { networkId: 7, unshieldedAddress: ADDRESS },
    ]) {
      const connector = new MidnightWalletSdkConnector();
      const state = await connector.connect({
        ...(handle as object),
        getConnectionStatus: async () => {
          called += 1;
          return connectedStatus();
        },
      } as never);
      expect(state.status).toBe("error");
    }
    expect(called).toBe(0);
  });

  test("a rejected provider call is redacted into the generic refusal", async () => {
    const connector = new MidnightWalletSdkConnector();
    const state = await connector.connect(
      session({
        getConnectionStatus: async () => {
          throw new Error("wallet vendor secret stack pi_12345");
        },
      }),
    );
    expect(state.status === "error" && state.message).not.toContain("pi_12345");
    expect(state.status === "error" && state.message).toContain(
      "Mainnet is blocked.",
    );
  });

  test("the newest connect wins; a slow earlier one cannot overwrite it", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = connector.connect(
      session({
        unshieldedAddress: "mn_addr_preprod1slow",
        getConnectionStatus: async () => {
          await gate;
          return connectedStatus();
        },
      }),
    );
    const fast = await connector.connect(
      session({ unshieldedAddress: "mn_addr_preprod1fast" }),
    );
    release?.();
    expect(await slow).toEqual(fast);
    expect(states.filter((s) => s.status === "connected")).toEqual([
      {
        status: "connected",
        networkId: "preprod",
        account: { unshieldedAddress: "mn_addr_preprod1fast" },
      },
    ]);
  });

  test("a disconnect during an in-flight connect wins over the late success", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = connector.connect(
      session({
        getConnectionStatus: async () => {
          await gate;
          return connectedStatus();
        },
      }),
    );
    connector.disconnect();
    release?.();
    expect(await pending).toEqual({ status: "disconnected" });
    expect(states.at(-1)).toEqual({ status: "disconnected" });
    expect(states.some((s) => s.status === "connected")).toBe(false);
  });
});

describe("MidnightWalletSdkConnector.refresh", () => {
  test("refresh with no remembered session is a no-op", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    expect(await connector.refresh()).toEqual({ status: "disconnected" });
    expect(states).toEqual([]);
  });

  test("refresh re-reads the remembered session and reports a rotated address", async () => {
    const { states, onState } = recorder();
    const live: { networkId: string; unshieldedAddress: string } = {
      networkId: "preprod",
      unshieldedAddress: ADDRESS,
    };
    const connector = new MidnightWalletSdkConnector(onState);
    await connector.connect(live);
    live.unshieldedAddress = "mn_addr_preprod1rotated";
    const state = await connector.refresh();
    expect(state).toEqual({
      status: "connected",
      networkId: "preprod",
      account: { unshieldedAddress: "mn_addr_preprod1rotated" },
    });
    expect(states.at(-1)).toEqual(state);
  });

  test("a refresh that finds the wallet dropped forgets the session", async () => {
    let status: ConnectionStatus = connectedStatus();
    const connector = new MidnightWalletSdkConnector();
    await connector.connect(
      session({ getConnectionStatus: async () => status }),
    );
    status = { status: "disconnected" };
    const state = await connector.refresh();
    expect(state.status === "error" && state.message).toBe(
      "SDK wallet is disconnected, unavailable, or no longer on PREPROD. Rebuild the session after checking the network.",
    );
    expect(connector.state).toBe(state);
    expect(await connector.refresh()).toBe(state);
  });

  test("a refresh that finds a network change forgets the session", async () => {
    let networkId = "preprod";
    const connector = new MidnightWalletSdkConnector();
    await connector.connect(
      session({
        getConnectionStatus: async () => connectedStatus({ networkId }),
        getConfiguration: async () => ({ ...configuration, networkId }),
      }),
    );
    networkId = "mainnet";
    expect((await connector.refresh()).status).toBe("error");
    expect(await connector.refresh()).toEqual({
      status: "error",
      message:
        "SDK wallet is disconnected, unavailable, or no longer on PREPROD. Rebuild the session after checking the network.",
    });
  });

  test("a refresh that finds the address gone forgets the session", async () => {
    const live: { networkId: string; unshieldedAddress: string } = {
      networkId: "preprod",
      unshieldedAddress: ADDRESS,
    };
    const connector = new MidnightWalletSdkConnector();
    await connector.connect(live);
    live.unshieldedAddress = "";
    expect((await connector.refresh()).status).toBe("error");
  });

  test("a refresh that throws is redacted, not surfaced raw", async () => {
    const connector = new MidnightWalletSdkConnector();
    await connector.connect(
      session({
        getConnectionStatus: async () => {
          throw new Error("cus_secretstack_12345");
        },
      }),
    );
    const state = await connector.refresh();
    expect(state.status === "error" && state.message).not.toContain(
      "cus_secretstack_12345",
    );
  });

  test("a disconnect during an in-flight refresh wins over the late success", async () => {
    const { states, onState } = recorder();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const connector = new MidnightWalletSdkConnector(onState);
    await connector.connect(
      session({
        getConnectionStatus: async () => {
          calls += 1;
          if (calls === 1) return connectedStatus();
          await gate;
          return connectedStatus();
        },
      }),
    );
    const pending = connector.refresh();
    connector.disconnect();
    release?.();
    expect(await pending).toEqual({ status: "disconnected" });
    expect(states.filter((s) => s.status === "connected")).toHaveLength(1);
    expect(states.at(-1)).toEqual({ status: "disconnected" });
  });
});

describe("MidnightWalletSdkConnector.disconnect", () => {
  test("disconnect clears the session and reports disconnected", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    await connector.connect(session());
    connector.disconnect();
    expect(connector.state).toEqual({ status: "disconnected" });
    expect(states.at(-1)).toEqual({ status: "disconnected" });
    expect(await connector.refresh()).toEqual({ status: "disconnected" });
  });

  test("disconnect(false) forgets the session without notifying", async () => {
    const { states, onState } = recorder();
    const connector = new MidnightWalletSdkConnector(onState);
    await connector.connect(session());
    states.length = 0;
    connector.disconnect(false);
    expect(states).toEqual([]);
    expect(connector.state.status).toBe("connected");
    expect(await connector.refresh()).toEqual({
      status: "connected",
      networkId: "preprod",
      account: { unshieldedAddress: ADDRESS },
    });
  });

  test("a reconnect after disconnect verifies again rather than trusting memory", async () => {
    let networkId = "preprod";
    const connector = new MidnightWalletSdkConnector();
    await connector.connect(session({ networkId }));
    connector.disconnect();
    networkId = "mainnet";
    expect((await connector.connect(session({ networkId }))).status).toBe(
      "error",
    );
  });
});
