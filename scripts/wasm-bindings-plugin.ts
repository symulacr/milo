import type { BunPlugin } from "bun";

const BINDING_MODULES = [
  "@midnight-ntwrk/ledger-v8",
  "@midnight-ntwrk/onchain-runtime-v3",
] as const;

type BindingModule = (typeof BINDING_MODULES)[number];

const GLUE: Record<BindingModule, string> = {
  "@midnight-ntwrk/ledger-v8": "midnight_ledger_wasm_bg",
  "@midnight-ntwrk/onchain-runtime-v3": "midnight_onchain_runtime_wasm_bg",
};

export const WASM_URL_PREFIX = "milo-wasm-url:";
export const WASM_SHA_PREFIX = "milo-wasm-sha256:";

const NAMESPACE = "milo-wasm";

const packageDirectory = (name: string): string => {
  const resolved = Bun.resolveSync(name, import.meta.dir);
  return resolved.slice(0, resolved.lastIndexOf("/"));
};

const wasmPath = (name: BindingModule): string =>
  `${packageDirectory(name)}/${GLUE[name]}.wasm`;

const bindingContents = (name: BindingModule): string =>
  `export * from ${JSON.stringify(`${packageDirectory(name)}/${GLUE[name]}.js`)};`;

const wasmContents = (name: BindingModule): string =>
  `export { default } from ${JSON.stringify(wasmPath(name))};`;

/** The digest is computed once at build time from the exact bytes that are copied
 * into dist, so the browser can reject a substituted or truncated wasm. */
const wasmShaContents = async (name: BindingModule): Promise<string> => {
  const bytes = new Uint8Array(await Bun.file(wasmPath(name)).arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(""); // taste-skill-ignore
  return `export default ${JSON.stringify(hex)};`;
};

export const wasmUrlSpecifier = (name: BindingModule): string =>
  `${WASM_URL_PREFIX}${name}`;

export const wasmShaSpecifier = (name: BindingModule): string =>
  `${WASM_SHA_PREFIX}${name}`;

export const wasmBindings = (): BunPlugin => {
  const bindings = new Map<string, string>(
    BINDING_MODULES.map((name) => [name, bindingContents(name)]),
  );
  const wasm = new Map<string, string>(
    BINDING_MODULES.map((name) => [
      `${WASM_URL_PREFIX}${name}`,
      wasmContents(name),
    ]),
  );
  const sha = new Map<string, () => Promise<string>>(
    BINDING_MODULES.map((name) => [
      `${WASM_SHA_PREFIX}${name}`,
      () => wasmShaContents(name),
    ]),
  );
  return {
    name: "milo-wasm-bindings",
    setup(build) {
      build.onResolve(
        { filter: /^@midnight-ntwrk\/(ledger-v8|onchain-runtime-v3)$/ },
        (args) =>
          bindings.has(args.path)
            ? { path: args.path, namespace: NAMESPACE }
            : undefined,
      );
      build.onResolve({ filter: /^milo-wasm-url:/ }, (args) =>
        wasm.has(args.path)
          ? { path: args.path, namespace: NAMESPACE }
          : undefined,
      );
      build.onResolve({ filter: /^milo-wasm-sha256:/ }, (args) =>
        sha.has(args.path)
          ? { path: args.path, namespace: NAMESPACE }
          : undefined,
      );
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => {
        const digest = sha.get(args.path);
        if (digest) return { contents: await digest(), loader: "js" };
        const contents = bindings.get(args.path) ?? wasm.get(args.path);
        if (!contents) return undefined;
        return { contents, loader: "js" };
      });
    },
  };
};

export default wasmBindings();
