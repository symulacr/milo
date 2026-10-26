import { describe, expect, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { ChainError } from "./errors";
import {
  type ChainSession,
  callOrderCircuit,
  decodeOrderState,
  deployOrderContract,
  joinOrderContract,
  openChainSession,
} from "./runtime";

const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);

const terms = {
  serviceVersion: 1n,
  packQuantity: 1n,
  outputCount: 3n,
  unitPrice: 36_000n,
  total: 36_000n,
  currency: new TextEncoder().encode("USD"),
  scopeDigest: bytes32(4),
  rightsDigest: bytes32(5),
  paymentPolicy: bytes32(6),
  salt: bytes32(7),
};

const CONFIG = {
  indexerUri: "https://indexer.example/graphql",
  indexerWsUri: "wss://indexer.example/graphql",
  proverServerUri: "https://prover.example",
  substrateNodeUri: "wss://node.example",
  networkId: "preprod",
};

const SHIELDED = {
  shieldedAddress: "mn_shield-addr_preprod1example",
  shieldedCoinPublicKey: "aa".repeat(32),
  shieldedEncryptionPublicKey: "bb".repeat(32),
};

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

function withStorage<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  });
  return run().finally(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      configurable: true,
    });
  });
}

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

const sessionFor = (connected: ConnectedAPI): Promise<ChainSession> =>
  openChainSession({
    connected,
    zkBaseUrl: "/zk",
    privateStateScope: "test-scope",
  });

describe("openChainSession", () => {
  test("assembles a session from the wallet's own configuration", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      expect(session.networkId).toBe("preprod");
      expect(session.providers.keys.coinPublicKey).toBe(
        SHIELDED.shieldedCoinPublicKey,
      );
      expect(session.providers.keys.encryptionPublicKey).toBe(
        SHIELDED.shieldedEncryptionPublicKey,
      );
      expect(session.compiledContract.tag).toBe("milo");
      expect(Object.keys(session.providers).sort()).toEqual([
        "keys",
        "midnightProvider",
        "networkId",
        "privateStateProvider",
        "proofProvider",
        "publicDataProvider",
        "walletProvider",
        "zkConfigProvider",
      ]);
    });
  });

  // Speed: the network id is already read during assembly, so asking the wallet a
  // second time is one avoidable round-trip on every session open.
  test("opens a session with a single wallet configuration read", async () => {
    await withStorage(async () => {
      let reads = 0;
      const session = await sessionFor(
        connector({
          getConfiguration: async () => {
            reads += 1;
            return CONFIG;
          },
        }),
      );
      expect(reads).toBe(1);
      expect(session.networkId).toBe("preprod");
    });
  });

  test("refuses a mainnet wallet with a clear network error", async () => {
    await withStorage(async () => {
      await expect(
        sessionFor(
          connector({
            getConfiguration: async () =>
              ({ ...CONFIG, networkId: "mainnet" }) as never,
          }),
        ),
      ).rejects.toMatchObject({ code: "WRONG_NETWORK" });
    });
  });

  test("refuses a wallet that cannot prove", async () => {
    await withStorage(async () => {
      const bare = connector({
        getConfiguration: async () =>
          ({ ...CONFIG, proverServerUri: undefined }) as never,
      });
      delete (bare as unknown as Record<string, unknown>).getProvingProvider;
      await expect(sessionFor(bare)).rejects.toMatchObject({
        code: "MISSING_PROOF_SERVER",
      });
    });
  });
});

describe("deployOrderContract", () => {
  test("refuses an invalid configuration before touching the wallet", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        deployOrderContract({
          session,
          configuration: {
            network: bytes32(0),
            orderNonce: bytes32(1),
            termsCommitment: bytes32(2),
            buyerCommitment: bytes32(3),
            merchantCommitment: bytes32(3),
            operatorCommitment: bytes32(9),
            acceptanceDeadline: 1_000n,
            deliveryDeadline: 2_000n,
            reviewDeadline: 3_000n,
            resolutionDeadline: 4_000n,
          },
          privateState: {
            actor: "buyer",
            secret: bytes32(1),
            terms,
            limit: 36_000n,
          },
        }),
      ).rejects.toThrow(/must differ/);
    });
  });

  test("refuses invalid private state before touching the wallet", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        deployOrderContract({
          session,
          configuration: {
            network: bytes32(0),
            orderNonce: bytes32(1),
            termsCommitment: bytes32(2),
            buyerCommitment: bytes32(3),
            merchantCommitment: bytes32(8),
            operatorCommitment: bytes32(9),
            acceptanceDeadline: 1_000n,
            deliveryDeadline: 2_000n,
            reviewDeadline: 3_000n,
            resolutionDeadline: 4_000n,
          },
          privateState: {
            actor: "buyer",
            secret: new Uint8Array(31),
            terms,
            limit: 36_000n,
          },
        }),
      ).rejects.toThrow(/32 bytes/);
    });
  });
});

describe("callOrderCircuit", () => {
  test("refuses an unknown circuit without submitting anything", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        callOrderCircuit({
          session,
          contractAddress: "00".repeat(32),
          circuit: "teleport" as never,
          expectedRevision: 0n,
        }),
      ).rejects.toBeInstanceOf(ChainError);
    });
  });

  test("refuses a missing commitment for submitDelivery", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        callOrderCircuit({
          session,
          contractAddress: "00".repeat(32),
          circuit: "submitDelivery",
          expectedRevision: 1n,
        }),
      ).rejects.toThrow(/commitment must be 32 bytes/);
    });
  });

  test("refuses a missing decision for resolve", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        callOrderCircuit({
          session,
          contractAddress: "00".repeat(32),
          circuit: "resolve",
          expectedRevision: 1n,
          evidence: bytes32(1),
        }),
      ).rejects.toThrow(/approveOrder/);
    });
  });

  test("refuses a negative revision for every circuit", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        callOrderCircuit({
          session,
          contractAddress: "00".repeat(32),
          circuit: "reserve",
          expectedRevision: -1n,
        }),
      ).rejects.toThrow(/Uint<64>/);
    });
  });
});

describe("decodeOrderState", () => {
  test("refuses a state it cannot read instead of inventing a phase", () => {
    expect(() => decodeOrderState({} as never)).toThrow();
  });
});

describe("joinOrderContract", () => {
  test("refuses invalid private state before touching the chain", async () => {
    await withStorage(async () => {
      const session = await sessionFor(connector());
      await expect(
        joinOrderContract({
          session,
          contractAddress: "00".repeat(32),
          privateState: {
            actor: "buyer",
            secret: new Uint8Array(31),
            terms,
            limit: 36_000n,
          },
        }),
      ).rejects.toThrow(/32 bytes/);
    });
  });
});
