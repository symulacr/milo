import { describe, expect, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { ChainError } from "./errors";
import {
  assembleChainProviders,
  assertDustAvailable,
  type ChainProviderInput,
  connectorMidnightProvider,
  connectorWalletProvider,
  decodeHex,
  encodeHex,
  readWalletConfig,
  readWalletKeys,
} from "./providers";

const SHIELDED = {
  shieldedAddress: "mn_shield-addr_preprod1example",
  shieldedCoinPublicKey: "aa".repeat(32),
  shieldedEncryptionPublicKey: "bb".repeat(32),
};

const CONFIG = {
  indexerUri: "https://indexer.example/graphql",
  indexerWsUri: "wss://indexer.example/graphql",
  proverServerUri: "https://prover.example",
  substrateNodeUri: "wss://node.example",
  networkId: "preprod",
};

function connector(overrides: Partial<ConnectedAPI> = {}): ConnectedAPI {
  return {
    getShieldedAddresses: async () => SHIELDED,
    getConfiguration: async () => CONFIG,
    balanceUnsealedTransaction: async (tx: string) => ({ tx }),
    submitTransaction: async () => undefined,
    getProvingProvider: async () => ({}) as never,
    ...overrides,
  } as unknown as ConnectedAPI;
}

/** The same wallet with the proving method absent, as Lace before 2.1.0 is. */
function withoutProving(api: ConnectedAPI): ConnectedAPI {
  delete (api as unknown as Record<string, unknown>).getProvingProvider;
  return api;
}

/** A wallet that reports a DUST balance, as the connector's getDustBalance does. */
function withDust(balance: bigint): ConnectedAPI {
  return connector({
    getDustBalance: async () => ({ balance, cap: 10n ** 15n }),
  } as never);
}

describe("assertDustAvailable", () => {
  // A fresh Preprod wallet holds 0 DUST for ~12 h. Catching that here is the
  // difference between a clear message and BalanceCheckOverspend after proving.
  test("refuses a wallet with no DUST before any signing step", async () => {
    await expect(assertDustAvailable(withDust(0n))).rejects.toMatchObject({
      code: "INSUFFICIENT_DUST",
    });
  });

  test("accepts a wallet with DUST", async () => {
    await expect(assertDustAvailable(withDust(1n))).resolves.toBeUndefined();
  });

  test("does not invent a balance for a wallet that cannot report one", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>).getDustBalance;
    await expect(assertDustAvailable(api)).resolves.toBeUndefined();
  });
});

const tx = (bytes: Uint8Array) =>
  ({
    serialize: () => bytes,
    identifiers: () => ["tx-1"],
  }) as never;

describe("hex helpers", () => {
  test("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(encodeHex(bytes)).toBe("00010f10ff");
    expect(Array.from(decodeHex("00010f10ff"))).toEqual([0, 1, 15, 16, 255]);
  });

  test("accepts a 0x prefix", () => {
    expect(Array.from(decodeHex("0x00ff"))).toEqual([0, 255]);
  });

  test("refuses an odd number of nibbles", () => {
    expect(() => decodeHex("abc")).toThrow(ChainError);
  });

  test("refuses non-hex characters", () => {
    expect(() => decodeHex("zz")).toThrow(ChainError);
  });

  test("refuses empty input", () => {
    expect(() => decodeHex("")).toThrow(ChainError);
  });
});

describe("readWalletKeys", () => {
  test("reports the wallet's coin and encryption keys", async () => {
    const keys = await readWalletKeys(connector());
    expect(keys.coinPublicKey).toBe(SHIELDED.shieldedCoinPublicKey);
    expect(keys.encryptionPublicKey).toBe(SHIELDED.shieldedEncryptionPublicKey);
    expect(keys.shieldedAddress).toBe(SHIELDED.shieldedAddress);
  });

  test("refuses a wallet without getShieldedAddresses", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>).getShieldedAddresses;
    await expect(readWalletKeys(api)).rejects.toBeInstanceOf(ChainError);
  });

  test("refuses an incomplete shielded address record", async () => {
    await expect(
      readWalletKeys(
        connector({
          getShieldedAddresses: async () =>
            ({ shieldedAddress: "a" }) as unknown as typeof SHIELDED,
        }),
      ),
    ).rejects.toBeInstanceOf(ChainError);
  });
});

