import { describe, expect, mock, test } from "bun:test";
import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { connectionErrorMessage } from "./Connections";
import {
  discoverLaceWallets,
  LaceConnection,
  type LaceState,
  loadPublicConfig,
} from "./connection-runtime";

function wallet(network = "preprod", configuredNetwork = network) {
  const status = mock(async () => ({
    status: "connected" as const,
    networkId: network,
  }));
  const configuration = mock(async () => ({ networkId: configuredNetwork }));
  // Deliberately omit signing, balances and addresses: this diagnostic must never call them.
  const api = {
    getConnectionStatus: status,
    getConfiguration: configuration,
  } as unknown as ConnectedAPI;
  const connect = mock(async (_network: string) => api);
  return { api, connect, status, configuration };
}
function session() {
  const states: LaceState[] = [];
  return {
    states,
    connection: new LaceConnection((state) => states.push(state)),
  };
}

describe("read-only PREPROD Lace", () => {
  test("missing extension never reports connected", async () => {
    expect(discoverLaceWallets(undefined)).toEqual([]);
    const { connection, states } = session();
    await connection.connect(undefined);
    expect(states.at(-1)?.status).toBe("error");
  });
  test("unsupported API is not used", () => {
    expect(
      discoverLaceWallets({
        mnLace: {
          apiVersion: "3.0.0",
          connect: mock(),
        } as unknown as InitialAPI,
      }),
    ).toEqual([]);
  });
  test("enumeration finds v4 wallets under arbitrary injection keys (01 §3.4.2)", () => {
    const v4 = {
      rdns: "network.midnight.lace",
      name: "Lace",
      apiVersion: "4.1.0",
      connect: mock(),
    } as unknown as InitialAPI;
    const other = {
      rdns: "com.example.other",
      name: "Other",
      apiVersion: "4.0.0",
      connect: mock(),
    } as unknown as InitialAPI;
    const found = discoverLaceWallets({
      "6f2c4d44-uuid-key": v4,
      unrelated: { apiVersion: "3.0.0", connect: mock() },
      "9a1b2c3d-another-uuid": other,
    } as unknown as Window["midnight"]);
    expect(found).toEqual([v4, other]);
  });
  test("connect passes preprod and checks status and configuration", async () => {
    const fake = wallet();
    const { connection, states } = session();
    await connection.connect(fake);
    expect(fake.connect).toHaveBeenCalledWith("preprod");
    expect(fake.status).toHaveBeenCalledTimes(1);
    expect(fake.configuration).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.status).toBe("connected");
  });
  for (const [statusNetwork, configNetwork] of [
    ["mainnet", "mainnet"],
    ["preprod", "mainnet"],
    ["preview", "preview"],
  ]) {
    test(`rejects status ${statusNetwork} / config ${configNetwork}`, async () => {
      const { connection, states } = session();
      await connection.connect(wallet(statusNetwork, configNetwork));
      expect(states.at(-1)?.status).toBe("error");
      expect(states.some((state) => state.status === "connected")).toBe(false);
    });
  }
  test("user rejection is not success and provider errors are not exposed", async () => {
    const { connection, states } = session();
    await connection.connect({
      connect: async () => {
        throw new Error("sensitive provider diagnostic");
      },
    });
    expect(states.at(-1)?.status).toBe("error");
    expect(JSON.stringify(states)).not.toContain("sensitive");
  });
  test("forget clears the handle and does not pretend to revoke wallet authorization", async () => {
    const fake = wallet();
    const { connection, states } = session();
    await connection.connect(fake);
    connection.disconnect();
    await connection.refresh();
    expect(fake.status).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.status).toBe("disconnected");
    expect(states.at(-1)?.message).toContain("Revoke site permission in Lace");
  });
  test("forget during pending consent cannot resurrect the connection", async () => {
    const fake = wallet();
    let resolve!: (api: ConnectedAPI) => void;
    const { connection, states } = session();
    const pending = connection.connect({
      connect: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    connection.disconnect();
    resolve(fake.api);
    await pending;
    expect(states.at(-1)?.status).toBe("disconnected");
  });
  test("network changes fail closed on refresh", async () => {
    const fake = wallet();
    const { connection, states } = session();
    await connection.connect(fake);
    fake.status.mockImplementation(async () => ({
      status: "connected",
      networkId: "mainnet",
    }));
    await connection.refresh();
    expect(states.at(-1)?.status).toBe("error");
  });
  test("extension disconnect is detected", async () => {
    const fake = wallet();
    const { connection, states } = session();
    await connection.connect(fake);
    fake.api.getConnectionStatus = async () => ({ status: "disconnected" });
    await connection.refresh();
    expect(states.at(-1)?.status).toBe("error");
  });
  test("forget during an in-flight status check cannot restore connected state", async () => {
    const fake = wallet();
    const { connection, states } = session();
    await connection.connect(fake);
    let resolve!: (status: { status: "connected"; networkId: string }) => void;
    fake.api.getConnectionStatus = () =>
      new Promise((done) => {
        resolve = done;
      });
    const pending = connection.refresh();
    connection.disconnect();
    resolve({ status: "connected", networkId: "preprod" });
    await pending;
    expect(states.at(-1)?.status).toBe("disconnected");
  });
});

