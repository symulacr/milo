import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const APP_SRC = new URL(".", import.meta.url).pathname;

function reachableSources(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const localRefs = [
      ...source.matchAll(/from "(\.[^"]+)"/g),
      ...source.matchAll(/import\(\s*"(\.[^"]+)"\s*\)/g),
      ...source.matchAll(/^import\s+"(\.[^"]+)";?$/gm),
    ];
    for (const match of localRefs) {
      const base = new URL(`${match[1]}`, `file://${file}`).pathname;
      for (const candidate of [
        `${base}.tsx`,
        `${base}.ts`,
        `${base}/index.tsx`,
        `${base}/index.ts`,
      ]) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...seen];
}

const chainDirectory = APP_SRC;
const appRoot = new URL("..", import.meta.url).pathname;

describe("the chain module stays out of the public bundle", () => {
  test("the public entry reaches no chain source", () => {
    const offenders = reachableSources(`${appRoot}public-main.tsx`).filter(
      (path) => path.startsWith(chainDirectory),
    );
    expect(offenders).toEqual([]);
  });

  test("the chain module is only reached through a dynamic import", () => {
    const sources = reachableSources(`${appRoot}main.tsx`);
    const statically = sources.filter((path) => {
      if (path.startsWith(chainDirectory)) return false;
      return /^import (?!type )[^;]*from "\.{1,2}\/(?:\.\.\/)*chain/m.test(
        readFileSync(path, "utf8"),
      );
    });
    expect(statically).toEqual([]);
  });

  test("the chain entry defers midnight-js behind loadChainRuntime", () => {
    const source = readFileSync(`${chainDirectory}index.ts`, "utf8");
    expect(source).toContain("loadChainRuntime");
    expect(source).toMatch(
      /initChainWasm\(\)\.then\(\(\)\s*=>\s*import\("\.\/runtime"\)\)/,
    );
    const staticMidnight = (
      source.match(/^import [^;]*@midnight-ntwrk[^;]*;/gm) ?? []
    ).filter((line) => !line.includes("dapp-connector-api"));
    expect(staticMidnight).toEqual([]);
  });

  // Speed: the quote form hashes terms before it has a wallet, so it must not pull
  // the ledger. The pure circuits need only the 1.4 MB onchain runtime, and the
  // commitments path must stay on it.
  test("the commitment path never imports the ledger or the runtime", () => {
    const source = readFileSync(`${chainDirectory}index.ts`, "utf8");
    const commitments = source.slice(
      source.indexOf("export async function orderCommitments"),
      source.indexOf("export type DeployOrderInput"),
    );
    expect(commitments).toContain("initPureCircuitsWasm");
    expect(commitments).not.toContain("loadChainRuntime");
    expect(commitments).not.toContain("initChainWasm");
    // order.ts is the ledger-free half; it may not reach the ledger either.
    const order = readFileSync(`${chainDirectory}order.ts`, "utf8");
    expect(order).not.toContain("@midnight-ntwrk");
  });

  test("the warm-up entry point is exported and cannot reject", () => {
    const source = readFileSync(`${chainDirectory}index.ts`, "utf8");
    expect(source).toMatch(/export function warmOrderChain\(\): Promise<void>/);
    // Both handlers swallow: a warm-up failure must never surface to the caller.
    const warm = source.slice(
      source.indexOf("export function warmOrderChain"),
      source.indexOf("export async function orderCommitments"),
    );
    expect(warm.match(/\(\) => undefined/g)).toHaveLength(2);
  });

  test("the runtime module is the only place midnight-js is imported", () => {
    for (const name of ["index.ts", "order.ts", "errors.ts", "wasm.ts"]) {
      const source = readFileSync(`${chainDirectory}${name}`, "utf8");
      const imports = (
        source.match(/^import [^;]*@midnight-ntwrk[^;]*;/gm) ?? []
      )
        .filter((line) => !line.includes("dapp-connector-api"))
        .filter(
          (line) => !line.includes("midnight-js-protocol/compact-runtime"),
        );
      expect(imports).toEqual([]);
    }
  });

  test("a call waits for finalization and the deploy folds in the lock", () => {
    const source = readFileSync(`${chainDirectory}runtime.ts`, "utf8");
    expect(source).toContain("submitCallTx");
    expect(source).not.toContain("submitCallTxAsync");
    expect(source).not.toContain("SucceedEntirely");
    expect(source).not.toMatch(/^\s+async lock\(/m);
    const staged = readFileSync(`${chainDirectory}staged-deploy.ts`, "utf8");
    expect(staged).not.toContain('stage: "lock"');
    expect(staged).toContain("STAGED_DEPLOY_STEPS");
  });

  test("a failed finalization reaches the UI as TX_FAILED", () => {
    const source = readFileSync(`${chainDirectory}errors.ts`, "utf8");
    expect(source).toContain("error.name");
    expect(source).toMatch(/calltxfailederror/i);
  });

  test("the contract watch reads the indexer from the wallet, never a key", () => {
    const source = readFileSync(`${chainDirectory}runtime.ts`, "utf8");
    expect(source).toContain("readWalletConfig");
    expect(source).toContain('{ type: "latest" }');
    expect(source).not.toMatch(/project_?id/i);
  });
});