describe("readWalletConfig", () => {
  const withNetwork = (networkId: string) =>
    connector({
      getConfiguration: async () => ({ ...CONFIG, networkId }) as never,
    });

  test("reads the wallet's indexer and proving endpoints", async () => {
    const config = await readWalletConfig(connector());
    expect(config.indexerUri).toBe(CONFIG.indexerUri);
    expect(config.indexerWsUri).toBe(CONFIG.indexerWsUri);
    expect(config.proverServerUri).toBe(CONFIG.proverServerUri);
    expect(config.networkId).toBe("preprod");
  });

  test("accepts the casing each wallet reports for preprod", async () => {
    for (const id of ["PreProd", "PREPROD", " preprod "])
      expect((await readWalletConfig(withNetwork(id))).networkId).toBe(
        "preprod",
      );
  });

  test("refuses a non-preprod network", async () => {
    for (const id of ["mainnet", "Mainnet", "preview", "undeployed"])
      await expect(readWalletConfig(withNetwork(id))).rejects.toThrow(
        /PREPROD/,
      );
  });

  test("refuses a configuration without indexer endpoints", async () => {
    await expect(
      readWalletConfig(
        connector({
          getConfiguration: async () =>
            ({ ...CONFIG, indexerUri: "" }) as never,
        }),
      ),
    ).rejects.toBeInstanceOf(ChainError);
  });

  test("refuses a wallet without getConfiguration", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>).getConfiguration;
    await expect(readWalletConfig(api)).rejects.toBeInstanceOf(ChainError);
  });
});

describe("connectorWalletProvider", () => {
  test("balances through balanceUnsealedTransaction and deserializes the result", async () => {
    const seen: string[] = [];
    const provider = connectorWalletProvider(
      connector({
        balanceUnsealedTransaction: async (value: string) => {
          seen.push(value);
          return { tx: "0a0b" };
        },
      }),
      {
        coinPublicKey: SHIELDED.shieldedCoinPublicKey,
        encryptionPublicKey: SHIELDED.shieldedEncryptionPublicKey,
        shieldedAddress: SHIELDED.shieldedAddress,
      },
      (bytes) => tx(bytes),
    );
    const result = (await provider.balanceTx(
      tx(new Uint8Array([1, 2])),
    )) as unknown as { serialize(): Uint8Array };
    expect(seen).toEqual(["0102"]);
    expect(Array.from(result.serialize())).toEqual([10, 11]);
  });

  test("reports the wallet's public keys", () => {
    const provider = connectorWalletProvider(
      connector(),
      {
        coinPublicKey: SHIELDED.shieldedCoinPublicKey,
        encryptionPublicKey: SHIELDED.shieldedEncryptionPublicKey,
        shieldedAddress: SHIELDED.shieldedAddress,
      },
      (bytes) => tx(bytes),
    );
    expect(provider.getCoinPublicKey()).toBe(SHIELDED.shieldedCoinPublicKey);
    expect(provider.getEncryptionPublicKey()).toBe(
      SHIELDED.shieldedEncryptionPublicKey,
    );
  });

  test("refuses a wallet without balanceUnsealedTransaction", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>)
      .balanceUnsealedTransaction;
    const provider = connectorWalletProvider(
      api,
      {
        coinPublicKey: SHIELDED.shieldedCoinPublicKey,
        encryptionPublicKey: SHIELDED.shieldedEncryptionPublicKey,
        shieldedAddress: SHIELDED.shieldedAddress,
      },
      (bytes) => tx(bytes),
    );
    await expect(
      provider.balanceTx(tx(new Uint8Array([1]))),
    ).rejects.toBeInstanceOf(ChainError);
  });

  test("refuses an empty balanced transaction", async () => {
    const provider = connectorWalletProvider(
      connector({ balanceUnsealedTransaction: async () => ({ tx: "" }) }),
      {
        coinPublicKey: SHIELDED.shieldedCoinPublicKey,
        encryptionPublicKey: SHIELDED.shieldedEncryptionPublicKey,
        shieldedAddress: SHIELDED.shieldedAddress,
      },
      (bytes) => tx(bytes),
    );
    await expect(
      provider.balanceTx(tx(new Uint8Array([1]))),
    ).rejects.toBeInstanceOf(ChainError);
  });
});

