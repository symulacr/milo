/**
 * PR7 — axe-core on every route in route-table, served over HTTP.
 *
 * The previous harness loaded `file://…/app.html#/route` against a
 * `BrowserRouter`. A hash fragment is not a path, so the router rendered the
 * not-found page for every entry and the scan measured one page sixteen times.
 * This version serves `dist/` on loopback, applies the same `_redirects` rules
 * the host applies, and navigates real paths.
 *
 * Acceptance: zero serious or critical violations at 1280 and 375.
 */

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");
const AXE = readFileSync(
  join(ROOT, "node_modules/axe-core/axe.min.js"),
  "utf8",
);

const routeTable = readFileSync(
  join(ROOT, "apps/web/src/route-table.ts"),
  "utf8",
);
/**
 * The table declares public routes, workspace routes and host prefixes. A bare
 * prefix (`/m`, `/quotes`, `/merchant`, `/operator`) is not a page: it is a
 * routing rule, and navigating to it renders the not-found view. Scan the
 * declared routes plus the parameterised pages the router actually serves.
 */
const declared = [
  ...new Set([...routeTable.matchAll(/"(\/[a-z0-9/_-]*)"/gi)].map((m) => m[1])),
];
const prefixes = new Set(["/m", "/quotes", "/merchant", "/operator"]);
const parameterised = [
  "/orders/sample-001",
  "/orders/sample-001/receipt",
  "/quotes/sample-001",
  "/operator/cases/sample-001",
  "/m/north-studio",
];
const unique = [
  ...declared.filter((route) => !prefixes.has(route)),
  ...parameterised,
];

/** Every entry above is already concrete; keep the helper for future routes. */
const concrete = (route) => route;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const redirects = readFileSync(join(DIST, "_redirects"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/))
  .filter((parts) => parts.length >= 2)
  .map(([from, to]) => ({
    from,
    to,
    wildcard: from.endsWith("/*"),
    base: from.replace(/\/\*$/, ""),
  }));

function resolveTarget(pathname) {
  const direct = normalize(join(DIST, pathname));
  if (
    direct.startsWith(DIST) &&
    existsSync(direct) &&
    statSync(direct).isFile()
  )
    return direct;
  const index = normalize(join(DIST, pathname, "index.html"));
  if (index.startsWith(DIST) && existsSync(index)) return index;
  for (const rule of redirects) {
    if (rule.wildcard && pathname.startsWith(rule.base))
      return normalize(join(DIST, rule.to));
    if (!rule.wildcard && rule.from === pathname)
      return normalize(join(DIST, rule.to));
  }
  const fallback = normalize(join(DIST, "app.html"));
  return existsSync(fallback) ? fallback : null;
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(
    new URL(req.url ?? "/", "http://127.0.0.1").pathname,
  );
  const file = resolveTarget(pathname);
  if (!file) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
});

const results = [];
for (const viewport of [
  { width: 1280, height: 800, label: "" },
  { width: 375, height: 812, label: "@375" },
]) {
  for (const route of unique) {
    const path = concrete(route);
    const page = await browser.newPage({ viewport });
    const response = await page.goto(`${origin}${path}`, {
      waitUntil: "networkidle",
    });
    const status = response?.status() ?? 0;
    const heading = await page
      .locator("h1")
      .first()
      .textContent()
      .catch(() => "");
    // A scan of the not-found view is not a scan of the route. Assert the page
    // actually rendered the route before trusting any violation count from it:
    // a 200 alone proves nothing, because the catch-all redirects to app.html.
    const mounted = await page
      .locator("#root > *")
      .count()
      .catch(() => 0);
    const notFound = /not found|page not found/i.test(heading ?? "");
    if (status !== 200 || notFound || mounted === 0) {
      results.push({
        route: `${path}${viewport.label}`,
        status,
        heading: (heading ?? "").trim().slice(0, 60),
        serious: [mounted === 0 ? "did-not-mount" : "did-not-render"],
        other: [],
      });
      await page.close();
      continue;
    }
    await page.addScriptTag({ content: AXE });
    const raw = await page.evaluate(
      async () =>
        await window.axe.run(document, {
          resultTypes: ["violations"],
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        }),
    );
    const serious = raw.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}:${v.nodes.length}`);
    const other = raw.violations
      .filter((v) => v.impact !== "serious" && v.impact !== "critical")
      .map((v) => v.id);
    results.push({
      route: `${path}${viewport.label}`,
      status,
      heading: (heading ?? "").trim().slice(0, 60),
      serious,
      other,
    });
    console.log(
      JSON.stringify({
        route: `${path}${viewport.label}`,
        serious,
        otherCount: other.length,
      }),
    );
    await page.close();
  }
}

await browser.close();
await new Promise((resolve) => server.close(resolve));

const seriousTotal = results.reduce((n, r) => n + r.serious.length, 0);
const report = {
  evidenceId: "obs_pr7_axe_all_routes_2",
  at: new Date().toISOString(),
  origin,
  routes: results.length,
  seriousTotal,
  results,
};
mkdirSync(join(ROOT, "audit/discovery"), { recursive: true });
writeFileSync(
  join(ROOT, "audit/discovery/PR7-axe-all-routes.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `PR7_AXE_ALL seriousTotal=${seriousTotal} routes=${results.length}`,
);
if (seriousTotal > 0) process.exitCode = 1;
else console.log("PR7_AXE_ALL_PASS");
