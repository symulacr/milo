/**
 * PR7 — axe-core on every route in route-table (public + workspace + prefix).
 * Acceptance: 0 serious/critical.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = "/home/eya/milo/milo-main";
const DIST = join(ROOT, "dist");
const AXE = readFileSync(
  join(ROOT, "node_modules/axe-core/axe.min.js"),
  "utf8",
);

// Parse route-table.ts for route strings
const routeTable = readFileSync(
  join(ROOT, "apps/web/src/route-table.ts"),
  "utf8",
);
const routes = [];
for (const m of routeTable.matchAll(/"(\/[a-z0-9/_-]*)"/gi)) {
  routes.push(m[1]);
}
const unique = [...new Set(routes)];
console.log("routes", unique.length, unique.join(","));

const htmlFor = (route) => {
  if (
    route.startsWith("/m/") ||
    route.startsWith("/orders") ||
    route.startsWith("/merchant") ||
    route.startsWith("/operator") ||
    route.startsWith("/account") ||
    route.startsWith("/connections") ||
    route.startsWith("/sign-in")
  ) {
    return "app.html";
  }
  return "public-app.html";
};

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
});
const results = [];
for (const route of unique) {
  const html = htmlFor(route);
  const file = join(DIST, html);
  if (!existsSync(file)) {
    results.push({ route, html, serious: ["missing-dist"], other: [] });
    continue;
  }
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const url = pathToFileURL(file).href + "#" + route;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: AXE });
  const raw = await page.evaluate(async () => {
    return await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
  });
  const serious = raw.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}:${v.nodes.length}`);
  const other = raw.violations
    .filter((v) => v.impact !== "serious" && v.impact !== "critical")
    .map((v) => v.id);
  results.push({ route, html, serious, other });
  console.log(JSON.stringify({ route, serious, otherCount: other.length }));
  await page.close();
}
await browser.close();


// 375px pass
for (const route of unique) {
  const html = htmlFor(route);
  const file = join(DIST, html);
  if (!existsSync(file)) continue;
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(pathToFileURL(file).href + "#" + route, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: AXE });
  const raw = await page.evaluate(async () => {
    return await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
  });
  const serious = raw.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}:${v.nodes.length}`);
  results.push({ route: route + "@375", html, serious, other: [] });
  console.log(JSON.stringify({ route: route + "@375", serious }));
  await page.close();
}

const seriousTotal = results.reduce((n, r) => n + r.serious.length, 0);
const report = {
  evidenceId: "obs_pr7_axe_all_routes_1",
  at: new Date().toISOString(),
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
