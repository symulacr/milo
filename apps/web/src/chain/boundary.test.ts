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
