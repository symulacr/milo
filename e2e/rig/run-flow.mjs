/**
 * e2e/rig runner.
 *
 * Runs one flow, or a subset, N times, and writes one comparable record per
 * run plus a median/p95 summary per flow. Everything a later wave needs to
 * call this "the BEFORE baseline" comes out of a single invocation:
 *
 *   e2e/rig/out/<label>/<flow-id>/run-<n>/trace.zip
 *   e2e/rig/out/<label>/<flow-id>/run-<n>/video.webm
 *   e2e/rig/out/<label>/<flow-id>/run-<n>/steps/<n>-<label>.png
 *   e2e/rig/out/<label>/<flow-id>/run-<n>/network.har
 *   e2e/rig/out/<label>/<flow-id>/run-<n>/run.json
 *   e2e/rig/out/<label>/summary.json
 *   e2e/rig/out/<label>/b1-flows.csv
 *
 * Usage:
 *   node e2e/rig/run-flow.mjs --list
 *   node e2e/rig/run-flow.mjs --flow B1-F001 B1-F001N --runs 5
 *   node e2e/rig/run-flow.mjs --all --runs 5 --serve
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import {
  captureHeader,
  CLICK_COST_FIELDS,
  compareCaptures,
  summariseFlow,
  summariseRun,
} from "./click-cost.mjs";
import { describeEnv, loadRigEnv, waitForServer } from "./env.mjs";
import { FLOW_CATALOG, selectFlows, toCsv } from "./flows.mjs";
import { AXE_RUN_OPTIONS, installInstrumentation } from "./instrumentation.mjs";
import {
  fetchLaceArtifact,
  mockWalletInitScript,
  walletEvidence,
} from "./wallet.mjs";

const STEP_TIMEOUT = 20000;

function parseArgs(argv) {
  const args = { flow: [], runs: 0, out: "", label: "baseline", serve: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--list") args.list = true;
    else if (flag === "--all") args.all = true;
    else if (flag === "--flow") {
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        args.flow.push(argv[i]);
        i += 1;
      }
      i -= 1;
    } else if (flag === "--runs") { i += 1; args.runs = Number(argv[i]); }
    else if (flag === "--out") { i += 1; args.out = argv[i]; }
    else if (flag === "--label") { i += 1; args.label = argv[i]; }
    else if (flag === "--serve") args.serve = true;
    else if (flag === "--headed") args.headed = true;
    else if (flag === "--reduced-motion") args.reducedMotion = true;
    else if (flag === "--xvfb") args.xvfb = true;
    else if (flag === "--extension") { i += 1; args.extension = argv[i]; }
    else if (flag === "--wallet-evidence") args.walletEvidence = true;
    else if (flag === "--fetch-lace") args.fetchLace = true;
    else throw new Error(`Unknown flag ${flag}. Try --list.`);
  }
  return args;
}

async function startXvfb() {
  for (let display = 90; display < 130; display += 1) {
    if (existsSync(`/tmp/.X${display}-lock`)) continue;
    const child = spawn(
      "Xvfb",
      [`:${display}`, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"],
      { stdio: "ignore", detached: true },
    );
    await new Promise((done) => setTimeout(done, 1500));
    if (child.exitCode === null) {
      return { display: `:${display}`, stop: () => child.kill("SIGTERM") };
    }
  }
  throw new Error("No free X display for Xvfb.");
}

async function startDevServer(env) {
  const children = [];
  const dev = spawn("bun", ["run", "dev"], {
    cwd: env.repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TMPDIR: env.tmpDir },
  });
  children.push(dev);
  const bridge = spawn(
    "socat",
    [
      `TCP-LISTEN:${env.bridgePort},fork,reuseaddr,bind=127.0.0.1`,
      `TCP:127.0.0.1:${env.upstreamPort}`,
    ],
    { stdio: "ignore" },
  );
  children.push(bridge);
  const up = await waitForServer(env.baseUrl, { attempts: 120, delayMs: 500 });
  if (!up) {
    for (const child of children) child.kill("SIGTERM");
    throw new Error(
      `Dev server never answered on ${env.baseUrl}. scripts/dev.ts serves on port ${env.upstreamPort} and the rig bridges ${env.bridgePort}.`,
    );
  }
  return {
    children,
    stop: () => {
      for (const child of children) child.kill("SIGTERM");
    },
  };
}

const MOCK_MODES = {
  "mock-connected": { mode: "connected" },
  "mock-reject": { mode: "reject" },
  "mock-locked": { mode: "locked" },
  "mock-wrong-network": { mode: "wrong-network" },
  "mock-two": { mode: "connected" },
};

function privyMockScript() {
  return `globalThis.__QA_PRIVY__ = { ready: true, authenticated: true, user: { id: "did:privy:qa-buyer" } };`;
}

async function installMockWallets(context, flowEntry) {
  const config = MOCK_MODES[flowEntry.wallet];
  if (!config) return;
  const registry = mockWalletInitScript(config);
  if (flowEntry.wallet === "mock-two") {
    const second = mockWalletInitScript({ mode: "connected" }).replace(
      /io\.milo\.rig\.mock-wallet/g,
      "io.milo.rig.mock-wallet-second",
    );
    await context.addInitScript({ content: `${registry}\n${second}` });
    return;
  }
  await context.addInitScript({ content: registry });
}

async function runAxe(context, axeSource, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: axeSource });
    return await page.evaluate(async (options) => {
      const results = await window.axe.run(document, options);
      return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        help: violation.help,
      }));
    }, AXE_RUN_OPTIONS);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * HAR byte totals. With recordHar content:"omit" Playwright writes bodySize -1,
 * so the Content-Length response header is the honest byte source; it is the
 * same number the server declared on the wire.
 */
