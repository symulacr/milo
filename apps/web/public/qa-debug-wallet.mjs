import { chromium } from "/home/eya/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs";

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/eya/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) =>
  console.log("CONSOLE", m.type(), m.text().slice(0, 200)),
);

await page.goto("http://127.0.0.1:3000/qa-reserve-ui.html", {
  waitUntil: "networkidle",
});
await page.waitForTimeout(1000);

const buttons = await page.locator("button").all();
for (const b of buttons) {
  const text = (await b.innerText()).replace(/\n/g, " ");
  const dis = await b.isDisabled();
  console.log("BUTTON", JSON.stringify(text), `disabled=${dis}`);
}

// Click first Connect*
const connect = page.locator("button", { hasText: /Connect/i }).first();
console.log(
  "CLICKING",
  await connect.innerText(),
  "disabled=",
  await connect.isDisabled(),
);
await connect.click({ force: true });
await page.waitForTimeout(1500);

const statuses = await page.locator('[role="status"]').allInnerTexts();
console.log("STATUS NODES:");
statuses.forEach((s, i) => {
  console.log(i, JSON.stringify(s.slice(0, 200)));
});

// Set reject mode and remount
await page.getByTestId("wallet-reject").click();
await page.waitForTimeout(800);
console.log("--- after wallet-reject ---");
const buttons2 = await page.locator("button").all();
for (const b of buttons2) {
  const text = (await b.innerText()).replace(/\n/g, " ");
  if (/Connect|Forget|Prepare/i.test(text))
    console.log(
      "BUTTON",
      JSON.stringify(text),
      "disabled=",
      await b.isDisabled(),
    );
}
const connect2 = page.locator("button", { hasText: /Connect/i }).first();
console.log("CLICKING2", await connect2.innerText());
await connect2.click({ force: true });
await page.waitForTimeout(1500);
const statuses2 = await page.locator('[role="status"]').allInnerTexts();
console.log("STATUS2:");
statuses2.forEach((s, i) => {
  console.log(i, JSON.stringify(s.slice(0, 220)));
});

// Try evaluate discoverWallets state
const midnight = await page.evaluate(() => {
  const w = window.midnight;
  return {
    has: !!w,
    keys: w ? Object.keys(w) : [],
    sample: w
      ? Object.values(w).map((x) => ({
          apiVersion: x?.apiVersion,
          hasConnect: typeof x?.connect === "function",
          name: x?.name,
        }))
      : [],
  };
});
console.log("WINDOW.MIDNIGHT", JSON.stringify(midnight));

await browser.close();
