import { describe, expect, test } from "bun:test";
import {
  abandonOperation,
  beginOperation,
  checkpointAddress,
  createKit,
  type KitScope,
  loseCapability,
  verifyKit,
} from "../../../packages/domain/src/recovery-kit";
import {
  forgetKit,
  parseKit,
  readKit,
  recoveryKey,
  writeKit,
} from "./recovery-runtime";

const scope: KitScope = {
  actorId: "did:privy:buyer",
  network: "preprod",
  orderNonce: "order-42",
};

/** A real Storage shape without a DOM, so the runtime keeps using native APIs. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("recovery context persistence", () => {
  test("a prepared, verified context round-trips through storage", () => {
    const storage = memoryStorage();
    const kit = verifyKit(createKit(scope), scope);
    expect(kit.stage).toBe("VERIFIED");
    expect(writeKit(scope, kit, storage)).toBe(true);
    expect(readKit(scope, storage)).toEqual(kit);
  });

  test("the key is bound to actor, network and order nonce", () => {
    expect(recoveryKey(scope)).toContain("did:privy:buyer");
    expect(recoveryKey(scope)).toContain("preprod");
    expect(recoveryKey(scope)).toContain("order-42");
    const other: KitScope = { ...scope, orderNonce: "order-43" };
    expect(recoveryKey(other)).not.toBe(recoveryKey(scope));
  });

  test("a record written for one scope cannot be read under another", () => {
    const storage = memoryStorage();
    writeKit(scope, createKit(scope), storage);
    const foreign: KitScope = { ...scope, actorId: "did:privy:someone-else" };
    expect(readKit(foreign, storage)).toBeNull();
    const sameNonceOtherNetwork: KitScope = { ...scope, network: "mainnet" };
    expect(readKit(sameNonceOtherNetwork, storage)).toBeNull();
  });

  test("a corrupt, partial or wrong-shaped record is never a kit", () => {
    const storage = memoryStorage();
    storage.setItem(recoveryKey(scope), "not json");
    expect(readKit(scope, storage)).toBeNull();
    storage.setItem(recoveryKey(scope), JSON.stringify({ stage: "VERIFIED" }));
    expect(readKit(scope, storage)).toBeNull();
    storage.setItem(
      recoveryKey(scope),
      JSON.stringify({ ...createKit(scope), stage: "READY" }),
    );
    expect(readKit(scope, storage)).toBeNull();
    storage.setItem(
      recoveryKey(scope),
      JSON.stringify({
        ...createKit(scope),
        pending: { operation: "reserve", identity: "", revision: 1 },
      }),
    );
    expect(readKit(scope, storage)).toBeNull();
  });

  test("an interrupted operation keeps its identity and flags across a reload", () => {
    const storage = memoryStorage();
    const bound = checkpointAddress(
      verifyKit(createKit(scope), scope),
      "0xabc",
    );
    const pending = beginOperation(bound, "reserve", "tx-reserve", 1);
    writeKit(scope, pending, storage);
    const reloaded = readKit(scope, storage);
    expect(reloaded?.pending).toEqual({
      operation: "reserve",
      identity: "tx-reserve",
      revision: 1,
    });
    const abandoned = abandonOperation(pending);
    writeKit(scope, abandoned, storage);
    expect(readKit(scope, storage)?.requiresReconciliation).toBe(true);
  });

  test("a lost capability persists as read-only and parsing rejects junk", () => {
    const storage = memoryStorage();
    writeKit(scope, loseCapability(createKit(scope)), storage);
    expect(readKit(scope, storage)?.stage).toBe("LOST");
    expect(readKit(scope, storage)?.usable).toBe(false);
    expect(parseKit("{}", scope)).toBeNull();
  });

  test("without platform storage nothing is read and nothing is written", () => {
    expect(readKit(scope, undefined)).toBeNull();
    expect(writeKit(scope, createKit(scope), undefined)).toBe(false);
    expect(() => forgetKit(scope, undefined)).not.toThrow();
  });

  test("forget removes only this scope's record", () => {
    const storage = memoryStorage();
    const other: KitScope = { ...scope, orderNonce: "order-99" };
    writeKit(scope, createKit(scope), storage);
    writeKit(other, createKit(other), storage);
    forgetKit(scope, storage);
    expect(readKit(scope, storage)).toBeNull();
    expect(readKit(other, storage)).not.toBeNull();
  });
});
