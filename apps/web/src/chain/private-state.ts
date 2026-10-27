import type {
  ContractAddress,
  SigningKey,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type {
  ExportPrivateStatesOptions,
  ExportSigningKeysOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  SigningKeyExport,
} from "@midnight-ntwrk/midnight-js-types";

type BrowserPrivateStateProvider<PS> = PrivateStateProvider<
  PrivateStateId,
  PS
> & {
  readonly storageKey: string;
};

type Snapshot<PS> = {
  readonly contractAddress: string | null;
  readonly scopes: Record<string, Record<string, PS>>;
  readonly signingKeys: Record<string, SigningKey>;
};

const EMPTY = { scopes: {}, signingKeys: {} } as const;

type Encoded =
  | string
  | number
  | boolean
  | null
  | readonly Encoded[]
  | { readonly [key: string]: Encoded };

const encodeValue = (value: unknown): Encoded => {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Uint8Array) return { $bytes: value.toHex() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => [key, encodeValue(entry)] as const,
    );
    return Object.fromEntries(entries);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  throw new Error(
    `Private state contains a value of type ${typeof value} that cannot be persisted.`,
  );
};

const decodeValue = (value: Encoded): unknown => {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (typeof value === "object") {
    const record = value as Record<string, Encoded>;
    if (typeof record.$bigint === "string") return BigInt(record.$bigint);
    if (typeof record.$bytes === "string") {
      const text = record.$bytes;
      const bytes = new Uint8Array(text.length / 2);
      for (let index = 0; index < bytes.length; index += 1)
        bytes[index] = Number.parseInt(
          text.slice(index * 2, index * 2 + 2),
          16,
        );
      return bytes;
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, decodeValue(entry)]),
    );
  }
  return value;
};

const serialize = (value: unknown): string =>
  JSON.stringify(encodeValue(value));

const deserialize = <T>(text: string): T => decodeValue(JSON.parse(text)) as T;

/** The SDK contract: encryptedPayload is base64 AES-256-GCM over the JSON and salt
 * is 64 hex chars. Plaintext in that field is a silent secret leak. */
const EXPORT_ITERATIONS = 310_000;
const MIN_EXPORT_PASSWORD = 16;
const IV_BYTES = 12;

/** A snapshot that exists but cannot be read is corruption, not absence: reporting
 * it as empty silently discards the user's private state. */
class PrivateStateCorruptError extends Error {
  constructor(key: string) {
    super(
      `The stored private state at "${key}" is unreadable. It was not overwritten; export or clear it before continuing.`,
    );
    this.name = "PrivateStateCorruptError";
  }
}

/**
 * At-rest protection for the localStorage snapshot.
 *
 * A non-extractable AES-GCM key lives in IndexedDB; IndexedDB can structured-clone
 * a CryptoKey, localStorage cannot, and `extractable: false` means the raw bytes
 * never reach JavaScript. The localStorage blob becomes `v2:` + base64(iv‖ct).
 *
 * Threat model, stated honestly:
 *  - PROTECTS a copied localStorage dump, disk forensics on the profile directory,
 *    and secrets leaking through logs or error reports that print storage.
 *  - DOES NOT protect against XSS or a malicious extension running in this page:
 *    they can call the same key and read the same plaintext. Nothing in a browser
 *    can stop that, so the real defence there is CSP and not running untrusted code.
 */
const AT_REST_VERSION = "v2:";
const KEY_DB = "milo-chain";
const KEY_STORE = "keys";
const KEY_ID = "private-state";

/** One IndexedDB request as a promise; the store is created on first open. Shared
 * with the wasm module cache so there is one IndexedDB implementation. */
export const idb = <T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [KEY_STORE, "wasm-modules"])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      try {
        const done = run(
          request.result.transaction(store, mode).objectStore(store),
        );
        done.onsuccess = () => resolve(done.result as T);
        done.onerror = () => reject(done.error);
      } catch (error) {
        // A store that this database does not have (a profile created before it
        // existed never upgrades again) throws here, inside an event handler,
        // where the Promise executor cannot see it. Rejecting keeps the caller's
        // existing fallback reachable instead of waiting forever.
        reject(error);
      }
    };
  });

