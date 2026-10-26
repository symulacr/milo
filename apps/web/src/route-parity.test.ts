import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  legacyRedirects,
  publicAppPrefixes,
  publicAppRoutes,
  workspaceAppPrefixes,
  workspaceAppRoutes,
} from "./route-table";

const REPO = new URL("../../..", import.meta.url).pathname;
const publicMain = readFileSync(`${REPO}apps/web/src/public-main.tsx`, "utf8");
const vercelJson = JSON.parse(
  readFileSync(`${REPO}apps/web/public/vercel.json`, "utf8"),
) as {
  rewrites: { source: string; destination: string }[];
  redirects: { source: string; destination: string; permanent: boolean }[];
};

describe("route parity (01 §7.4/§9.1)", () => {
  test("route table is well-formed", () => {
    const all = [...publicAppRoutes, ...workspaceAppRoutes];
    expect(all.filter((route) => !route.startsWith("/"))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });

  test("public router tree and the table cover each other exactly", () => {
    const declared = [...publicMain.matchAll(/path="([^"]+)"/g)].map(
      (match) => match[1],
    );
    // Sorted equality is stronger than "each route appears": it also pins the
    // count and rules out extras.
    expect([...declared].sort()).toEqual([...publicAppRoutes, "*"].sort());
  });

  test("vercel.json rewrites cover every prefix with the right target", () => {
    const rewrites = vercelJson.rewrites;
    const firstBySource = new Map<string, string>();
    for (const rewrite of rewrites) {
      if (!firstBySource.has(rewrite.source)) {
        firstBySource.set(rewrite.source, rewrite.destination);
      }
    }
    expect(rewrites.length).toBe(firstBySource.size);
    expect(rewrites.length).toBe(
      publicAppPrefixes.length + workspaceAppPrefixes.length,
    );
    for (const prefix of publicAppPrefixes) {
      expect(firstBySource.get(`${prefix}/:path+`)).toBe("/public-app.html");
    }
    for (const prefix of workspaceAppPrefixes) {
      expect(firstBySource.get(`${prefix}/:path+`)).toBe("/orders/index.html");
    }
  });

  test("vercel.json redirects mirror the legacy route table", () => {
    expect(vercelJson.redirects).toEqual(
      legacyRedirects.map(([source, destination]) => ({
        source,
        destination,
        permanent: true,
      })),
    );
  });

  test("no stale static route files are resurrected", () => {
    expect(existsSync(`${REPO}apps/web/public/_redirects`)).toBe(false);
  });
});
