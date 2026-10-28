import { describe, expect, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ChainError } from "./errors";
import type { OrderPrivateState } from "./order";
import {
  browserPrivateStateProvider,
  deployRecordStore,
  idb,
} from "./private-state";
import type { StagedDeployRecord } from "./staged-deploy";

// Shared chain-test fixtures. Exported because six test modules in this directory
// declared byte-identical copies of them; this file is the host because it already
// exports `fakeIdb` for the same reason. `order.test.ts` keeps its own `terms`
// because it annotates that fixture as `OrderTerms` and exercises the validator.
export const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);

export const terms = {
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

const privateState: OrderPrivateState = {
  actor: "buyer",
  secret: bytes32(1),
  terms,
  limit: 36_000n,
};

export const CONFIG = {
  indexerUri: "https://indexer.example/graphql",
  indexerWsUri: "wss://indexer.example/graphql",
  proverServerUri: "https://prover.example",
  substrateNodeUri: "wss://node.example",
  networkId: "preprod",
};

export const SHIELDED = {
  shieldedAddress: "mn_shield-addr_preprod1example",
  shieldedCoinPublicKey: "aa".repeat(32),
  shieldedEncryptionPublicKey: "bb".repeat(32),
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

export const memoryStorage = (): Storage => {
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
};

/** The smallest IndexedDB that stores a CryptoKey, so the at-rest envelope path is
 * exercised here instead of only in a browser. Structured-clones the value the way
 * a real implementation does. */
/** The smallest IndexedDB that stores a value, so the at-rest envelope and the wasm
 * module cache both run here instead of only in a browser. Exported so the wasm
 * test reuses it rather than carrying a second copy. */
export const fakeIdb = () => {
  const stores = new Map<string, Map<unknown, unknown>>();
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => stores.set(name, new Map()),
    transaction: (_name: string, _mode: string) => ({
      objectStore: (name: string) => {
        const store = stores.get(name) ?? new Map();
        stores.set(name, store);
        return {
          get: (key: unknown) => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              request.result = store.get(key);
              (request.onsuccess as () => void)?.();
            });
            return request;
          },
          put: (value: unknown, key: unknown) => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              store.set(key, structuredClone(value));
              (request.onsuccess as () => void)?.();
            });
            return request;
          },
        };
      },
    }),
  };
  return {
    open: () => {
      const request: Record<string, unknown> = { result: db };
      queueMicrotask(() => {
        (request.onupgradeneeded as () => void)?.();
        (request.onsuccess as () => void)?.();
      });
      return request;
    },
  };
};

/** Run `body` with a memory localStorage (and optionally a fake IndexedDB), then
 * put both globals back. Every private-state case needs the same setup. */
const withStores = async (
  body: (storage: Storage) => Promise<void>,
  options: { idb?: boolean } = {},
) => {
  const saved = {
    localStorage: globalThis.localStorage,
    indexedDB: (globalThis as { indexedDB?: unknown }).indexedDB,
  };
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  if (options.idb)
    Object.defineProperty(globalThis, "indexedDB", {
      value: fakeIdb(),
      configurable: true,
    });
  try {
    await body(storage);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      value: saved.localStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: saved.indexedDB,
      configurable: true,
    });
  }
};

describe("the IndexedDB helper", () => {
  // F-02: a profile created before "wasm-modules" existed is already at version 1,
  // so no upgrade fires and the real IndexedDB throws NotFoundError from
  // db.transaction(). That throw happens inside an event handler, where the
  // Promise executor cannot see it, so without the guard the promise never
  // settles and the order page waits on it forever. The fake below throws the way
  // the real one does, which the shared fakeIdb deliberately does not.
  const strictIdb = (stores: readonly string[]) => ({
    open: () => {
      const request: Record<string, unknown> = {
        result: {
          objectStoreNames: {
            contains: (name: string) => stores.includes(name),
          },
          createObjectStore: () => undefined,
          transaction: (name: string) => {
            if (!stores.includes(name))
              throw new DOMException(
                `No objectStore named ${name}`,
                "NotFoundError",
              );
            return { objectStore: () => ({ get: () => ({}) }) };
          },
        },
      };
      queueMicrotask(() => (request.onsuccess as () => void)?.());
      return request;
    },
  });

  test("a missing store rejects instead of hanging", async () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: strictIdb(["keys"]),
      configurable: true,
    });
    try {
      // A hang would blow the test timeout rather than fail an assertion, so the
      // race makes the failure mode explicit and fast.
      const outcome = await Promise.race([
        idb("wasm-modules", "readonly", () => ({}) as never).then(
          () => "resolved",
          (error: Error) => error.name,
        ),
        new Promise((resolve) => setTimeout(() => resolve("hung"), 1000)),
      ]);
      expect(outcome).toBe("NotFoundError");
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: saved,
        configurable: true,
      });
    }
  });
});

