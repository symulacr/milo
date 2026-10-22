/**
 * There were two `admitCanonical` implementations: `convex/canonicalAdmission.ts`
 * (the one `admission.bind` reaches) and `packages/backend/src/convex-admission.ts`
 * (a copy only package tests reached). The copy hardcoded the 60-second payment
 * window instead of importing `PAYMENT_AUTHORIZATION_WINDOW_MS`, and it never
 * created the order projection, so a green package test proved nothing about the
 * deployed path.
 *
 * The package module is now a re-export. These tests fail if a second
 * implementation reappears or if the two names drift apart.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import * as deployedAdmission from "../../../convex/canonicalAdmission";
import * as packageAdmission from "../src/convex-admission";

const ROOT = new URL("../../..", import.meta.url).pathname;
describe("one admission implementation", () => {
  test("the package module exports the deployed function itself, not a copy", () => {
    expect(packageAdmission.admitCanonical).toBe(
      deployedAdmission.admitCanonical,
    );
  });

  test("the package module carries no admission logic of its own", async () => {
    const source = await readFile(
      join(ROOT, "packages/backend/src/convex-admission.ts"),
      "utf8",
    );
    // A re-export has no database reads, no policy call and no decision branch.
    for (const forbidden of [
      "ctx.db",
      "decideCanonicalAdmission",
      "insertBinding",
      "requireMembership",
      "monitorReceiptUsable",
      "60_000",
    ])
      expect(source).not.toContain(forbidden);
  });

  test("the deployed module is the only definition in the repository", async () => {
    const { readdir, stat } = await import("node:fs/promises");
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir)) {
        if (entry === "node_modules" || entry === "_generated") continue;
        const full = join(dir, entry);
        if ((await stat(full)).isDirectory()) {
          await walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mjs)$/.test(entry) || /\.test\.(ts|mjs)$/.test(entry))
          continue;
        const text = await readFile(full, "utf8");
        if (/export\s+(async\s+)?function\s+admitCanonical\b/.test(text))
          offenders.push(relative(ROOT, full));
      }
    };
    await walk(join(ROOT, "convex"));
    await walk(join(ROOT, "packages/backend/src"));
    expect(offenders).toEqual(["convex/canonicalAdmission.ts"]);
  });

  test("the deployed module imports the shared payment window constant", async () => {
    const source = await readFile(
      join(ROOT, "convex/canonicalAdmission.ts"),
      "utf8",
    );
    expect(source).toContain("PAYMENT_AUTHORIZATION_WINDOW_MS");
    expect(source).not.toContain("60_000");
  });
});
