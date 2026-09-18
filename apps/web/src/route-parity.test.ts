import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  publicAppPrefixes,
  publicAppRoutes,
  workspaceAppPrefixes,
  workspaceAppRoutes,
} from "./route-table";

/**
 * The route split has several consumers that must never drift apart: the
 * React router tree (public-main.tsx), the generated static-host rules
 * (build.ts -> dist/_redirects), the dev wildcards (derived from the same
 * table) and the vercel.json rewrites. The table in route-table.ts is the
 * single source; these assertions fail closed if any consumer is hand-edited.
 */
const REPO = new URL("../../..", import.meta.url).pathname;
const publicMain = readFileSync(`${REPO}apps/web/src/public-main.tsx`, "utf8");
const vercelJson = JSON.parse(
  readFileSync(`${REPO}apps/web/public/vercel.json`, "utf8"),
) as { rewrites: { source: string; destination: string }[] };

describe("route parity (01 §7.4/§9.1)", () => {
  test("route table is well-formed", () => {
    for (const routes of [publicAppRoutes, workspaceAppRoutes]) {
      for (const route of routes) {
        expect(route.startsWith("/")).toBe(true);
      }
    }
    expect(new Set([...publicAppRoutes, ...workspaceAppRoutes]).size).toBe(
      publicAppRoutes.length + workspaceAppRoutes.length,
    );
  });

  test("public router tree and the table cover each other exactly", () => {
    const declared = [...publicMain.matchAll(/path="([^"]+)"/g)].map(
      (match) => match[1],
    );
    // The router serves the table's public routes, the studio page, and the
    // catch-all that renders NotFound; nothing else may appear.
    expect([...declared].sort()).toEqual(
      [...publicAppRoutes, "/m/north-studio", "*"].sort(),
    );
    for (const route of publicAppRoutes) {
      expect(declared).toContain(route);
    }
  });

  test("vercel.json rewrites cover every prefix with the right target", () => {
    // Vercel applies rewrites first-match-wins: the FIRST rule for a source
    // decides, so duplicates or a wrong early rule must fail here, not only
    // on the deployed host.
    const sources = vercelJson.rewrites.map((rewrite) => rewrite.source);
    expect(new Set(sources).size).toBe(sources.length);
    const first = new Map(
      vercelJson.rewrites.map((rewrite) => [rewrite.source, rewrite]),
    );
    for (const prefix of publicAppPrefixes) {
      expect(first.get(`${prefix}/:path+`)?.destination).toBe(
        "/public-app.html",
      );
    }
    for (const prefix of workspaceAppPrefixes) {
      expect(first.get(`${prefix}/:path+`)?.destination).toBe(
        "/orders/index.html",
      );
    }
    expect(sources.length).toBe(
      publicAppPrefixes.length + workspaceAppPrefixes.length,
    );
  });

  test("no stale static route files are resurrected", () => {
    // build.ts generates dist/_redirects from the table; a hand-copied
    // apps/web/public/_redirects would shadow it with an untracked stale copy.
    const exists = (() => {
      try {
        readFileSync(`${REPO}apps/web/public/_redirects`);
        return true;
      } catch {
        return false;
      }
    })();
    expect(exists).toBe(false);
  });
});