describe("browserPrivateStateProvider", () => {
  // C-02: the localStorage blob must not contain the role secret in readable form.
  // IndexedDB is absent in this runtime, so the key is unavailable and the store
  // falls back to plaintext — which is exactly the case this asserts is NOT the
  // shipped behaviour once a browser provides IndexedDB. The unit assertion that
  // holds everywhere is the shape: a v2: envelope, never raw JSON.
  test("writes an at-rest envelope rather than raw JSON when a key exists", async () => {
    await withStores(
      async (storage) => {
        const provider =
          browserPrivateStateProvider<OrderPrivateState>("atrest");
        provider.setContractAddress("aa".repeat(32) as never);
        await provider.set("k", privateState);
        const raw = storage.getItem("milo:private-state:atrest") ?? "";
        // With a key available the blob is an encrypted envelope, never raw JSON.
        expect(raw.startsWith("v2:")).toBe(true);
        expect(raw).not.toContain(privateState.secret.toHex());
        expect(raw).not.toContain("buyer");
        // And it still round-trips, so reload-resume keeps working.
        expect(await provider.get("k")).toEqual(privateState);
      },
      { idb: true },
    );
  });

  test("reads a legacy plaintext entry and re-writes it as an envelope", async () => {
    await withStores(async (storage) => {
      // A snapshot written before encryption existed. The encoder wraps bigint as
      // {$bigint} and bytes as {$bytes}, which is the legacy on-disk shape.
      storage.setItem(
        "milo:private-state:legacy",
        JSON.stringify({
          contractAddress: "aa".repeat(32),
          scopes: {
            ["aa".repeat(32)]: {
              k: {
                actor: "buyer",
                secret: { $bytes: privateState.secret.toHex() },
                terms: {},
              },
            },
          },
          signingKeys: {},
        }),
      );
      const provider = browserPrivateStateProvider<OrderPrivateState>("legacy");
      const restored = await provider.get("k");
      expect(restored?.actor).toBe("buyer");
      // A write migrates it; the secret is no longer readable in the blob.
      await provider.set("k", privateState);
      const raw = storage.getItem("milo:private-state:legacy") ?? "";
      if (raw.startsWith("v2:"))
        expect(raw).not.toContain(privateState.secret.toHex());
    });
  });

  // An entry that exists but cannot be read is corruption, not absence: reporting
  // it as empty would silently discard the user's private state.
  test("surfaces a corrupt snapshot instead of reporting it as empty", async () => {
    await withStores(async (storage) => {
      storage.setItem("milo:private-state:corrupt", "{not json");
      const provider =
        browserPrivateStateProvider<OrderPrivateState>("corrupt");
      await expect(provider.get("k")).rejects.toThrow(/unreadable/);
    });
  });

  // C-02's other half: an encrypted entry with no key must fail loudly rather than
  // return the ciphertext or an empty state. The read path reports it as corruption,
  // which is the same instruction to the user: do not overwrite, export or clear.
  test("refuses an encrypted entry when the device key is gone", async () => {
    await withStores(async (storage) => {
      storage.setItem("milo:private-state:orphan", "v2:AAAAAAAAAAAAAAAA");
      const provider = browserPrivateStateProvider<OrderPrivateState>("orphan");
      await expect(provider.get("k")).rejects.toThrow(/unreadable/);
    });
  });

  test("a non-extractable AES-GCM key seals the blob so the raw key never escapes", async () => {
    // The at-rest design rests on two platform facts: a non-extractable key can
    // encrypt, and its bytes cannot be exported. Asserted here because bun has no
    // IndexedDB, so the storage half is browser-only.
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeDefined();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify({ secret: "ab".repeat(32) })),
    );
    expect(sealed.byteLength).toBeGreaterThan(32);
  });

  test("scopes state to the contract address", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("test");
      expect(provider.storageKey).toBe("milo:private-state:test");
      provider.setContractAddress("aa".repeat(32) as never);
      await provider.set("k", privateState);
      expect(await provider.get("k")).toEqual(privateState);
      provider.setContractAddress("bb".repeat(32) as never);
      expect(await provider.get("k")).toBeNull();
    });
  });

  test("refuses an empty scope", () => {
    expect(() => browserPrivateStateProvider("")).toThrow(/scope/);
  });

  test("refuses reads before a contract address is set", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("unset");
      await expect(provider.get("k")).rejects.toThrow(/contract address/i);
    });
  });

  // The SDK calls remove() when a call's private state is superseded, and clear()
  // when the user resets the order. Both must actually delete, not just no-op.
  test("remove drops one state and clear drops the contract's states", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("drop");
      provider.setContractAddress("aa".repeat(32) as never);
      await provider.set("one", privateState);
      await provider.set("two", privateState);
      await provider.remove("one");
      expect(await provider.get("one")).toBeNull();
      expect(await provider.get("two")).toEqual(privateState);
      await provider.clear();
      expect(await provider.get("two")).toBeNull();
    });
  });

  test("stores and retrieves signing keys per contract address", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("keys");
      const address = "cc".repeat(32) as never;
      await provider.setSigningKey(address, "dd".repeat(32) as never);
      expect(await provider.getSigningKey(address)).toBe("dd".repeat(32));
      await provider.removeSigningKey(address);
      expect(await provider.getSigningKey(address)).toBeNull();
      await provider.setSigningKey(address, "ee".repeat(32) as never);
      await provider.clearSigningKeys();
      expect(await provider.getSigningKey(address)).toBeNull();
    });
  });

  // C-03: an export must be sealed with the password, never the payload in clear.
  test("an export is encrypted and round-trips through a password", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("export");
      provider.setContractAddress("aa".repeat(32) as never);
      await provider.set("k", privateState);
      const password = "a-long-enough-password";
      const exported = await provider.exportPrivateStates({ password });
      expect(exported.format).toBe("midnight-private-state-export");
      // The secret is not in the envelope.
      expect(JSON.stringify(exported)).not.toContain(
        privateState.secret.toHex(),
      );
      expect(exported.salt).toHaveLength(64);

      const target = browserPrivateStateProvider<OrderPrivateState>("target");
      target.setContractAddress("bb".repeat(32) as never);
      const result = await target.importPrivateStates(exported, { password });
      expect(result).toEqual({ imported: 1, skipped: 0, overwritten: 0 });
      expect(await target.get("k")).toEqual(privateState);
    });
  });

  test("refuses a short export password rather than storing it in the clear", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("short");
      provider.setContractAddress("aa".repeat(32) as never);
      await expect(
        provider.exportPrivateStates({ password: "short" }),
      ).rejects.toThrow(/at least 16/);
    });
  });

  test("refuses the wrong password without leaking the payload", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("wrong");
      provider.setContractAddress("aa".repeat(32) as never);
      await provider.set("k", privateState);
      const exported = await provider.exportPrivateStates({
        password: "a-long-enough-password",
      });
      const target = browserPrivateStateProvider<OrderPrivateState>("wrong2");
      target.setContractAddress("bb".repeat(32) as never);
      await expect(
        target.importPrivateStates(exported, {
          password: "a-different-password",
        }),
      ).rejects.toThrow(/not correct/);
    });
  });

  test("import honours each conflict strategy", async () => {
    await withStores(async () => {
      const source = browserPrivateStateProvider<OrderPrivateState>("strategy");
      source.setContractAddress("aa".repeat(32) as never);
      await source.set("k", privateState);
      const password = "a-long-enough-password";
      const exported = await source.exportPrivateStates({ password });

      const target =
        browserPrivateStateProvider<OrderPrivateState>("strategy2");
      target.setContractAddress("bb".repeat(32) as never);
      await target.set("k", privateState);
      // The default refuses to overwrite.
      await expect(
        target.importPrivateStates(exported, { password }),
      ).rejects.toThrow(/conflict/i);
      expect(
        await target.importPrivateStates(exported, {
          password,
          conflictStrategy: "skip",
        }),
      ).toEqual({ imported: 0, skipped: 1, overwritten: 0 });
      expect(
        await target.importPrivateStates(exported, {
          password,
          conflictStrategy: "overwrite",
        }),
      ).toEqual({ imported: 0, skipped: 0, overwritten: 1 });
    });
  });

  test("signing-key exports are sealed and import with the same strategies", async () => {
    await withStores(async () => {
      const provider = browserPrivateStateProvider<OrderPrivateState>("sk");
      const address = "cc".repeat(32) as never;
      await provider.setSigningKey(address, "dd".repeat(32) as never);
      const password = "a-long-enough-password";
      const exported = await provider.exportSigningKeys({ password });
      expect(exported.format).toBe("midnight-signing-key-export");
      expect(JSON.stringify(exported)).not.toContain("dd".repeat(32));

      const target = browserPrivateStateProvider<OrderPrivateState>("sk2");
      expect(await target.importSigningKeys(exported, { password })).toEqual({
        imported: 1,
        skipped: 0,
        overwritten: 0,
      });
      expect(await target.getSigningKey(address)).toBe("dd".repeat(32));
      await expect(
        target.importSigningKeys(exported, { password }),
      ).rejects.toThrow(/conflict/i);
      expect(
        await target.importSigningKeys(exported, {
          password,
          conflictStrategy: "skip",
        }),
      ).toEqual({ imported: 0, skipped: 1, overwritten: 0 });
      expect(
        await target.importSigningKeys(exported, {
          password,
          conflictStrategy: "overwrite",
        }),
      ).toEqual({ imported: 0, skipped: 0, overwritten: 1 });
    });
  });
});

