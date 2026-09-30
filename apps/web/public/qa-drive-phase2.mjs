import fs from "node:fs";
import { chromium } from "~/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs";

const OUT = "/tmp/milo-qa";
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
function rec(url, action, observedText, observedState, chainResult, passFail) {
  rows.push({
    url,
    action,
    observedText,
    observedState,
    chainResult,
    passFail,
  });
  console.log(
    "REC",
    passFail,
    "|",
    action,
    "|",
    String(observedText).slice(0, 160).replace(/\n/g, " "),
  );
}

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLEERR", m.text().slice(0, 200));
});

const URL = "http://127.0.0.1:3000/qa-reserve-ui.html";
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

const body = await page.locator("body").innerText();
fs.writeFileSync(`${OUT}/qa-initial.txt`, body);
console.log(`=== QA INITIAL ===\n${body.slice(0, 2500)}`);

rec(
  URL,
  "LOAD qa-reserve-ui.html",
  body.includes("Order recovery context")
    ? "RecoveryKitPanel mounted"
    : "panel missing",
  body.includes("Sign in above") ? "unauthenticated" : "authenticated-or-idle",
  "QA harness with Privy stub",
  body.includes("Order recovery context") ? "PASS" : "FAIL",
);

// --- Unauthenticated fail-closed (flip Privy stub) ---
await page.evaluate(() => {
  globalThis.__QA_PRIVY__ = {
    ready: true,
    authenticated: false,
    user: undefined,
  };
});
// Force re-render by remounting is hard; the stub is read on each usePrivy call.
// Instead we reload after setting a query flag... simpler: evaluate a reload with init script.
// Use addInitScript before reload.
await page.addInitScript(() => {
  globalThis.__QA_PRIVY__ = {
    ready: true,
    authenticated: false,
    user: undefined,
  };
});
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
let t = await page.locator("body").innerText();
fs.writeFileSync(`${OUT}/qa-unauth.txt`, t);
rec(
  URL,
  "FORCE unauthenticated Privy stub",
  t.includes("Sign in above to bind the order actor")
    ? "Sign in above to bind the order actor. The recovery context is scoped to that identity and to one order nonce."
    : t.slice(0, 300),
  "recovery-unauthenticated",
  "Reserve/Checkpoint not offered",
  t.includes("Sign in above to bind the order actor") ? "PASS" : "FAIL",
);

// Restore authenticated
await page.addInitScript(() => {
  globalThis.__QA_PRIVY__ = {
    ready: true,
    authenticated: true,
    user: { id: "did:privy:qa-buyer" },
  };
});
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
t = await page.locator("body").innerText();
rec(
  URL,
  "RESTORE authenticated Privy stub",
  t.includes("Order recovery context") && t.includes("Buyer reserve")
    ? "Order recovery context + Buyer reserve mounted"
    : t.slice(0, 300),
  "recovery-authenticated",
  "Prepare/checkpoint gates live",
  t.includes("Buyer reserve") ? "PASS" : "FAIL",
);

// --- Kit lifecycle on RecoveryKitPanel ---
// Enter nonce and prepare
const nonceInput = page.locator('input[type="text"]').first();
await nonceInput.fill("order-qa-42");
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
rec(
  URL,
  "TYPE order nonce order-qa-42",
  (
    t.match(/No local recovery context[^\n]*|Local recovery context[^\n]*/g) ||
    []
  ).join(" || "),
  "kit-absent",
  "Prepare local context enabled when bound",
  /No local recovery context|Local recovery context/.test(t) ? "PASS" : "FAIL",
);

const prepareLocal = page.getByRole("button", {
  name: "Prepare local context",
});
await prepareLocal.click();
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
rec(
  URL,
  "CLICK Prepare local context",
  (
    t.match(
      /Local recovery context created[^\n]*|Recovery context saved[^\n]*|could not be created[^\n]*/g,
    ) || []
  ).join(" || "),
  "kit-EXPORTED",
  "Stage EXPORTED; Verify enabled",
  /Local recovery context created|Recovery context saved/.test(t)
    ? "PASS"
    : "FAIL",
);