export function summariseHar(path) {
  if (!path || !existsSync(path)) return null;
  const har = JSON.parse(readFileSync(path, "utf8"));
  let responseBytes = 0;
  let failed = 0;
  for (const entry of har.log.entries) {
    const declared = entry.response.headers?.find(
      (header) => header.name.toLowerCase() === "content-length",
    );
    const size =
      entry.response.bodySize >= 0
        ? entry.response.bodySize
        : Number(declared?.value ?? 0);
    responseBytes += Number.isFinite(size) && size > 0 ? size : 0;
    if (entry.response.status >= 400) failed += 1;
  }
  return {
    requestCount: har.log.entries.length,
    responseBytes,
    failedRequestCount: failed,
  };
}

async function executeStep(page, context, state, step, index) {
  const locator = (selector) => page.locator(selector).first();
  const screenshot = async (label) => {
    const file = join(state.stepDir, `${String(index).padStart(2, "0")}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
  };

  if (step.goto !== undefined) {
    await page.goto(`${state.baseUrl}${step.goto}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(400);
    return "goto";
  }
  if (step.click) { await locator(step.click).click({ timeout: STEP_TIMEOUT }); return "click"; }
  if (step.check) { await locator(step.check).check({ timeout: STEP_TIMEOUT }); return "check"; }
  if (step.uncheck) { await locator(step.uncheck).uncheck({ timeout: STEP_TIMEOUT }); return "uncheck"; }
  if (step.fill) { await locator(step.fill).fill(step.value, { timeout: STEP_TIMEOUT }); return "fill"; }
  if (step.select) { await locator(step.select).selectOption(String(step.value), { timeout: STEP_TIMEOUT }); return "select"; }
  if (step.press) {
    for (let i = 0; i < (step.times ?? 1); i += 1) {
      await page.keyboard.press(step.press);
    }
    return "press";
  }
  if (step.expectVisible) {
    if (step.optional) {
      await locator(step.expectVisible).waitFor({ state: "attached", timeout: 4000 }).catch(() => {});
      return "expectVisible";
    }
    await locator(step.expectVisible).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
    return "expectVisible";
  }
  if (step.expectHidden) { await locator(step.expectHidden).waitFor({ state: "hidden", timeout: STEP_TIMEOUT }); return "expectHidden"; }
  if (step.expectText) {
    await page
      .locator(`body:has-text(${JSON.stringify(step.expectText)})`)
      .first()
      .waitFor({ state: "visible", timeout: STEP_TIMEOUT });
    return "expectText";
  }
  if (step.expectDisabled) { await locator(step.expectDisabled).waitFor({ state: "visible" }); const disabled = await locator(step.expectDisabled).isDisabled(); if (!disabled) throw new Error(`${step.expectDisabled} was not disabled`); return "expectDisabled"; }
  if (step.expectFocused) { await locator(step.expectFocused).waitFor({ state: "visible" }); const focused = await locator(step.expectFocused).evaluate((el) => el === document.activeElement); if (!focused) throw new Error(`${step.expectFocused} did not hold focus`); return "expectFocused"; }
  if (step.expectInvalid) {
    const valid = await locator(step.expectInvalid).evaluate((el) => el.checkValidity());
    if (valid) throw new Error(`${step.expectInvalid} reported itself valid`);
    return "expectInvalid";
  }
  if (step.expectReducedMotion) {
    const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (!reduced) throw new Error("prefers-reduced-motion was not active");
    return "expectReducedMotion";
  }
  if (step.expectNoHorizontalOverflow) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`horizontal overflow of ${overflow}px`);
    return "expectNoHorizontalOverflow";
  }
  if (step.expectNoPageErrors) {
    if (state.pageErrors.length > 0) throw new Error(`page errors: ${state.pageErrors.join(" | ").slice(0, 200)}`);
    return "expectNoPageErrors";
  }
  if (step.expectPublicConfigKeys) {
    const response = await fetch(`${state.baseUrl}/api/public-config`);
    const body = await response.json();
    const keys = Object.keys(body).sort();
    const wanted = [...step.expectPublicConfigKeys].sort();
    if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
      throw new Error(`public-config keys ${keys.join(",")} != ${wanted.join(",")}`);
    }
    return "expectPublicConfigKeys";
  }
  if (step.faultPublicConfig !== undefined) {
    // "abort" reproduces a dropped network, "500" a server fault. Both are
    // faults a person hits; they fail in different code paths.
    if (step.faultPublicConfig === "abort") {
      await context.route("**/api/public-config", (route) => route.abort("internetdisconnected"));
    } else if (step.faultPublicConfig) {
      await context.route("**/api/public-config", (route) =>
        route.fulfill({ status: 500, body: "rig induced fault" }),
      );
    } else {
      await context.unroute("**/api/public-config");
    }
    return "faultPublicConfig";
  }
  if (step.scrollTo) { await locator(step.scrollTo).scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT }); return "scrollTo"; }
  if (step.focus) {
    await locator(step.focus).focus({ timeout: STEP_TIMEOUT });
    return "focus";
  }
  if (step.reload) { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(400); return "reload"; }
  if (step.back) { await page.goBack({ waitUntil: "domcontentloaded" }); return "back"; }
  if (step.forward) { await page.goForward({ waitUntil: "domcontentloaded" }); return "forward"; }
  if (step.offline !== undefined) {
    await context.setOffline(step.offline);
    return step.offline ? "offline" : "online";
  }
  if (step.markGoal) {
    const elapsed = await page.evaluate((name) => window.__MILO_RIG__.markGoal(name), step.markGoal);
    if (typeof elapsed !== "number") throw new Error("instrumentation was not installed");
    state.goalMs = elapsed;
    await screenshot("goal");
    return "markGoal";
  }
  throw new Error(`Unknown step kind: ${JSON.stringify(step)}`);
}