// The production crash: `Cannot read properties of undefined (reading 'maxField')`.
//
// compact-runtime's `constants.js` runs `MAX_FIELD = ocrt.maxField()` at module
// evaluation, and that needs `__wbg_set_wasm` to have run. Any module that reaches
// compact-runtime through a STATIC (value) import therefore evaluates it when the
// importing chunk loads — before `initPureCircuitsWasm()`/`initChainWasm()` — and
// throws. Bun and Node cannot see this because they initialise the wasm glue
// synchronously; only a browser does.
//
// So the rule is a graph rule, not a call-order rule: the entry the page loads must
// not reach the runtime by value. These tests walk VALUE imports only (`import type`
// is erased and safe), which is what the bundler keeps in the eager chunk.
const RUNTIME_REACHING = [
  "packages/contract/generated/contract/index.js",
  "@midnight-ntwrk/compact-runtime",
  "@midnight-ntwrk/onchain-runtime-v3",
  "@midnight-ntwrk/ledger-v8",
  "@midnight-ntwrk/midnight-js-protocol/ledger",
];

/** Is this specifier an actual runtime package? The plugin's `milo-wasm-*`
 * virtual modules embed a package name in their id but resolve to a digest string
 * or a URL, so they are not the package and must not be counted. */
const reachesRuntime = (specifier: string): boolean =>
  !specifier.startsWith("milo-wasm-") &&
  RUNTIME_REACHING.some((spec) => specifier.includes(spec));

/** Local files reachable from `entry` through value imports only. */
function valueReachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // `import type` / `export type` are erased, so they are not edges. The body is
    // matched with [\s\S] because a value import can span lines — the live entry's
    // `import {\n  ORDER_CIRCUITS,\n ... } from "./order.ts"` is exactly that shape,
    // and a single-line-only pattern would miss the very edge this test exists for.
    for (const match of source.matchAll(
      /^(?:import|export)\s+(?!type\b)([\s\S]*?)\s+from\s+"(\.[^"]+)"/gm,
    )) {
      const base = new URL(match[2], `file://${file}`).pathname;
      // The specifiers in this tree carry their extension (`./order.ts`), so the
      // resolved path is already a file; only extensionless specifiers need the
      // candidate list. Appending blindly produced `order.ts.ts` and made the walk
      // stop at the entry, which silently disabled this test.
      const candidates =
        base.endsWith(".ts") || base.endsWith(".tsx")
          ? [base]
          : [
              `${base}.tsx`,
              `${base}.ts`,
              `${base}/index.tsx`,
              `${base}/index.ts`,
            ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...seen];
}

describe("the chain entry cannot evaluate the wasm runtime eagerly", () => {
  const entry = `${chainDirectory}index.ts`;

  test("no value import from the entry reaches the generated contract or the runtime", () => {
    const offenders: string[] = [];
    for (const file of valueReachable(entry)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /^(?:import|export)\s+(?!type\b)[\s\S]*?\s+from\s+"([^"]+)"/gm,
      )) {
        if (reachesRuntime(match[1]))
          offenders.push(`${file.replace(chainDirectory, "")} -> ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("order.ts is not reachable by value from the entry at all", () => {
    // order.ts imports the generated contract, so ANY value edge to it is the bug.
    // It must only ever be reached through `await import("./order.ts")`.
    expect(valueReachable(entry)).not.toContain(`${chainDirectory}order.ts`);
  });

  test("orderCommitments initialises the runtime before importing order.ts", () => {
    const source = readFileSync(entry, "utf8");
    const body = source.slice(
      source.indexOf("export async function orderCommitments"),
      source.indexOf("export type DeployOrderInput"),
    );
    const initAt = body.indexOf("await initPureCircuitsWasm()");
    const importAt = body.indexOf('await import("./order.ts")');
    expect(initAt).toBeGreaterThan(-1);
    expect(importAt).toBeGreaterThan(-1);
    // The init must come FIRST. A Promise.all here starts the import concurrently
    // and reintroduces the crash. Checked against code only, because the comment
    // above the statement names Promise.all to explain why it is wrong.
    expect(initAt).toBeLessThan(importAt);
    const code = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("Promise.all");
  });

  test("the wasm bindings are imported inside the init functions, not at module scope", () => {
    const source = readFileSync(`${chainDirectory}wasm-assets.ts`, "utf8");
    // A module-scope value import of either package puts the glue and
    // compact-runtime's constants.js into the eager chunk. The `milo-wasm-*`
    // virtual modules are plugin-generated digests and URLs, not the packages, so
    // they are allowed at module scope.
    expect(source).not.toMatch(
      /^import\s+(?!type\b)[^;]*from\s+"@midnight-ntwrk\/(onchain-runtime-v3|ledger-v8)"/m,
    );
    // They must still be loaded, just lazily.
    expect(source).toContain('import("@midnight-ntwrk/onchain-runtime-v3")');
    expect(source).toContain('import("@midnight-ntwrk/ledger-v8")');
  });
});
