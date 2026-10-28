import { describe, expect, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { ChainError } from "./errors";
// Shared fixtures live in private-state.test.ts, which already hosts `fakeIdb`
// for the same reason: six modules declared byte-identical copies.
import { bytes32, CONFIG, SHIELDED, terms } from "./private-state.test";
import {
  type ChainSession,
  callOrderCircuit,
  decodeOrderState,
  deployOrderContract,
  joinOrderContract,
  openChainSession,
  withProofRetry,
} from "./runtime";

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

/**
 * V-05: the proof server answers `429 JobQueueFull` when its worker pool is
 * saturated, and the docs say to wait and retry. The installed provider retries
 * `[500, 503]` but not `429`, so a busy server looked permanent. These drive the
 * wrapper directly, with no network and no proof server.
 */
describe("proof-server queue-full retry", () => {
  const queueFull = () =>
    new Error(
      'Failed Proof Server response: url="http://127.0.0.1:6300/prove", code="429", status="Too Many Requests"',
    );

  test("a 429 is retried and the next success is returned", async () => {
    let calls = 0;
    const result = await withProofRetry(async () => {
      calls += 1;
      if (calls < 2) throw queueFull();
      return "proved";
    });
    expect(result).toBe("proved");
    expect(calls).toBe(2);
  });

  test("the retry budget is bounded, so a wedged server still fails", async () => {
    let calls = 0;
    await expect(
      withProofRetry(async () => {
        calls += 1;
        throw queueFull();
      }),
    ).rejects.toThrow("429");
    expect(calls).toBe(3);
  });

  test("a non-429 failure is rethrown untouched and not retried", async () => {
    let calls = 0;
    await expect(
      withProofRetry(async () => {
        calls += 1;
        throw new Error('code="400", status="Bad Request"');
      }),
    ).rejects.toThrow("400");
    expect(calls).toBe(1);
  });

  test("a body-level JobQueueFull message is also retried", async () => {
    let calls = 0;
    const result = await withProofRetry(async () => {
      calls += 1;
      if (calls < 2) throw new Error("Job Queue full");
      return 1;
    });
    expect(result).toBe(1);
    expect(calls).toBe(2);
  });
});
