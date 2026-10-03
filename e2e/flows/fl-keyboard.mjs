import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const BASE = process.env.MILO_SMOKE_BASE || "http://127.0.0.1:3180";
const browser = await chromium.launch({ headless: true, ...(process.env.MILO_CHROME_PATH ? { executablePath: process.env.MILO_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const out = { flow: "keyboard", passes: [], fails: [] };
async function step(name, fn) {
  try { await fn(); out.passes.push(name); console.log("PASS", name); }
  catch (e) { out.fails.push(`${name}: ${String(e).slice(0,120)}`); console.log("FAIL", name); }
}
await step("public route keyboard focus reaches nav", async () => {
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}:${el.textContent?.slice(0, 30) || el.getAttribute("aria-label") || ""}` : "none";
  });
  if (!/A|BUTTON/i.test(active)) throw new Error(`first focus ${active}`);
  out.firstFocus = active;
});
await step("skip link is first focusable", async () => {
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  const skipIndex = await page.evaluate(() => {
    const els = [...document.querySelectorAll("a,button,input,summary,select,textarea")];
    return els.findIndex((el) => el.classList.contains("skip-link"));
  });
  if (skipIndex !== 0) throw new Error(`skipIndex=${skipIndex}`);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const t = await page.evaluate(() => (document.activeElement?.textContent || "").trim());
  if (!/skip/i.test(t)) throw new Error(`first tab ${t}`);
});
await step("orders route keyboard reaches form controls", async () => {
  await page.goto(`${BASE}/orders`, { waitUntil: "domcontentloaded" });
  let hits = 0;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName || "");
    if (/INPUT|BUTTON|SELECT|TEXTAREA|A/.test(tag)) hits++;
  }
  if (hits < 2) throw new Error(`only ${hits} focusable`);
});
writeFileSync("e2e/flows/keyboard-result.json", JSON.stringify(out, null, 2));
await browser.close();
if (out.fails.length) process.exitCode = 1;