/** The device key, created once and never extractable. Null when IndexedDB is
 * unavailable (private mode, or a non-JS test), in which case the caller keeps
 * the previous plaintext behaviour rather than losing the data. */
const atRestKey = async (): Promise<CryptoKey | null> => {
  try {
    const existing = await idb<CryptoKey | undefined>(
      KEY_STORE,
      "readonly",
      (s) => s.get(KEY_ID),
    );
    if (existing) return existing;
    const created = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await idb(KEY_STORE, "readwrite", (s) => s.put(created, KEY_ID));
    return created;
  } catch {
    return null;
  }
};

/** AES-GCM with a random IV framed as the first 12 bytes, shared by the at-rest
 * blob and the export envelope so both use one implementation. */
const sealWith = async (key: CryptoKey, text: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(text),
    ),
  );
  const framed = new Uint8Array(IV_BYTES + sealed.length);
  framed.set(iv);
  framed.set(sealed, IV_BYTES);
  return framed.toBase64();
};

const openWith = async (key: CryptoKey, payload: string): Promise<string> => {
  const framed = Uint8Array.fromBase64(payload);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: framed.subarray(0, IV_BYTES) },
    key,
    framed.subarray(IV_BYTES),
  );
  return new TextDecoder().decode(plain);
};

const sealAtRest = async (text: string): Promise<string> => {
  const key = await atRestKey();
  if (!key) return text;
  return `${AT_REST_VERSION}${await sealWith(key, text)}`;
};

/** Open an at-rest blob. A plaintext entry (written before this change) is
 * returned as-is so the caller can migrate it on the next write. */
const openAtRest = async (stored: string): Promise<string> => {
  if (!stored.startsWith(AT_REST_VERSION)) return stored;
  const key = await atRestKey();
  if (!key) throw new PrivateStateCorruptError("(encrypted, key unavailable)");
  return openWith(key, stored.slice(AT_REST_VERSION.length));
};

/** A short password is refused, never silently stored in the clear. */
const exportPassword = (password: string | undefined): string => {
  if (typeof password !== "string" || password.length < MIN_EXPORT_PASSWORD)
    throw new Error(
      `An export password of at least ${MIN_EXPORT_PASSWORD} characters is required.`,
    );
  return password;
};

const exportKey = async (password: string, salt: Uint8Array) => {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: EXPORT_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/** Seal a payload. The IV is the first 12 payload bytes so the envelope keeps the
 * two fields the SDK types define. */
const sealExport = async (payload: unknown, password: string | undefined) => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const key = await exportKey(exportPassword(password), salt);
  // serialize() handles bigint and Uint8Array; JSON.stringify throws on bigint.
  return {
    encryptedPayload: await sealWith(key, serialize(payload)),
    salt: salt.toHex(),
  };
};

/** Open an export envelope, or throw a message that does not leak the payload. */
const openExport = async <T>(
  exportData: { encryptedPayload: string; salt: string },
  password: string | undefined,
): Promise<T> => {
  let plain: string;
  try {
    plain = await openWith(
      await exportKey(
        exportPassword(password),
        Uint8Array.fromHex(exportData.salt),
      ),
      exportData.encryptedPayload,
    );
  } catch {
    throw new Error("The export password is not correct.");
  }
  return deserialize<T>(plain);
};

const storageOf = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
};

const requireStorage = (): Storage => {
  const storage = storageOf();
  if (!storage)
    throw new Error(
      "No browser private-state store is available. Private state cannot be persisted in this context.",
    );
  return storage;
};

/** Read a snapshot, decrypting an at-rest blob when there is one. A plaintext
 * entry from before this change is returned as-is so the next write migrates it. */