const verifyBtn = page.getByRole("button", { name: "Verify context" });
const verifyDisabled = await verifyBtn.isDisabled();
rec(
  URL,
  "PROBE Verify context",
  `disabled=${verifyDisabled}`,
  verifyDisabled ? "verify-blocked" : "verify-ready",
  "EXPORTED → VERIFIED",
  verifyDisabled ? "FAIL" : "PASS",
);
await verifyBtn.click();
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
rec(
  URL,
  "CLICK Verify context",
  (
    t.match(
      /Local recovery context verified[^\n]*|Recovery context saved[^\n]*/g,
    ) || []
  ).join(" || "),
  "kit-VERIFIED",
  "Checkpoint section appears",
  /verified|Recovery context saved/i.test(t) ? "PASS" : "FAIL",
);

// Checkpoint: empty address blocked
t = await page.locator("body").innerText();
const checkpointCopy = (
  t.match(
    /No confirmed deployment[^\n]*|An observed canonical address[^\n]*|An order nonce is not[^\n]*|Ready to checkpoint[^\n]*|Create and verify[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "OBSERVE CheckpointSection default (no address)",
  checkpointCopy || t.slice(0, 400),
  "checkpoint-blocked",
  "deployment-not-observable / address-missing",
  checkpointCopy.length ? "PASS" : "FAIL",
);

// Checkpoint with order nonce as address
const addrInput = page.locator('input[type="text"]').nth(1);
await addrInput.fill("order-qa-42");
await page.waitForTimeout(200);
t = await page.locator("body").innerText();
const nonceAsAddr = (
  t.match(/An order nonce is not[^\n]*|Ready to checkpoint[^\n]*/g) || []
).join(" || ");
rec(
  URL,
  "TYPE order nonce as canonical address",
  nonceAsAddr || t.slice(0, 300),
  "address-is-order-nonce",
  "Blocked: nonce is never an address",
  /An order nonce is not/.test(nonceAsAddr) ? "PASS" : "FAIL",
);

const cpBtn = page.getByRole("button", { name: "Checkpoint address" });
rec(
  URL,
  "PROBE Checkpoint address with nonce",
  `disabled=${await cpBtn.isDisabled()}`,
  "checkpoint-disabled",
  "Fail-closed",
  (await cpBtn.isDisabled()) ? "PASS" : "FAIL",
);

// Checkpoint with a real-shaped address
await addrInput.fill("0xqa_deployed_contract");
await page.waitForTimeout(200);
t = await page.locator("body").innerText();
rec(
  URL,
  "TYPE observed address 0xqa_deployed_contract",
  (
    t.match(/Ready to checkpoint[^\n]*|No confirmed deployment[^\n]*/g) || []
  ).join(" || "),
  "checkpoint-ready",
  "Checkpoint can bind observation",
  /Ready to checkpoint/.test(t) ? "PASS" : "FAIL",
);
await cpBtn.click();
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
rec(
  URL,
  "CLICK Checkpoint address",
  (
    t.match(
      /bound to 0xqa_deployed_contract[^\n]*|Local recovery context bound[^\n]*|Recovery context saved[^\n]*/g,
    ) || []
  ).join(" || "),
  "kit-CHECKPOINTED",
  "Address bound from supplied observation",
  /bound to 0xqa_deployed_contract|Local recovery context bound/.test(t)
    ? "PASS"
    : "FAIL",
);

// --- Buyer reserve gates ---
t = await page.locator("body").innerText();
const prepareGate = (
  t.match(
    /Create, verify and checkpoint[^\n]*|A commercial reserve[^\n]*|Capability reported lost[^\n]*|A connected PREPROD[^\n]*|No compatible Midnight[^\n]*|Unsupported Midnight[^\n]*|Buyer private state[^\n]*|Provider assembly[^\n]*|Prerequisites present[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "OBSERVE Prepare reserve gate (kit checkpointed, wallet none)",
  prepareGate || t.slice(0, 400),
  "prepare-blocked-wallet",
  "wallet-missing / wallet-not-connected",
  /No compatible Midnight|A connected PREPROD|wallet/i.test(prepareGate)
    ? "PASS"
    : "FAIL",
);

const prepBtn = page
  .getByRole("button", { name: "Prepare reserve call" })
  .first();
rec(
  URL,
  "PROBE Prepare reserve call",
  `disabled=${await prepBtn.isDisabled()}`,
  "prepare-disabled",
  "Fail-closed without wallet",
  (await prepBtn.isDisabled()) ? "PASS" : "FAIL",
);

// Wallet tests target the checkpointed-kit BuyerReserveSection (reserve-host)
const reserveHost = page.getByTestId("reserve-host");

// Click connect wallet (exact names — avoid matching the "connected" mock chip)
const connectBtn = reserveHost
  .getByRole("button", {
    name: /^Connect a Midnight wallet$|^Connect QA Lace Mock$/,
  })
  .first();
if (await connectBtn.count()) {
  await connectBtn.click().catch(() => {});
  await page.waitForTimeout(800);
  t = await reserveHost.innerText();
  const wmsg = (
    t.match(
      /No compatible Midnight[^\n]*|Connection not established[^\n]*|Not connected[^\n]*|Connected to PREPROD[^\n]*/g,
    ) || []
  ).join(" || ");
  rec(
    URL,
    "CLICK Connect (mock none)",
    wmsg || t.slice(0, 300),
    "wallet-error-unsupported",
    "LaceWalletConnector fail-closed",
    /No compatible Midnight|Connection not established/.test(wmsg)
      ? "PASS"
      : "FAIL",
  );
}

async function clickConnect() {
  const btn = reserveHost
    .getByRole("button", {
      name: /^Connect a Midnight wallet$|^Connect QA Lace Mock$/,
    })
    .first();
  await btn.click().catch(() => {});
  await page.waitForTimeout(1000);
}

// Wallet mock: reject
await page.getByTestId("wallet-reject").click();
await page.waitForTimeout(600);
await clickConnect();
t = await reserveHost.innerText();
let wmsg = (
  t.match(
    /No compatible Midnight[^\n]*|Connection not established[^\n]*|Permission may have been[^\n]*|Not connected[^\n]*|Connected to PREPROD[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "WALLET MODE reject + Connect",
  wmsg || t.slice(0, 300),
  "wallet-rejected",
  "REJECTED_CONNECTION copy (permission declined)",
  /Connection not established|Permission may have been/.test(wmsg)
    ? "PASS"
    : "FAIL",
);

// Wallet mock: wrong-network
await page.getByTestId("wallet-wrong-network").click();
await page.waitForTimeout(600);
await clickConnect();
t = await reserveHost.innerText();
wmsg = (
  t.match(
    /No compatible Midnight[^\n]*|Connection not established[^\n]*|Unsupported Midnight[^\n]*|Permission may have been[^\n]*|Not connected[^\n]*|Connected to PREPROD[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "WALLET MODE wrong-network (mainnet) + Connect",
  wmsg || t.slice(0, 300),
  "wallet-wrong-network",
  "assertSupportedNetwork blocks Mainnet; connector error copy",
  /Connection not established|Unsupported Midnight|Permission may have been/.test(
    wmsg,
  )
    ? "PASS"
    : "FAIL",
);

// Wallet mock: locked
await page.getByTestId("wallet-locked").click();
await page.waitForTimeout(600);
await clickConnect();
t = await reserveHost.innerText();
wmsg = (
  t.match(
    /No compatible Midnight[^\n]*|Connection not established[^\n]*|Permission may have been[^\n]*|Not connected[^\n]*|Connected to PREPROD[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "WALLET MODE locked + Connect",
  wmsg || t.slice(0, 300),
  "wallet-locked",
  "Connector treats lock as fail-closed error",
  /Connection not established|Permission may have been/.test(wmsg)
    ? "PASS"
    : "FAIL",
);

// Wallet mock: connected PREPROD
await page.getByTestId("wallet-connected").click();
await page.waitForTimeout(600);
await clickConnect();
t = await reserveHost.innerText();
wmsg = (
  t.match(
    /Connected to PREPROD[^\n]*|No transaction has been signed[^\n]*|Not connected[^\n]*|Connection not established[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "WALLET MODE connected PREPROD + Connect",
  wmsg || t.slice(0, 300),
  "wallet-connected",
  "Still no signature; prepare gate moves to next missing slot",
  /Connected to PREPROD/.test(wmsg) ? "PASS" : "FAIL",
);

// Prepare gate with connected wallet: expect private-state-missing or providers-incomplete
t = await reserveHost.innerText();
const gate2 = (
  t.match(
    /Buyer private state[^\n]*|Provider assembly[^\n]*|Prerequisites present[^\n]*|A commercial reserve[^\n]*|A connected PREPROD[^\n]*/g,
  ) || []
).join(" || ");
rec(
  URL,
  "OBSERVE Prepare gate after connected wallet",
  gate2 || t.slice(0, 500),
  "prepare-blocked-private-state-or-providers",
  "private-state-missing / providers-incomplete",
  /Buyer private state|Provider assembly/.test(gate2) ? "PASS" : "FAIL",
);

const prepBtn2 = reserveHost
  .getByRole("button", { name: "Prepare reserve call" })
  .first();
rec(
  URL,
  "PROBE Prepare reserve call after connect",
  `disabled=${await prepBtn2.isDisabled()}`,
  "prepare-still-disabled",
  "Fail-closed until private state + providers",
  (await prepBtn2.isDisabled()) ? "PASS" : "FAIL",
);

// --- Runtime probes: stale revision, double submit, confirm no observation ---
await page.getByTestId("reset-kit").click();
await page.waitForTimeout(100);
await page.getByTestId("begin-stale").click();
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
const stale = (t.match(/\[begin-error\][^\n]*|\[begin\][^\n]*/g) || []).join(
  " || ",
);
rec(
  URL,
  "CLICK Begin @rev 1 STALE (applied 5)",
  stale || t.slice(0, 400),
  "stale-revision",
  "beginOperation: operation revision is stale",
  /stale/i.test(stale) ? "PASS" : "FAIL",
);

await page.getByTestId("reset-kit").click();
await page.waitForTimeout(100);
await page.getByTestId("begin-dup").click();
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
const dup = (t.match(/\[begin[^\]]*\][^\n]*/g) || []).join(" || ");
rec(
  URL,
  "CLICK Double submit (two begins)",
  dup || t.slice(0, 400),
  "double-submit",
  "second begin blocked: an operation is already pending",
  /already pending/i.test(dup) ? "PASS" : "FAIL",
);

await page.getByTestId("confirm-no-obs").click();
await page.waitForTimeout(300);
t = await page.locator("body").innerText();
const conf = (t.match(/\[confirm-no-observation\][^\n]*/g) || []).join(" || ");
rec(
  URL,
  "CLICK Confirm without observation",
  conf || t.slice(0, 400),
  "no-observation",
  "confirmObservedReserve fails closed; no chain result invented",
  /no-observation|No observed transition/i.test(conf) ? "PASS" : "FAIL",
);

// Lifecycle unavailable steps
t = await page.locator("body").innerText();
const un = (t.match(/Unavailable[^\n]*/g) || []).join(" || ");
rec(
  URL,
  "OBSERVE lifecycle unavailable steps",
  un || "(none)",
  "lifecycle-unavailable",
  "No simulated merchant/approve/capture success",
  un.length ? "PASS" : "FAIL",
);

// Honest copy: no reserve claimed
rec(
  URL,
  "ASSERT no false success copy",
  /Reserve succeeded|Reserve complete|Order placed/i.test(t)
    ? "FALSE SUCCESS FOUND"
    : "No Reserve succeeded / Reserve complete / Order placed",
  "honesty-check",
  "Wallet-signed reserve runtime: UNKNOWN",
  /Reserve succeeded|Reserve complete|Order placed/i.test(t) ? "FAIL" : "PASS",
);

await page.screenshot({ path: `${OUT}/qa-final.png`, fullPage: true });
fs.writeFileSync(`${OUT}/qa-final.txt`, t);
fs.writeFileSync(`${OUT}/rows-phase2.json`, JSON.stringify(rows, null, 2));

await browser.close();
console.log("PHASE2 DONE", rows.length, "rows");
const fails = rows.filter((r) => r.passFail === "FAIL");
console.log("FAILS", fails.length, fails.map((f) => f.action).join(" | "));
