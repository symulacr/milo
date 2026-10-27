/** An in-memory localStorage for tests that exercise the key ring. */
export function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    // A real Storage enumerates. Hardcoding `key: () => null` and `length: 0`
    // made every prefix scan see an empty store, so code that reads storage by
    // scanning appeared to work while reading nothing.
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return store;
}