const readSnapshot = async <PS>(key: string): Promise<Snapshot<PS>> => {
  const storage = storageOf();
  const raw = storage?.getItem(key);
  if (!raw) return { contractAddress: null, ...EMPTY };
  try {
    const parsed = deserialize<Partial<Snapshot<PS>>>(await openAtRest(raw));
    return {
      contractAddress:
        typeof parsed.contractAddress === "string"
          ? parsed.contractAddress
          : null,
      scopes:
        parsed.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {},
      signingKeys:
        parsed.signingKeys && typeof parsed.signingKeys === "object"
          ? parsed.signingKeys
          : {},
    };
  } catch {
    throw new PrivateStateCorruptError(key);
  }
};

const writeSnapshot = async <PS>(
  key: string,
  snapshot: Snapshot<PS>,
): Promise<void> => {
  requireStorage().setItem(key, await sealAtRest(serialize(snapshot)));
};

const unavailable = (): never => {
  throw new Error(
    "No contract address is set on this private-state provider. Call setContractAddress before reading or writing private state.",
  );
};

type DeployRecordStore<T> = {
  read(): T | null;
  write(record: T): void;
};

export function deployRecordStore<T>(scope: string): DeployRecordStore<T> {
  if (typeof scope !== "string" || scope.length === 0)
    throw new Error(
      "A non-empty scope is required to namespace the deploy record.",
    );
  requireStorage();
  const key = `milo:deploy-record:${scope}`;
  return {
    read(): T | null {
      const storage = storageOf();
      if (!storage) return null;
      const raw = storage.getItem(key);
      if (!raw) return null;
      try {
        return deserialize<T>(raw);
      } catch {
        return null;
      }
    },
    write(record: T): void {
      requireStorage().setItem(key, serialize(record));
    },
  };
}

