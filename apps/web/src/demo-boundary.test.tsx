import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      const hit = [".tsx", ".ts", "/index.tsx", "/index.ts"]
        .map((ext) => `${base}${ext}`)
        .find(existsSync);
      if (hit) queue.push(hit);
    }
  }
  return [...seen];
}

const publicGraph = reachableSources(`${APP_SRC}public-main.tsx`);
const names = (graph: string[]) => graph.map((p) => p.split("/").pop() ?? "");
const forbiddenPath =
  /privy|convex|midnight|lace|workspace\/model|packages\/domain/i;
const forbiddenImport =
  /from "(@privy-io|convex|@midnight-ntwrk|stripe|.*workspace\/model|.*packages\/domain)/i;
const KEY_SHAPED =
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|\bwhsec_[A-Za-z0-9]{10,}|\bre_[A-Za-z0-9]{20,}/;

describe("public entry import boundary (01 §7.4)", () => {
  test("covers the public surfaces and excludes the workspace", () => {
    expect(names(publicGraph)).toEqual(
      expect.arrayContaining([
        "public-main.tsx",
        "PublicShell.tsx",
        "InfoPage.tsx",
        "NotFound.tsx",
      ]),
    );
    expect(names(publicGraph)).not.toEqual(
      expect.arrayContaining([
        "App.tsx",
        "main.tsx",
        "WorkspaceShell.tsx",
        "backend.tsx",
        "flows.ts",
        "wallet.ts",
      ]),
    );
  });
  test("no forbidden module is reachable", () => {
    expect(publicGraph.filter((path) => forbiddenPath.test(path))).toEqual([]);
  });
  test("no forbidden package is imported by any reachable source", () => {
    for (const file of publicGraph) {
      const source = readFileSync(file, "utf8");
      const imports = source.match(/^import .*$/gm) ?? [];
      for (const line of imports) {
        expect(line).not.toMatch(forbiddenImport);
      }
    }
  });
  test("no key-shaped string reaches a shipped bundle (H5)", () => {
    const graphs = [publicGraph, reachableSources(`${APP_SRC}main.tsx`)];
    for (const file of graphs.flat()) {
      expect(readFileSync(file, "utf8")).not.toMatch(KEY_SHAPED);
    }
  });
});

describe("reachableSources scan coverage (C-A-07)", () => {
  test("discovers dynamic import() and side-effect imports, not only from-imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "boundary-scan-"));
    writeFileSync(
      join(dir, "entry.ts"),
      [
        'import { plain } from "./plain";',
        'import "./side-effect";',
        'const load = () => import("./lazy-target");',
        "export { plain, load };",
      ].join("\n"),
    );
    for (const name of ["plain", "side-effect", "lazy-target"])
      writeFileSync(join(dir, `${name}.ts`), "export {};\n");
    const found = reachableSources(join(dir, "entry.ts")).map((p) =>
      p.split("/").pop(),
    );
    for (const n of [
      "entry.ts",
      "plain.ts",
      "side-effect.ts",
      "lazy-target.ts",
    ])
      expect(found).toContain(n);
  });
});