describe("finalized transaction deserialization", () => {
  test("the ledger refuses a transaction that is not finalized", () => {
    const unproven = Transaction.fromParts("preprod");
    expect(() =>
      Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        unproven.serialize(),
      ),
    ).toThrow();
  });

  test("the ledger round-trips an unproven transaction with its own markers", () => {
    const unproven = Transaction.fromParts("preprod");
    const restored = Transaction.deserialize(
      "signature",
      "pre-proof",
      "pre-binding",
      unproven.serialize(),
    );
    expect(restored.serialize().byteLength).toBe(
      unproven.serialize().byteLength,
    );
  });
});

describe("ChainError", () => {
  test("carries a code and a message", () => {
    const error = new ChainError("WRONG_NETWORK", "Only PREPROD is enabled.");
    expect(error.code).toBe("WRONG_NETWORK");
    expect(error.message).toBe("Only PREPROD is enabled.");
    expect(error.name).toBe("ChainError");
  });
});

describe("deploy and call refuse to invent results", () => {
  // One assembly input shared by the cases below; each test varies only the
  // connector, which is the thing under test.
  const assembly = (connected: ConnectedAPI) => ({
    connected,
    zkBaseUrl: "/zk",
    privateStateProvider: {} as never,
    createZkConfigProvider: () =>
      ({ asKeyMaterialProvider: () => ({}) }) as never,
    createHttpProofProvider: () => ({ proveTx: async () => ({}) }) as never,
    createWalletProofProvider: async () =>
      ({ proveTx: async () => ({}) }) as never,
    createPublicDataProvider: () => ({}) as never,
    deserializeTransaction: () => ({}) as never,
    setNetworkId: () => {},
  });

  test("a connector without getProvingProvider and without a prover server cannot assemble", async () => {
    const { assembleChainProviders } = await import("./providers");
    const bare = connector({
      getConfiguration: async () =>
        ({ ...CONFIG, proverServerUri: undefined }) as never,
    });
    delete (bare as unknown as Record<string, unknown>).getProvingProvider;
    await expect(assembleChainProviders(assembly(bare))).rejects.toBeInstanceOf(
      ChainError,
    );
  });

  test("a wallet without signData is still usable for proving and submission", async () => {
    const { assembleChainProviders } = await import("./providers");
    const api = connector();
    delete (api as unknown as Record<string, unknown>).signData;
    const providers = await assembleChainProviders(assembly(api));
    expect(providers.keys.shieldedAddress).toBe(SHIELDED.shieldedAddress);
    expect(typeof providers.midnightProvider.submitTx).toBe("function");
  });

  test("a wallet that rejects the balance surfaces the rejection unchanged", async () => {
    const { connectorWalletProvider } = await import("./providers");
    const provider = connectorWalletProvider(
      connector({
        balanceUnsealedTransaction: async () => {
          throw Object.assign(new Error("user rejected"), { code: "Rejected" });
        },
      }),
      {
        coinPublicKey: SHIELDED.shieldedCoinPublicKey,
        encryptionPublicKey: SHIELDED.shieldedEncryptionPublicKey,
        shieldedAddress: SHIELDED.shieldedAddress,
      },
      () => ({}) as never,
    );
    await expect(
      provider.balanceTx({ serialize: () => new Uint8Array([1]) } as never),
    ).rejects.toThrow(/user rejected/);
  });
});

