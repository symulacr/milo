import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  RELEASE_FLAG_DEFAULTS,
  releaseFlags,
  releaseFlagsFromEvidence,
} from "../src/release-flags.mjs";

const binding = {
  network: "preprod",
  nonce: "4".repeat(64),
  address: "1".repeat(64),
  quoteId: "quote-1",
  observationId: "observation-1",
  authorizationId: "authorization-1",
  boundAt: 1790624092002,
};

const canonicalBinding = {
  source: "canonicalBindings",
  verdict: "bound",
  binding,
} as const;

const chainReservation = {
  source: "chain-observer",
  kind: "reserved",
  orderId: "order-1",
  address: "1".repeat(64),
  observedAt: 1790624092002,
} as const;

describe("release-flags defaults (RECONSTRUCTED P8-W1-C)", () => {
  test("flags are false without stored receipts", () => {
    expect(releaseFlags()).toEqual({
      immutableOrderAdmission: false,
      r1Complete: false,
    });
    expect(releaseFlags(null)).toEqual({
      immutableOrderAdmission: false,
      r1Complete: false,
    });
    expect(releaseFlags({})).toEqual({
      immutableOrderAdmission: false,
      r1Complete: false,
    });
  });

  test("RELEASE_FLAG_DEFAULTS is frozen and false", () => {
    expect(RELEASE_FLAG_DEFAULTS.immutableOrderAdmission).toBe(false);
    expect(RELEASE_FLAG_DEFAULTS.r1Complete).toBe(false);
    expect(Object.isFrozen(RELEASE_FLAG_DEFAULTS)).toBe(true);
  });
});

describe("release-flags evidence gate (RECONSTRUCTED P8-W1-C)", () => {
  test("canonical binding receipt alone flips only immutableOrderAdmission", () => {
    const flags = releaseFlagsFromEvidence({ canonicalBinding });
    expect(flags.immutableOrderAdmission).toBe(true);
    expect(flags.r1Complete).toBe(false);
  });

  test("chain reservation without canonical binding flips nothing", () => {
    const flags = releaseFlagsFromEvidence({ chainReservation });
    expect(flags.immutableOrderAdmission).toBe(false);
    expect(flags.r1Complete).toBe(false);
  });

  test("both stored receipts flip both flags", () => {
    const flags = releaseFlagsFromEvidence({ canonicalBinding, chainReservation });
    expect(flags.immutableOrderAdmission).toBe(true);
    expect(flags.r1Complete).toBe(true);
  });

  test("boolean claims and incomplete receipts stay false", () => {
    for (const evidence of [
      { canonicalBinding: true },
      { canonicalBinding: { source: "canonicalBindings", verdict: "bound" } },
      {
        canonicalBinding: {
          source: "canonicalBindings",
          verdict: "bound",
          binding: { ...binding, boundAt: "now" },
        },
      },
      {
        canonicalBinding: {
          source: "fixture",
          verdict: "bound",
          binding,
        },
      },
      { chainReservation: { source: "chain-observer", kind: "reserved" } },
      {
        chainReservation: {
          source: "chain-observer",
          kind: "reserved",
          orderId: "",
          address: "1".repeat(64),
          observedAt: 1,
        },
      },
    ] as unknown as Parameters<typeof releaseFlagsFromEvidence>[0][]) {
      expect(releaseFlagsFromEvidence(evidence)).toEqual({
        immutableOrderAdmission: false,
        r1Complete: false,
      });
    }
  });

  test("incomplete chain reservation never completes R1", () => {
    const flags = releaseFlagsFromEvidence({
      canonicalBinding,
      chainReservation: {
        source: "chain-observer",
        kind: "reserved",
        orderId: "",
        address: "1".repeat(64),
        observedAt: 1,
      },
    });
    expect(flags.immutableOrderAdmission).toBe(true);
    expect(flags.r1Complete).toBe(false);
  });

  test("binding identity fields are all required", () => {
    for (const key of Object.keys(binding)) {
      const incomplete = {
        canonicalBinding: {
          source: "canonicalBindings",
          verdict: "bound",
          binding: { ...binding, [key]: key === "boundAt" ? undefined : "" },
        },
      } as unknown as Parameters<typeof releaseFlagsFromEvidence>[0];
      expect(releaseFlagsFromEvidence(incomplete).immutableOrderAdmission).toBe(
        false,
      );
    }
  });
});

describe("release-flags source scan (RECONSTRUCTED P8-W1-C)", () => {
  test("no script hard-codes immutableOrderAdmission: true or r1Complete: true", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const root = join(testDir, "..", "..", "..");
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "dist" ||
          entry.name === ".tools"
        ) {
          continue;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!/\.(mjs|js|ts|tsx)$/.test(entry.name)) continue;
        // This suite itself asserts on the true-strings; skip it.
        if (path === fileURLToPath(import.meta.url)) continue;
        const text = await readFile(path, "utf8");
        if (
          /immutableOrderAdmission\s*:\s*true/.test(text) ||
          /r1Complete\s*:\s*true/.test(text)
        ) {
          offenders.push(path);
        }
      }
    }
    await walk(root);
    expect(offenders).toEqual([]);
  });
});
