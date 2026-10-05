/**
 * Rig environment resolution for e2e/rig.
 *
 * Every value the rig needs is resolved here exactly once and every missing
 * value is reported in one aggregated, actionable error. Nothing downstream
 * reads process.env directly, so a Wave 3 run either has a complete, verified
 * environment or fails before a browser is opened.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RIG_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(RIG_DIR, "..", "..");

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/** Branded Google Chrome ignores --load-extension from 137 on. Verified in
 * outbox/evidence/I093-browser-extension-matrix.txt, not assumed. */
export const LOAD_EXTENSION_MIN_BRAND_FREE = 137;

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
];

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function isExecutableFile(path) {
  try {
    if (!existsSync(path)) return false;
    if (!statSync(path).isFile()) return false;
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readVersion(binary) {
  try {
    return execFileSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** "Google Chrome 154.0.8037.92" -> branded google, 154. */
export function parseBrowserVersion(raw) {
  const match = /(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!match) return { brand: "unknown", major: 0, raw };
  const major = Number(match[1]);
  const brand = /google chrome/i.test(raw)
    ? "google-chrome"
    : /chromium/i.test(raw)
      ? "chromium"
      : "unknown";
  return { brand, major, raw };
}

/** Playwright's non-branded Chromium, when it was installed locally. */
export function playwrightChromiumCandidates(browsersPath) {
  if (!browsersPath || !existsSync(browsersPath)) return [];
  const out = [];
  for (const entry of ["chromium", "chromium_headless_shell"]) {
    const base = resolve(browsersPath, entry);
    if (!existsSync(base)) continue;
    for (const leaf of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = resolve(base, leaf);
      if (isExecutableFile(candidate)) out.push(candidate);
    }
  }
  return out;
}

/**
 * `--load-extension` works only in a non-branded build running headed (there is
 * a real display). Headless Chromium silently ignores it; branded Chrome has
 * ignored it since 137. See outbox/evidence/I093-browser-extension-matrix.txt.
 */
export function loadExtensionVerdict({ brand, major }) {
  if (brand === "chromium") {
    return {
      supported: true,
      requiresHeaded: true,
      reason: `Chromium ${major} is a non-branded build and honours --load-extension when headed.`,
    };
  }
  if (brand === "google-chrome" && major >= LOAD_EXTENSION_MIN_BRAND_FREE) {
    return {
      supported: false,
      requiresHeaded: false,
      reason: `Branded Chrome ${major} turns --load-extension into a no-op (removed in Chrome 137). Use the Chromium build instead.`,
    };
  }
  return {
    supported: false,
    requiresHeaded: true,
    reason: `Browser brand "${brand}" ${major} has no verified --load-extension support in this rig.`,
  };
}

export function defaultRigOptions() {
  return {
    repoRoot: REPO_ROOT,
    baseUrl: process.env.MILO_DEV_BASE ?? "http://127.0.0.1:22000",
    upstreamPort: Number(process.env.MILO_DEV_UPSTREAM_PORT ?? 3000),
    bridgePort: Number(process.env.MILO_DEV_BASE_PORT ?? 22000),
    tmpDir: process.env.MILO_RIG_TMPDIR ?? "/tmp/w2c",
    headless: process.env.MILO_RIG_HEADED !== "1",
    reducedMotion: process.env.MILO_RIG_REDUCED_MOTION === "1",
    extensionDir: process.env.MILO_RIG_EXTENSION_DIR ?? "",
    runs: Number(process.env.MILO_RIG_RUNS ?? 5),
    axeTags: AXE_TAGS,
    chromePath: process.env.MILO_CHROME_PATH ?? "",
    playwrightBrowsersPath:
      process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve("/tmp/w2c", "pw-browsers"),
  };
}

function requireDir(path, label, problems) {
  if (!existsSync(path)) {
    problems.push(
      `${label} is missing: ${path}. Create it with: mkdir -p ${path}`,
    );
    return false;
  }
  return true;
}

/**
 * Resolve and validate the whole rig environment. Throws one error listing
 * every problem, each with the exact command or variable that fixes it.
 */
export function loadRigEnv(overrides = {}) {
  const options = { ...defaultRigOptions(), ...overrides };
  const problems = [];

  const tmpDir = isAbsolute(options.tmpDir)
    ? options.tmpDir
    : resolve(REPO_ROOT, options.tmpDir);
  const profileDir = resolve(tmpDir, "profile");
  const xdgDir = resolve(tmpDir, "xdg");
  const browsersDir = resolve(tmpDir, "pw-browsers");

  const candidates = options.chromePath
    ? [options.chromePath]
    : [
        ...playwrightChromiumCandidates(options.playwrightBrowsersPath),
        ...CHROME_CANDIDATES,
      ];
  const executablePath = candidates.find(isExecutableFile) ?? "";
  if (!executablePath) {
    problems.push(
      options.chromePath
        ? `MILO_CHROME_PATH points at a missing or non-executable file: ${options.chromePath}`
        : `No usable browser binary. Set MILO_CHROME_PATH, or install Playwright's Chromium with: PLAYWRIGHT_BROWSERS_PATH=${browsersDir} bunx playwright install chromium`,
    );
  }
  const versionRaw = executablePath ? readVersion(executablePath) : "";
  if (executablePath && !versionRaw) {
    problems.push(
      `Browser binary did not report a version: ${executablePath}. Check it runs on this host.`,
    );
  }
  const browser = parseBrowserVersion(versionRaw);
  const extension = loadExtensionVerdict(browser);

  if (options.extensionDir) {
    if (!requireDir(options.extensionDir, "MILO_RIG_EXTENSION_DIR", problems)) {
      // message already pushed
    }
    if (!extension.supported) {
      problems.push(
        `MILO_RIG_EXTENSION_DIR is set but the resolved browser cannot load extensions: ${extension.reason}`,
      );
    }
    if (options.headless) {
      problems.push(
        "Extension runs require a display. Start Xvfb and re-run with MILO_RIG_HEADED=1 (headless Chromium silently ignores --load-extension).",
      );
    }
  }

  const axePath = resolve(
    options.repoRoot,
    "node_modules/axe-core/axe.min.js",
  );
  if (!isExecutableFile(axePath)) {
    problems.push(
      `axe-core is not installed at ${axePath}. Run: cd ${options.repoRoot} && bun install --frozen-lockfile`,
    );
  }
  for (const dir of [tmpDir, profileDir, xdgDir, browsersDir]) {
    mkdirSync(dir, { recursive: true });
  }

  if (!Number.isInteger(options.runs) || options.runs < 5) {
    problems.push(
      `--runs must be an integer >= 5 so median and p95 are meaningful (got ${options.runs}).`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `e2e/rig environment is not usable:\n  - ${problems.join(
        "\n  - ",
      )}\nNo browser was started.`,
    );
  }

  return {
    ...options,
    tmpDir,
    profileDir,
    xdgDir,
    browsersDir,
    executablePath,
    browser,
    extension,
    axePath,
  };
}

/** Wait until the dev server answers 200 on the configured base URL. */
export async function waitForServer(baseUrl, { attempts = 60, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/public-config`, {
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) return true;
    } catch {
      // keep polling
    }
    await new Promise((done) => setTimeout(done, delayMs));
  }
  return false;
}

export function describeEnv(env) {
  return {
    repoRoot: env.repoRoot,
    baseUrl: env.baseUrl,
    executablePath: env.executablePath,
    browser: env.browser,
    loadExtension: env.extension,
    headless: env.headless,
    reducedMotion: env.reducedMotion,
    extensionDir: env.extensionDir || null,
    runs: env.runs,
    axePath: env.axePath,
    profileDir: env.profileDir,
    xdgDir: env.xdgDir,
    browsersDir: env.browsersDir,
  };
}