/**
 * PR7 — axe-core scan of the built static surfaces.
 * Zero serious/critical automated violations is the acceptance bar.
 * color-contrast stays incomplete (manual) per VERIFICATION.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = "/home/eya/milo/milo-main";
const DIST = join(ROOT, "dist");
const AXE = readFileSync(
  join(ROOT, "node_modules/axe-core/axe.min.js"),
  "utf8",
);

const PAGES = [
  { id: "public-app", file: "public-app.html" },
  { id: "index", file: "index.html" },
  { id: "app", file: "app.html" },
];

function classify(impact) {
  return impact === "serious" || impact === "critical";
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
});
const results = [];
for (const pageSpec of PAGES) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const url = pathToFileURL(join(DIST, pageSpec.file)).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: AXE });
  const raw = await page.evaluate(async () => {
    // @ts-expect-error axe is injected
    return await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
  });
  const serious = raw.violations.filter((v) => classify(v.impact));
  const other = raw.violations.filter((v) => !classify(v.impact));
  results.push({
    page: pageSpec.id,
    serious: serious.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
    })),
    other: other.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
    })),
  });
  await page.close();
}
await browser.close();

let seriousTotal = 0;
for (const r of results) {
  seriousTotal += r.serious.length;
  console.log(
    JSON.stringify({
      page: r.page,
      serious: r.serious,
      otherCount: r.other.length,
      otherIds: r.other.map((o) => o.id),
    }),
  );
}
console.log(`PR7_AXE seriousTotal=${seriousTotal}`);
if (seriousTotal > 0) {
  process.exitCode = 1;
} else {
  console.log("PR7_AXE_PASS");
}