describe("runtime public configuration", () => {
  function request(body: unknown, status = 200) {
    return mock(async () =>
      Response.json(body, { status }),
    ) as unknown as typeof fetch;
  }
  test("nullable and omitted providers stay unconfigured", async () => {
    expect(
      await loadPublicConfig(
        undefined,
        request({
          privyAppId: null,
          convexUrl: null,
          midnightNetwork: "preprod",
        }),
      ),
    ).toEqual({
      privyAppId: null,
      convexUrl: null,
      midnightNetwork: "preprod",
    });
    expect(
      (
        await loadPublicConfig(
          undefined,
          request({ midnightNetwork: "preprod" }),
        )
      ).privyAppId,
    ).toBeUndefined();
  });
  test("only approved public fields are accepted", async () => {
    await expect(
      loadPublicConfig(
        undefined,
        request({ midnightNetwork: "preprod", secret: "not-public" }),
      ),
    ).rejects.toThrow("invalid");
  });
  test("configuration is fetched from the same origin without caching", async () => {
    const controller = new AbortController();
    const fetchConfig = request({ midnightNetwork: "preprod" });
    await loadPublicConfig(controller.signal, fetchConfig);
    expect(fetchConfig).toHaveBeenCalledWith("/api/public-config", {
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  });
  test("mainnet and bad URLs fail closed", async () => {
    await expect(
      loadPublicConfig(undefined, request({ midnightNetwork: "mainnet" })),
    ).rejects.toThrow("PREPROD");
    await expect(
      loadPublicConfig(
        undefined,
        request({
          midnightNetwork: "preprod",
          convexUrl: "https://attacker.example",
        }),
      ),
    ).rejects.toThrow("invalid");
  });
  test("server and malformed JSON failures never fabricate defaults", async () => {
    await expect(loadPublicConfig(undefined, request({}, 500))).rejects.toThrow(
      "unavailable",
    );
    await expect(
      loadPublicConfig(undefined, async () => new Response("not json")),
    ).rejects.toThrow();
  });
});

describe("diagnostics error copy split (C-A-14)", () => {
  test("an aborted fetch surfaces the timeout copy", () => {
    const cause = new DOMException("The operation was aborted", "AbortError");
    expect(connectionErrorMessage(cause)).toContain(
      "timed out after 15 seconds",
    );
  });
  test("other failures keep the invalid-configuration copy", () => {
    expect(connectionErrorMessage(new Error("invalid"))).toContain(
      "could not be loaded or is invalid",
    );
  });
});
