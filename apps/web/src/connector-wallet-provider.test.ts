import { describe, expect, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  connectorSupportsSignedReserve,
  connectorWalletProvider,
  WalletProviderUnavailableError,
} from "./connector-wallet-provider";

const SHIELDED = {
  shieldedAddress: "mn_shield-addr_preprod1example",
  shieldedCoinPublicKey: "mn_shield-cpk_preprod1coin",
  shieldedEncryptionPublicKey: "mn_shield-epk_preprod1enc",
};

/** A connector stub exposing only what a test needs. */
function connector(overrides: Partial<ConnectedAPI> = {}): ConnectedAPI {
  return {
    getShieldedAddresses: async () => SHIELDED,
    balanceUnsealedTransaction: async (tx: string) => ({
      tx: `${tx}-balanced`,
    }),
    submitTransaction: async () => undefined,
    ...overrides,
  } as unknown as ConnectedAPI;
}

describe("connectorWalletProvider", () => {
  test("reports the wallet's coin and encryption keys", async () => {
    const provider = await connectorWalletProvider(connector());
    expect(provider.getCoinPublicKey()).toBe(SHIELDED.shieldedCoinPublicKey);
    expect(provider.getEncryptionPublicKey()).toBe(
      SHIELDED.shieldedEncryptionPublicKey,
    );
    expect(provider.shieldedAddress).toBe(SHIELDED.shieldedAddress);
  });

  test("balances through balanceUnsealedTransaction and returns the wallet's tx", async () => {
    const seen: string[] = [];
    const provider = await connectorWalletProvider(
      connector({
        balanceUnsealedTransaction: async (tx: string) => {
          seen.push(tx);
          return { tx: "balanced-1" };
        },
      }),
    );
    const out = await provider.balanceTx("unsealed-1");
    expect(seen).toEqual(["unsealed-1"]);
    expect(out).toBe("balanced-1");
  });

  test("refuses a wallet without getShieldedAddresses", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>).getShieldedAddresses;
    await expect(connectorWalletProvider(api)).rejects.toBeInstanceOf(
      WalletProviderUnavailableError,
    );
  });

  test("refuses a wallet without balanceUnsealedTransaction", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>)
      .balanceUnsealedTransaction;
    await expect(connectorWalletProvider(api)).rejects.toBeInstanceOf(
      WalletProviderUnavailableError,
    );
  });

  test("refuses an incomplete shielded address record", async () => {
    await expect(
      connectorWalletProvider(
        connector({
          getShieldedAddresses: async () =>
            ({ shieldedAddress: "a" }) as unknown as typeof SHIELDED,
        }),
      ),
    ).rejects.toBeInstanceOf(WalletProviderUnavailableError);
  });

  test("refuses a non-string transaction rather than guessing at a conversion", async () => {
    const provider = await connectorWalletProvider(connector());
    await expect(
      provider.balanceTx({ not: "a string" }),
    ).rejects.toBeInstanceOf(WalletProviderUnavailableError);
  });

  test("surfaces the wallet's balancing failure instead of swallowing it", async () => {
    const provider = await connectorWalletProvider(
      connector({
        balanceUnsealedTransaction: async () => {
          throw new Error("InsufficientFunds: could not balance dust");
        },
      }),
    );
    await expect(provider.balanceTx("unsealed-1")).rejects.toThrow(
      /could not balance the transaction: InsufficientFunds/,
    );
  });

  test("refuses an empty balanced transaction", async () => {
    const provider = await connectorWalletProvider(
      connector({
        balanceUnsealedTransaction: async () => ({ tx: "" }),
      }),
    );
    await expect(provider.balanceTx("unsealed-1")).rejects.toBeInstanceOf(
      WalletProviderUnavailableError,
    );
  });
});

describe("connectorSupportsSignedReserve", () => {
  test("reports support when every required method exists", async () => {
    await expect(connectorSupportsSignedReserve(connector())).resolves.toEqual({
      supported: true,
    });
  });

  for (const method of [
    "getShieldedAddresses",
    "balanceUnsealedTransaction",
    "submitTransaction",
  ] as const) {
    test(`reports unsupported when ${method} is missing`, async () => {
      const api = connector();
      delete (api as unknown as Record<string, unknown>)[method];
      const verdict = await connectorSupportsSignedReserve(api);
      expect(verdict.supported).toBe(false);
      expect(verdict.reason).toContain(method);
    });
  }

  test("reports unsupported when the wallet omits the public keys", async () => {
    const verdict = await connectorSupportsSignedReserve(
      connector({
        getShieldedAddresses: async () =>
          ({ shieldedAddress: "a" }) as unknown as typeof SHIELDED,
      }),
    );
    expect(verdict.supported).toBe(false);
  });

  test("reports unsupported when the wallet throws", async () => {
    const verdict = await connectorSupportsSignedReserve(
      connector({
        getShieldedAddresses: async () => {
          throw new Error("wallet locked");
        },
      }),
    );
    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain("wallet locked");
  });
});