describe("connectorMidnightProvider", () => {
  test("submits the sealed transaction and returns its identifier", async () => {
    const seen: string[] = [];
    const provider = connectorMidnightProvider(
      connector({
        submitTransaction: async (value: string) => {
          seen.push(value);
        },
      }),
    );
    const txId = await provider.submitTx(tx(new Uint8Array([3, 4])));
    expect(seen).toEqual(["0304"]);
    expect(txId).toBe("tx-1");
  });

  test("refuses a wallet without submitTransaction", async () => {
    const api = connector();
    delete (api as unknown as Record<string, unknown>).submitTransaction;
    const provider = connectorMidnightProvider(api);
    await expect(
      provider.submitTx(tx(new Uint8Array([1]))),
    ).rejects.toBeInstanceOf(ChainError);
  });

  test("refuses a transaction with no identifier", async () => {
    const provider = connectorMidnightProvider(connector());
    await expect(
      provider.submitTx({
        serialize: () => new Uint8Array([1]),
        identifiers: () => [],
      } as never),
    ).rejects.toBeInstanceOf(ChainError);
  });
});

function input(
  overrides: Partial<ChainProviderInput<unknown>> = {},
): ChainProviderInput<unknown> {
  return {
    connected: connector(),
    zkBaseUrl: "/zk",
    privateStateProvider: {} as never,
    createZkConfigProvider: () =>
      ({ asKeyMaterialProvider: () => ({}) }) as never,
    createHttpProofProvider: () => ({ proveTx: async () => ({}) }) as never,
    createWalletProofProvider: async () =>
      ({ proveTx: async () => ({}) }) as never,
    createPublicDataProvider: () => ({}) as never,
    deserializeTransaction: (bytes) => tx(bytes),
    setNetworkId: () => {},
    ...overrides,
  };
}

