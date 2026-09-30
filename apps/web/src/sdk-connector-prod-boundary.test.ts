/**
 * D3c — SDK connector is injectable for demo/E2E and eliminated from the
 * production bundle. The public entry never reaches it (demo-boundary).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_SRC = dirname(fileURLToPath(import.meta.url));

describe("D3c SDK-connector-injected, not in prod bundle", () => {
  test("injection module exists and exposes a window handle", () => {
    const inject = readFileSync(
      join(APP_SRC, "sdk-connector-inject.ts"),
      "utf8",
    );
    expect(inject).toContain("walletSdkInitialApi");
    expect(inject).toContain("__MILO_SDK_CONNECTOR__");
    expect(inject).toContain("injectSdkConnector");
  });

  test("workspace entry loads injection only outside production", () => {
    const main = readFileSync(join(APP_SRC, "main.tsx"), "utf8");
    expect(main).toMatch(/process\.env\.NODE_ENV\s*!==\s*["']production["']/);
    expect(main).toContain("sdk-connector-inject");
    // The import must be dynamic so Bun.build can eliminate it.
    expect(main).toMatch(/import\(["']\.\/sdk-connector-inject["']\)/);
  });

  test("public entry never reaches the injection module", () => {
    const publicMain = readFileSync(join(APP_SRC, "public-main.tsx"), "utf8");
    expect(publicMain).not.toContain("sdk-connector-inject");
    expect(publicMain).not.toContain("walletSdkInitialApi");
  });

  test("midnight-client exports the injection factory", () => {
    const index = readFileSync(
      join(APP_SRC, "../../../packages/midnight-client/src/index.ts"),
      "utf8",
    );
    expect(index).toContain("walletSdkInitialApi");
    expect(index).toContain("MidnightWalletSdkConnector");
  });
});
