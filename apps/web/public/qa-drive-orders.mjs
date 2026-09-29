import fs from "node:fs";
import { chromium } from "/home/eya/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs";

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/eya/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:3000/orders", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(1500);
const body = await page.locator("body").innerText();
fs.writeFileSync("/tmp/milo-qa/orders-no-privy.txt", body);
console.log(body.slice(0, 2000));
const has =
  body.includes("Privy is not configured") &&
  body.includes("Order console") &&
  body.includes("Unavailable");
console.log("CHECK", has ? "PASS" : "FAIL");
await page.screenshot({
  path: "/tmp/milo-qa/orders-no-privy.png",
  fullPage: true,
});
await browser.close();