describe("assembleChainProviders", () => {
  // The proving path is chosen by capability, never by wallet identity: a
  // wallet that exposes getProvingProvider proves through itself (1AM), and one
  // that does not falls back to the prover server it reports (Lace).
  const proof = { proveTx: async () => ({}) } as never;

  test("delegates proving to the wallet when it exposes a proving provider", async () => {
    let usedWalletProving = false;
    let usedHttp = false;
    let keyMaterialAsked = false;
    const providers = await assembleChainProviders(
      input({
        createWalletProofProvider: async (_api, zkConfigProvider) => {
          usedWalletProving = true;
          keyMaterialAsked = Boolean(zkConfigProvider.asKeyMaterialProvider());
          return proof;
        },
        createHttpProofProvider: () => {
          usedHttp = true;
          return proof;
        },
      }),
    );
    expect(usedWalletProving).toBe(true);
    expect(keyMaterialAsked).toBe(true);
    expect(usedHttp).toBe(false);
    expect(providers.proofProvider).toBeDefined();
  });

  test("falls back to the wallet's prover server when it has no proving provider", async () => {
    let usedUrl: string | undefined;
    const providers = await assembleChainProviders(
      input({
        connected: withoutProving(connector()),
        createHttpProofProvider: (url) => {
          usedUrl = url;
          return proof;
        },
      }),
    );
    expect(usedUrl).toBe(CONFIG.proverServerUri);
    expect(providers.proofProvider).toBeDefined();
  });

  test("a wallet that exposes getProvingProvider but throws still fails loudly", async () => {
    await expect(
      assembleChainProviders(
        input({
          connected: connector({
            getProvingProvider: async () => {
              throw new Error("prover offline");
            },
          }),
          createWalletProofProvider: async (api, zk) => {
            await api.getProvingProvider(zk.asKeyMaterialProvider());
            return proof;
          },
        }),
      ),
    ).rejects.toThrow(/prover offline/);
  });

  test("refuses when there is neither a proving provider nor a prover server", async () => {
    await expect(
      assembleChainProviders(
        input({
          connected: withoutProving(
            connector({
              getConfiguration: async () =>
                ({ ...CONFIG, proverServerUri: undefined }) as never,
            }),
          ),
        }),
      ),
    ).rejects.toThrow(/no proof service/);
  });

  test("sets the network id from the wallet configuration", async () => {
    const seen: string[] = [];
    await assembleChainProviders(
      input({ setNetworkId: (networkId) => seen.push(networkId) }),
    );
    expect(seen).toEqual(["preprod"]);
  });

  test("wires the indexer endpoints the wallet reported", async () => {
    const seen: string[] = [];
    await assembleChainProviders(
      input({
        createPublicDataProvider: (query, subscription) => {
          seen.push(query, subscription);
          return {} as never;
        },
      }),
    );
    expect(seen).toEqual([CONFIG.indexerUri, CONFIG.indexerWsUri]);
  });

  test("passes the zk base url to the config provider", async () => {
    const seen: string[] = [];
    await assembleChainProviders(
      input({
        zkBaseUrl: "/zk",
        createZkConfigProvider: (baseUrl) => {
          seen.push(baseUrl);
          return { asKeyMaterialProvider: () => ({}) } as never;
        },
      }),
    );
    expect(seen).toEqual(["/zk"]);
  });

  test("returns every provider slot and the wallet keys it read once", async () => {
    const providers = await assembleChainProviders(input());
    expect(Object.keys(providers).sort()).toEqual([
      "keys",
      "midnightProvider",
      "networkId",
      "privateStateProvider",
      "proofProvider",
      "publicDataProvider",
      "walletProvider",
      "zkConfigProvider",
    ]);
    expect(providers.keys.coinPublicKey).toBe(SHIELDED.shieldedCoinPublicKey);
  });

  // Speed: the configuration carries the indexer, prover and network id, so one
  // read must serve all of them. A second read is a wallet round-trip per session.
  test("reads the wallet configuration exactly once", async () => {
    let reads = 0;
    const providers = await assembleChainProviders(
      input({
        connected: connector({
          getConfiguration: async () => {
            reads += 1;
            return CONFIG;
          },
        }),
      }),
    );
    expect(reads).toBe(1);
    expect(providers.networkId).toBe("preprod");
  });

  // Speed: the shielded keys, the DUST balance and the proving provider need only
  // the connection, so they must be in flight together. Sequential awaits made
  // session open cost three wallet round-trips instead of one.
  test("asks the wallet for keys, DUST and proving at the same time", async () => {
    let inFlight = 0;
    let peak = 0;
    const walletCall =
      <T>(value: T) =>
      async (): Promise<T> => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Three microtask hops: long enough for a concurrent caller to enter,
        // short enough that a sequential caller can never overlap.
        for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
        inFlight -= 1;
        return value;
      };
    await assembleChainProviders(
      input({
        connected: connector({
          getShieldedAddresses: walletCall(SHIELDED) as never,
          getDustBalance: walletCall({ balance: 5n, cap: 10n ** 15n }) as never,
          getProvingProvider: walletCall({}) as never,
        }),
        createWalletProofProvider: async (api, zkConfigProvider) => {
          await api.getProvingProvider(
            zkConfigProvider.asKeyMaterialProvider(),
          );
          return proof;
        },
      }),
    );
    expect(peak).toBe(3);
  });

  test("surfaces the wallet's configuration failure rather than inventing endpoints", async () => {
    await expect(
      assembleChainProviders(
        input({
          connected: connector({
            getConfiguration: async () => {
              throw new Error("wallet locked");
            },
          }),
        }),
      ),
    ).rejects.toThrow(/wallet locked/);
  });
});
