import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DemoPage } from "./routes/DemoPage";

/**
 * 01-blueprint §7.4: the public entry (/demo + info pages) ships no Privy,
 * Convex client, wallet, proving or Midnight SDK, and no workspace
 * simulator. Scan every reachable local import from the public entry and
 * assert both the path set and the external package imports.
 */
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

const publicGraph = reachableSources(`${APP_SRC}public-main.tsx`);
const forbiddenPath =
  /privy|convex|midnight|lace|workspace\/model|packages\/domain/i;
const forbiddenImport =
  /from "(@privy-io|convex|@midnight-ntwrk|stripe|.*workspace\/model|.*packages\/domain)/i;

describe("public entry import boundary (01 §7.4)", () => {
  test("covers the public surfaces", () => {
    const names = publicGraph.map((path) => path.split("/").pop() ?? "");
    for (const expected of [
      "public-main.tsx",
      "DemoPage.tsx",
      "demo-fixtures.ts",
      "PublicShell.tsx",
      "InfoPage.tsx",
      "StudioPage.tsx",
      "NotFound.tsx",
    ]) {
      expect(names).toContain(expected);
    }
  });
  test("no forbidden module is reachable", () => {
    const offenders = publicGraph.filter((path) => forbiddenPath.test(path));
    expect(offenders).toEqual([]);
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
  test("workspace entry is not reachable from the public entry", () => {
    const names = publicGraph.map((path) => path.split("/").pop() ?? "");
    for (const unexpected of [
      "App.tsx",
      "main.tsx",
      "WorkspaceShell.tsx",
      "Connections.tsx",
      "PrivyConnection.tsx",
      "model.tsx",
    ]) {
      expect(names).not.toContain(unexpected);
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
    for (const name of ["plain", "side-effect", "lazy-target"]) {
      writeFileSync(join(dir, `${name}.ts`), "export {};\n");
    }
    const found = reachableSources(join(dir, "entry.ts")).map((path) =>
      path.split("/").pop(),
    );
    for (const name of [
      "entry.ts",
      "plain.ts",
      "side-effect.ts",
      "lazy-target.ts",
    ]) {
      expect(found).toContain(name);
    }
  });
});

function renderDemo(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <DemoPage />
    </MemoryRouter>,
  );
}

describe("sample context catalogue (04 §4.4)", () => {
  test("defaults to SC-01 without a query", () => {
    const markup = renderDemo("/demo");
    expect(markup).toContain("North Studio");
    expect(markup).toContain(
      "Synthetic sample · no wallet, payment or transaction",
    );
  });
  test("?context=SC-05 selects the publishing example", () => {
    const markup = renderDemo("/demo?context=SC-05");
    expect(markup).toContain("Chronicle House");
  });
  test("unknown context falls back to SC-01", () => {
    const markup = renderDemo("/demo?context=SC-99");
    expect(markup).toContain("North Studio");
  });
  test("all seven contexts are offered in one native select", () => {
    const markup = renderDemo("/demo");
    expect(markup.match(/<option/g)).toHaveLength(7);
    expect(markup).toContain("Sample context");
  });
});