export function browserPrivateStateProvider<PS>(
  scope: string,
): BrowserPrivateStateProvider<PS> {
  if (typeof scope !== "string" || scope.length === 0)
    throw new Error(
      "A non-empty scope is required to namespace the browser private-state store.",
    );
  requireStorage();
  const storageKey = `milo:private-state:${scope}`;
  // The SDK constructs this provider synchronously, so the snapshot is loaded on
  // first await and every read/write joins that same load.
  let snapshot: Snapshot<PS> | undefined;
  /** Set synchronously by setContractAddress, before the async write lands. */
  let pendingAddress: ContractAddress | undefined;
  const loaded = readSnapshot<PS>(storageKey).then((value) => {
    snapshot = value;
    return value;
  });

  const current = async (): Promise<Snapshot<PS>> => snapshot ?? (await loaded);

  // Writes are serialized so a fast sequence of set() calls cannot interleave
  // their encrypt-then-store steps and lose the later one.
  let writing: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    writing = writing.then(async () => {
      await writeSnapshot(storageKey, await current());
    });
    return writing;
  };

  const addressOf = async (): Promise<ContractAddress> => {
    if (pendingAddress) return pendingAddress;
    const { contractAddress } = await current();
    if (!contractAddress) unavailable();
    return contractAddress as ContractAddress;
  };

  const statesFor = async (
    contractAddress: string,
  ): Promise<Record<string, PS>> =>
    (await current()).scopes[contractAddress] ?? {};

  const writeStates = async (
    contractAddress: string,
    states: Record<string, PS>,
  ): Promise<void> => {
    const now = await current();
    snapshot = {
      ...now,
      scopes: { ...now.scopes, [contractAddress]: states },
    };
    await persist();
  };

  return {
    storageKey,
    // The SDK calls this synchronously and immediately follows with set()/get(),
    // so the address is held synchronously and only the write is deferred. A
    // deferred write that fails has no caller to reject, so it is swallowed here
    // rather than surfacing as an unhandled rejection; the next set() retries.
    setContractAddress(next: ContractAddress): void {
      pendingAddress = next;
      void current()
        .then(async (now) => {
          snapshot = { ...now, contractAddress: next };
          await persist();
        })
        .catch(() => undefined);
    },
    async set(privateStateId: PrivateStateId, state: PS): Promise<void> {
      const contractAddress = await addressOf();
      await writeStates(contractAddress, {
        ...(await statesFor(contractAddress)),
        [privateStateId]: state,
      });
    },
    async get(privateStateId: PrivateStateId): Promise<PS | null> {
      return (await statesFor(await addressOf()))[privateStateId] ?? null;
    },
    async remove(privateStateId: PrivateStateId): Promise<void> {
      const contractAddress = await addressOf();
      const { [privateStateId]: _removed, ...rest } =
        await statesFor(contractAddress);
      await writeStates(contractAddress, rest);
    },
    async clear(): Promise<void> {
      await writeStates(await addressOf(), {});
    },
    async setSigningKey(
      contractAddress: ContractAddress,
      signingKey: SigningKey,
    ): Promise<void> {
      const now = await current();
      snapshot = {
        ...now,
        signingKeys: { ...now.signingKeys, [contractAddress]: signingKey },
      };
      await persist();
    },
    async getSigningKey(
      contractAddress: ContractAddress,
    ): Promise<SigningKey | null> {
      return (await current()).signingKeys[contractAddress] ?? null;
    },
    async removeSigningKey(contractAddress: ContractAddress): Promise<void> {
      const now = await current();
      const { [contractAddress]: _removed, ...rest } = now.signingKeys;
      snapshot = { ...now, signingKeys: rest };
      await persist();
    },
    async clearSigningKeys(): Promise<void> {
      snapshot = { ...(await current()), signingKeys: {} };
      await persist();
    },
    async exportPrivateStates(
      options?: ExportPrivateStatesOptions,
    ): Promise<PrivateStateExport> {
      const now = await current();
      const sealed = await sealExport(
        {
          contractAddress: now.contractAddress,
          states: now.scopes[now.contractAddress ?? ""] ?? {},
        },
        options?.password ?? "",
      );
      return { format: "midnight-private-state-export", ...sealed };
    },
    async importPrivateStates(
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      const contractAddress = await addressOf();
      const conflictStrategy = options?.conflictStrategy ?? "error";
      const payload = await openExport<{ states?: Record<string, PS> }>(
        exportData,
        options?.password,
      );
      const incoming = payload.states ?? {};
      const states = { ...(await statesFor(contractAddress)) };
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      for (const [stateId, state] of Object.entries(incoming)) {
        const existing = stateId in states;
        if (existing && conflictStrategy === "skip") {
          skipped += 1;
          continue;
        }
        if (existing && conflictStrategy === "error")
          throw new Error(`Private state conflict for '${stateId}'.`);
        if (existing) overwritten += 1;
        else imported += 1;
        states[stateId] = state;
      }
      // Await the write: reporting `imported: 1` before the state is on disk tells
      // the user their backup was restored when a failed write lost it.
      await writeStates(contractAddress, states);
      return { imported, skipped, overwritten };
    },
    async exportSigningKeys(
      options?: ExportSigningKeysOptions,
    ): Promise<SigningKeyExport> {
      const sealed = await sealExport(
        { keys: (await current()).signingKeys },
        options?.password ?? "",
      );
      return { format: "midnight-signing-key-export", ...sealed };
    },
    async importSigningKeys(
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      const conflictStrategy = options?.conflictStrategy ?? "error";
      const payload = await openExport<{ keys?: Record<string, SigningKey> }>(
        exportData,
        options?.password,
      );
      const incoming = payload.keys ?? {};
      const now = await current();
      const signingKeys = { ...now.signingKeys };
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      for (const [contractAddress, key] of Object.entries(incoming)) {
        const existing = contractAddress in signingKeys;
        if (existing && conflictStrategy === "skip") {
          skipped += 1;
          continue;
        }
        if (existing && conflictStrategy === "error")
          throw new Error(`Signing key conflict for '${contractAddress}'.`);
        if (existing) overwritten += 1;
        else imported += 1;
        signingKeys[contractAddress] = key;
      }
      snapshot = { ...now, signingKeys };
      await persist();
      return { imported, skipped, overwritten };
    },
  };
}