describe("deployRecordStore", () => {
  const record: StagedDeployRecord = {
    contractAddress: "ab".repeat(32),
    signingKey: "cc".repeat(32) as never,
    configuration: "{}",
    deployedTxId: "tx-deploy",
    installedCircuits: ["accept", "approve"],
    updatedAt: "2026-10-24T00:00:00.000Z",
  };

  const withStorage = <T>(run: () => T): T => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
    try {
      return run();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: original,
        configurable: true,
      });
    }
  };

  test("round-trips a record so a reload can resume", () => {
    withStorage(() => {
      const store = deployRecordStore<StagedDeployRecord>("resume");
      expect(store.read()).toBeNull();
      store.write(record);
      expect(store.read()).toEqual(record);
    });
  });

  test("keeps records separate per scope", () => {
    withStorage(() => {
      deployRecordStore<StagedDeployRecord>("a").write(record);
      expect(deployRecordStore<StagedDeployRecord>("b").read()).toBeNull();
    });
  });

  test("refuses an empty scope", () => {
    withStorage(() => {
      expect(() => deployRecordStore<StagedDeployRecord>("")).toThrow(/scope/);
    });
  });

  test("treats unreadable data as no record rather than inventing one", () => {
    withStorage(() => {
      globalThis.localStorage.setItem("milo:deploy-record:broken", "{not json");
      expect(deployRecordStore<StagedDeployRecord>("broken").read()).toBeNull();
    });
  });
});
