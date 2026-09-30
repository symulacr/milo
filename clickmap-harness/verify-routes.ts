/**
 * CLICK-MAP route drift check.
 *
 * Compares the Route index table in CLICK-MAP.md against
 * apps/web/src/route-table.ts (publicAppRoutes + workspaceRoutes) and the
 * publicAppPrefixes sample (`/m/north-studio`).
 *
 * CLICK-MAP.md is a coordinator hot file (lives on milo-main, not this
 * worktree). This script is read-only against it and writes a drift report
 * under clickmap-harness/out/.
 *
 * Usage:
 *   bun clickmap-harness/verify-routes.ts [path-to-CLICK-MAP.md]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicAppPrefixes,
  publicAppRoutes,
  workspaceAppRoutes,
  workspaceRoutes,
} from "../apps/web/src/route-table";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const DEFAULT_CANDIDATES = [
  join(REPO, "CLICK-MAP.md"),
  "/home/eya/milo/milo-main/CLICK-MAP.md",
  "/home/eya/milo/audit/discovery/CLICK-MAP.md",
];

export type ClickMapRow = {
  path: string;
  kind: string;
  title: string;
};

export type DriftReport = {
  clickMapPath: string;
  checkedAt: number;
  clickMapRoutes: string[];
  routeTablePublic: string[];
  routeTableWorkspace: string[];
  routeTablePrefixSamples: string[];
  missingFromRouteTable: string[];
  missingFromClickMap: string[];
  kindMismatches: { path: string; clickMapKind: string; expected: string }[];
  prefixSamples: { path: string; inClickMap: boolean }[];
  drift: boolean;
  summary: string;
};

/** Parse the `## Route index` markdown table rows. */
export function parseClickMapRoutes(markdown: string): ClickMapRow[] {
  const lines = markdown.split("\n");
  const rows: ClickMapRow[] = [];
  let inTable = false;
  for (const line of lines) {
    if (/^##\s+Route index/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^##\s+/.test(line) && !/^##\s+Route index/.test(line)) {
      break;
    }
    if (!inTable) continue;
    const match = /^\|\s*(`[^`]+`)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(
      line,
    );
    if (match) {
      rows.push({
        path: match[1].replace(/`/g, "").trim(),
        kind: match[2].trim(),
        title: match[3].trim(),
      });
    }
  }
  return rows;
}

function resolveClickMap(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of DEFAULT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function verifyClickMapRoutes(markdown: string): Omit<
  DriftReport,
  "clickMapPath" | "checkedAt" | "summary"
> {
  const rows = parseClickMapRoutes(markdown);
  const clickMapPaths = rows.map((r) => r.path);

  const expectedPublic = [...publicAppRoutes];
  const expectedWorkspace = [...workspaceAppRoutes];
  // publicAppPrefixes sample recorded in CLICK-MAP (D3a).
  const expectedPrefixSamples = publicAppPrefixes.map((p) => `${p}/north-studio`);

  const routeTableAll = [...expectedPublic, ...expectedWorkspace, ...expectedPrefixSamples];
  const missingFromRouteTable = clickMapPaths.filter(
    (p) => !routeTableAll.includes(p),
  );
  const missingFromClickMap = routeTableAll.filter(
    (p) => !clickMapPaths.includes(p),
  );

  const kindMismatches: DriftReport["kindMismatches"] = [];
  for (const row of rows) {
    let expected: string | null = null;
    if (expectedPublic.includes(row.path)) expected = "public";
    else if (expectedWorkspace.includes(row.path)) expected = "workspace";
    else if (expectedPrefixSamples.includes(row.path)) expected = "public-prefix";
    if (expected && row.kind !== expected) {
      kindMismatches.push({
        path: row.path,
        clickMapKind: row.kind,
        expected,
      });
    }
  }

  const prefixSamples = expectedPrefixSamples.map((path) => ({
    path,
    inClickMap: clickMapPaths.includes(path),
  }));

  const drift =
    missingFromRouteTable.length > 0 ||
    missingFromClickMap.length > 0 ||
    kindMismatches.length > 0 ||
    prefixSamples.some((p) => !p.inClickMap);

  return {
    clickMapPaths,
    routeTablePublic: expectedPublic,
    routeTableWorkspace: expectedWorkspace,
    routeTablePrefixSamples: expectedPrefixSamples,
    missingFromRouteTable,
    missingFromClickMap,
    kindMismatches,
    prefixSamples,
    drift,
  };
}

function main(): void {
  const explicit = process.argv[2];
  const clickMapPath = resolveClickMap(explicit);
  if (!clickMapPath) {
    console.error(
      "CLICK-MAP.md not found. Pass a path: bun clickmap-harness/verify-routes.ts /path/to/CLICK-MAP.md",
    );
    process.exitCode = 2;
    return;
  }
  const markdown = readFileSync(clickMapPath, "utf8");
  const partial = verifyClickMapRoutes(markdown);
  const summary = partial.drift
    ? `DRIFT: missingFromRouteTable=${JSON.stringify(partial.missingFromRouteTable)} missingFromClickMap=${JSON.stringify(partial.missingFromClickMap)} kindMismatches=${JSON.stringify(partial.kindMismatches)}`
    : `OK: ${partial.clickMapPaths.length} CLICK-MAP routes match route-table.ts (${partial.routeTablePublic.length} public + ${partial.routeTableWorkspace.length} workspace + prefix sample)`;
  const report: DriftReport = {
    clickMapPath,
    checkedAt: Date.now(),
    ...partial,
    summary,
  };
  const outDir = join(HERE, "out");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `clickmap-drift-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
  console.log(summary);
  console.log(`report=${outFile}`);
  console.log(
    `public=${JSON.stringify(report.routeTablePublic)} workspace=${JSON.stringify(report.routeTableWorkspace)} prefix=${JSON.stringify(report.routeTablePrefixSamples)}`,
  );
  if (report.drift) process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
