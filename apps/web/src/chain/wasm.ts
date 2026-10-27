import { idb } from "./private-state.ts";

class ChainWasmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainWasmError";
  }
}

type Bindings = Record<string, unknown>;

type WasmAsset = {
  readonly bindings: Bindings;
  readonly url: string;
  readonly glueModule: string;
  /** Lowercase hex SHA-256 of the exact wasm bytes, recorded at build time. */
  readonly sha256: string;
};

/** The wasm is 11 MB of code the page then executes, so a substituted or truncated
 * body must be refused before it reaches the compiler. */
const verify = async (bytes: Uint8Array, asset: WasmAsset): Promise<void> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
  // Native toHex, not order.ts's helper: importing that module would drag the
  // generated contract and compact-runtime into this chunk, and compact-runtime's
  // top level calls ocrt.maxField() before __wbg_set_wasm has run. That is the
  // production crash this file used to cause.
  if (digest.toHex() !== asset.sha256)
    throw new ChainWasmError(
      `The ${asset.glueModule} module did not match its recorded digest; refusing to run it.`,
    );
};

/** A compiled module is structured-cloneable, so it can be cached in IndexedDB and
 * reused on the next visit. Compiling 11 MB measured 170 ms; a cache hit is 0.4 ms.
 * Keyed by the content digest, so a new build is a miss rather than a stale hit. */
const MODULE_STORE = "wasm-modules";

const readCachedModule = (sha256: string) =>
  idb<WebAssembly.Module | null>(MODULE_STORE, "readonly", (s) => s.get(sha256))
    .then((found) => found ?? null)
    .catch(() => null);

const writeCachedModule = async (
  sha256: string,
  module: WebAssembly.Module,
): Promise<void> => {
  // A cache that cannot be written is not a failure: the module is already
  // compiled and usable, and the next visit simply compiles again.
  await idb(MODULE_STORE, "readwrite", (s) => s.put(module, sha256)).catch(
    () => undefined,
  );
};

/** Compile from bytes, or reuse the cached module for the same digest. */
const compileOnce = async (
  bytes: Uint8Array,
  asset: WasmAsset,
): Promise<WebAssembly.Module> => {
  const cached = await readCachedModule(asset.sha256);
  if (cached) return cached;
  const module = await WebAssembly.compile(bytes as BufferSource);
  await writeCachedModule(asset.sha256, module);
  return module;
};

const instantiate = async (asset: WasmAsset): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(new URL(asset.url, import.meta.url));
    if (!response.ok)
      throw new ChainWasmError(
        `The ${asset.glueModule} module could not be fetched: ${response.status} ${response.statusText}.`,
      );
  } catch (error) {
    if (error instanceof ChainWasmError) throw error;
    throw new ChainWasmError(
      `The ${asset.glueModule} module could not be downloaded. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let instance: WebAssembly.Instance;
  try {
    // One read of the body: the digest check needs the bytes, and compileStreaming
    // consumes the body even when it fails, so streaming cannot be combined with it.
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verify(bytes, asset);
    const module = await compileOnce(bytes, asset);
    const importObject: Record<string, Record<string, unknown>> = {
      [`./${asset.glueModule}_bg.js`]: asset.bindings,
    };
    for (const entry of WebAssembly.Module.imports(module)) {
      if (entry.module === `./${asset.glueModule}_bg.js`) continue;
      const target = importObject[entry.module] ?? {};
      target[entry.name] = () => asset.bindings[entry.name.replace(/_$/, "")];
      importObject[entry.module] = target;
    }
    instance = await WebAssembly.instantiate(
      module,
      importObject as unknown as WebAssembly.Imports,
    );
  } catch (error) {
    throw new ChainWasmError(
      `The ${asset.glueModule} module could not be instantiated. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const setWasm = asset.bindings.__wbg_set_wasm;
  if (typeof setWasm !== "function")
    throw new ChainWasmError(
      `The ${asset.glueModule} bindings do not expose __wbg_set_wasm; this build expects the wasm-bindgen glue layout.`,
    );
  setWasm.call(asset.bindings, instance.exports);
  const start = instance.exports.__wbindgen_start;
  if (typeof start === "function") start();
};

/** One promise per module, keyed by its glue module name. Keying by asset rather
 * than by call means the onchain runtime can be initialised on its own for the
 * pure-hash path, and a later full init still brings the ledger module up. */
const pending = new Map<string, Promise<void>>();

export function initChainWasmFrom(assets: readonly WasmAsset[]): Promise<void> {
  return Promise.all(
    assets.map((asset) => {
      let one = pending.get(asset.glueModule);
      if (!one) {
        one = instantiate(asset).catch((cause) => {
          // A rejected promise must not be cached: one offline blip would
          // otherwise poison every later call, including the retry the user
          // just asked for.
          pending.delete(asset.glueModule);
          throw cause;
        });
        pending.set(asset.glueModule, one);
      }
      return one;
    }),
  ).then(() => undefined);
}
