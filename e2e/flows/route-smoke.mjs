/**
 * FL-BROWSER smoke: visit every route in route-table at 1440 and 375.
 * Captures console errors. No wallet tier — page loads only.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;
const routeTable = readFileSync(`${ROOT}/apps/web/src/route-table.ts`, "utf8");
const routes = [...new Set([...routeTable.matchAll(/"(\/[a-z0-9/_-]*)"/gi)].map((m) => m[1]))];
const appHtml = `${ROOT}/dist/app.html`;
const pubHtml = `${ROOT}/dist/public-app.html`;

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MILO_CHROME_PATH ? { executablePath: process.env.MILO_CHROME_PATH } : {}),
});
const out = { routes: routes.length, consoleErrors: [], failedRequests: [], widths: [1440, 375] };
for (const width of out.widths) {
  for (const route of routes) {
    const isApp = /^\/(orders|merchant|operator|account|connections|sign-in)/.test(route);
    const file = isApp ? appHtml : pubHtml;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("console", (m) => {
      if (m.type() === "error") out.consoleErrors.push(`${route}@${width}: ${m.text().slice(0, 120)}`);
    });
    page.on("requestfailed", (r) => {
      out.failedRequests.push(`${route}@${width}: ${r.url().slice(0, 80)}`);
    });
    await page.goto(`${process.env.MILO_SMOKE_BASE || "http://127.0.0.1:3180"}${isApp ? "/app.html" : "/public-app.html"}#${route}`, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: `${ROOT}/test-results/flow-${route.replace(/\//g, "_")}-${width}.png` });
    await page.close();
  }
}
await browser.close();
mkdirSync(`${ROOT}/e2e/flows`, { recursive: true });
writeFileSync(`${ROOT}/e2e/flows/route-smoke-result.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ routes: out.routes, consoleErrors: out.consoleErrors.length, failedRequests: out.failedRequests.length }));
if (out.consoleErrors.length > 0) process.exitCode = 1;