async function runOnce(env, flowEntry, runIndex, runDir, options) {
  rmSync(runDir, { recursive: true, force: true });
  const stepDir = join(runDir, "steps");
  mkdirSync(stepDir, { recursive: true });

  const viewport =
    flowEntry.viewport === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 };

  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  if (env.extensionDir) {
    args.push(
      `--disable-extensions-except=${env.extensionDir}`,
      `--load-extension=${env.extensionDir}`,
    );
  }

  const context = await chromium.launchPersistentContext(
    join(env.profileDir, `${flowEntry.id}-${runIndex}`),
    {
      executablePath: env.executablePath,
      headless: env.headless,
      args,
      viewport,
      recordVideo: { dir: join(runDir, "video"), size: viewport },
      recordHar: { path: join(runDir, "network.har"), mode: "minimal", content: "omit" },
      reducedMotion: flowEntry.reducedMotion ? "reduce" : "no-preference",
      ignoreHTTPSErrors: true,
    },
  );

  const axeSource = readFileSync(env.axePath, "utf8");
  const consoleErrors = [];
  const pageErrors = [];
  const streamed = [];
  let mainPage = null;
  const startedAt = Date.now();
  const state = {
    baseUrl: env.baseUrl,
    stepDir,
    pageErrors,
    goalMs: null,
  };

  // Only the flow's own page feeds the counters. A persistent context always has an
  // about:blank page before newPage() below, and it emits a navigation, so a guard
  // written as `mainPage && source.page !== mainPage` cannot filter it: mainPage is
  // still undefined when that page fires. Require the page to BE mainPage instead.
  await context.exposeBinding("__miloRigEmit", (source, record) => {
    if (!mainPage || source.page !== mainPage) return;
    streamed.push(record);
  });
  await context.addInitScript(installInstrumentation, {
    runId: `${flowEntry.id}-${runIndex}`,
    flowId: flowEntry.id,
    startedAt,
  });
  if (flowEntry.auth === "qa-privy-mock") {
    await context.addInitScript({ content: privyMockScript() });
  }
  await installMockWallets(context, flowEntry);

  const videoDir = join(runDir, "video");
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = await context.newPage();
  mainPage = page;
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 300)));

  const stepLog = [];
  let failure = null;
  try {
    for (let index = 0; index < flowEntry.steps.length; index += 1) {
      const step = flowEntry.steps[index];
      const started = Date.now();
      try {
        const kind = await executeStep(page, context, state, step, index);
        stepLog.push({ index, kind, ok: true, ms: Date.now() - started });
      } catch (error) {
        stepLog.push({
          index,
          kind: Object.keys(step)[0],
          ok: false,
          ms: Date.now() - started,
          error: String(error.message ?? error).slice(0, 300),
        });
        await page.screenshot({ path: join(stepDir, `${String(index).padStart(2, "0")}-FAIL.png`) }).catch(() => {});
        throw new Error(`step ${index} (${Object.keys(step)[0]}) failed: ${String(error.message ?? error).slice(0, 250)}`);
      }
    }
  } catch (error) {
    failure = error;
  }

  const instrumentation = await page
    .evaluate(() => (window.__MILO_RIG__ ? window.__MILO_RIG__.read() : null))
    .catch(() => null);

  let axe = null;
  if (flowEntry.axe && options.axe) {
    const url = flowEntry.steps.find((step) => step.goto)?.goto ?? "/";
    axe = await runAxe(context, axeSource, `${env.baseUrl}${url}`).catch((error) => [
      { id: "axe-run-failed", impact: "unknown", nodes: 0, help: String(error.message).slice(0, 200) },
    ]);
  }

  const videoPath = page.video() ? await page.video().path() : null;
  await context.tracing.stop({ path: join(runDir, "trace.zip") }).catch(() => {});
  await context.close().catch(() => {});
  if (videoPath && existsSync(videoPath)) {
    writeFileSync(join(runDir, "video.webm"), readFileSync(videoPath));
    rmSync(videoDir, { recursive: true, force: true });
  }

  const har = summariseHar(join(runDir, "network.har"));
  const events = streamed.length > 0 ? streamed : (instrumentation?.events ?? []);
  const summary = summariseRun({
    flowId: flowEntry.id,
    runIndex,
    events,
    har,
    axe,
    ok: failure === null,
    error: failure,
  });

  const record = {
    ...summary,
    blocked: flowEntry.blocked,
    viewport,
    reducedMotion: flowEntry.reducedMotion,
    walletMode: flowEntry.wallet,
    authMode: flowEntry.auth,
    consoleErrors,
    pageErrors,
    steps: stepLog,
    finalUrl: page.url(),
    artifacts: {
      trace: "trace.zip",
      video: existsSync(join(runDir, "video.webm")) ? "video.webm" : null,
      har: "network.har",
      steps: "steps/",
    },
  };
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const entry of FLOW_CATALOG) {
      const twin = entry.twinOf ? ` (twin of ${entry.twinOf})` : "";
      console.log(`${entry.id}\t${entry.group}\t${entry.route}\t${entry.goal}${twin}`);
    }
    console.log(`\n${FLOW_CATALOG.length} flows.`);
    return;
  }

  const env = loadRigEnv({
    headless: args.headed ? false : undefined,
    reducedMotion: args.reducedMotion ? true : undefined,
    extensionDir: args.extension ?? undefined,
    runs: Number.isInteger(args.runs) && args.runs > 0 ? args.runs : undefined,
  });

  let xvfb = null;
  if (args.xvfb || !env.headless) {
    xvfb = await startXvfb();
    process.env.DISPLAY = xvfb.display;
  }

  let server = null;
  if (args.serve) server = await startDevServer(env);
  else if (!(await waitForServer(env.baseUrl, { attempts: 4, delayMs: 250 }))) {
    throw new Error(
      `Nothing is serving ${env.baseUrl}. Start the app with \`bun run dev\` in ${env.repoRoot} plus \`socat TCP-LISTEN:${env.bridgePort},fork TCP:127.0.0.1:${env.upstreamPort}\`, or re-run with --serve.`,
    );
  }

  const flows = args.all ? FLOW_CATALOG : selectFlows(args.flow);
  const outDir = args.out
    ? resolve(args.out)
    : join(resolve(env.repoRoot, "e2e/rig/out"), args.label);
  mkdirSync(outDir, { recursive: true });

  const summary = [];
  const measured = new Map();
  for (const flowEntry of flows) {
    const flowDir = join(outDir, flowEntry.id);
    mkdirSync(flowDir, { recursive: true });
    const runs = [];
    for (let runIndex = 1; runIndex <= env.runs; runIndex += 1) {
      const record = await runOnce(env, flowEntry, runIndex, join(flowDir, `run-${runIndex}`), {
        axe: flowEntry.axe,
      });
      runs.push(record);
      console.log(
        `${flowEntry.id} run ${runIndex}/${env.runs}: ${record.ok ? "ok" : "FAIL"} clicks=${record.clicks} goal=${record.timeToGoalMs}ms axe=${record.axeViolations}`,
      );
    }
    const flowSummary = summariseFlow(flowEntry.id, runs);
    measured.set(flowEntry.id, flowSummary);
    summary.push(flowSummary);
    writeFileSync(join(flowDir, "summary.json"), `${JSON.stringify(flowSummary, null, 2)}\n`);
  }

  const capture = {
    header: captureHeader(args.label, env, { runs: env.runs }),
    metrics: CLICK_COST_FIELDS,
    flows: summary.map((row) => ({
      ...row,
      runs_detail: undefined,
    })),
    blocked: flows
      .filter((entry) => entry.blocked)
      .map((entry) => ({ id: entry.id, blocked: entry.blocked })),
  };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(capture, null, 2)}\n`);
  writeFileSync(join(outDir, "b1-flows.csv"), `${toCsv(measured)}\n`);

  if (args.walletEvidence) {
    let crxPath = process.env.MILO_LACE_CRX ?? "";
    let unpackedDir = env.extensionDir || process.env.MILO_LACE_UNPACKED || "";
    let downloadError = null;
    if (args.fetchLace) {
      const fetched = await fetchLaceArtifact(join(env.tmpDir, "lace")).catch((error) => {
        downloadError = String(error.message ?? error);
        return null;
      });
      if (fetched) {
        crxPath = fetched.crxPath;
        unpackedDir = fetched.unpackedDir;
      }
    }
    const evidence = await walletEvidence({
      env,
      crxPath,
      unpackedDir,
      mockRun: summary.filter((row) => row.flowId.startsWith("B1-F02")),
    });
    evidence.attempt1_realLacePreprod.download = downloadError
      ? { attempted: true, ok: false, error: downloadError }
      : { attempted: Boolean(args.fetchLace), ok: true };
    writeFileSync(join(outDir, "wallet-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Wrote ${join(outDir, "wallet-evidence.json")}`);
  }

  console.log(`\nWrote ${join(outDir, "summary.json")}`);
  console.log(`Wrote ${join(outDir, "b1-flows.csv")}`);

  if (server) server.stop();
  if (xvfb) xvfb.stop();
}

const isDirect = process.argv[1] && resolve(process.argv[1]).endsWith("run-flow.mjs");
if (isDirect) {
  try {
    await main();
  } catch (error) {
    console.error(String(error.stack ?? error.message ?? error));
    process.exitCode = 1;
  }
}

export { main, runOnce, parseArgs };