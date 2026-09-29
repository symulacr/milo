/**
 * Static hygiene checks for Phase 4 §5 SVG sample deliverables (S2).
 * File-level only — no route-level claim (app cannot build in this phase).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SAMPLES = new URL("../public/samples/", import.meta.url).pathname;
const MANIFEST = join(SAMPLES, "manifest.tsv");

const FORBIDDEN = [
  /<script\b/i,
  /<foreignObject\b/i,
  /@font-face/i,
  /font-family\s*:\s*url\(/i,
  /xlink:href\s*=\s*["']https?:/i,
  /href\s*=\s*["']https?:/i,
  /\bpay(?:ment)?\s*(?:complete|success|paid|confirmed)/i,
  /payments?\s+(?:complete|success|succeeded|confirmed|processed|paid)\b/i,
  /chain\s+(?:success|confirmed|finalized|complete)\b/i,
  /live\s+payments?\s+(?:available|enabled|ready|open)\b/i,
  /onchain\s+(?:success|complete)/i,
];

const REQUIRED_SNIPPETS = [
  /viewBox="0 0 \d+ \d+"/,
  /<title\b[^>]*>Sample\b/i,
  /<desc\b/i,
  /prefers-color-scheme:\s*dark/i,
  /prefers-reduced-motion:\s*reduce/i,
  /currentColor|color="#20201f"/i,
  /Prototype sample/i,
  /No live payments/i,
];

function sampleFiles(ext: string): string[] {
  return readdirSync(SAMPLES)
    .filter((n) => n.endsWith(ext))
    .sort();
}

function read(name: string): string {
  return readFileSync(join(SAMPLES, name), "utf8");
}

describe("sample SVG hygiene", () => {
  const svgs = sampleFiles(".svg");

  test("ships the required 3-image set, hero, and gallery extras", () => {
    expect(svgs).toEqual([
      "gallery-colorway.svg",
      "gallery-form-study.svg",
      "hero-order-stack.svg",
      "still-collection.svg",
      "still-detail.svg",
      "still-hero.svg",
    ]);
  });

  for (const name of sampleFiles(".svg")) {
    test(`${name} carries viewBox, title, desc and theme/motion gates`, () => {
      const src = read(name);
      for (const pattern of REQUIRED_SNIPPETS) {
        expect(src).toMatch(pattern);
      }
    });

    test(`${name} forbids scripts, foreignObject, external fonts and live-pay copy`, () => {
      const src = read(name);
      for (const pattern of FORBIDDEN) {
        expect(src).not.toMatch(pattern);
      }
    });

    test(`${name} stays inside the hero/route byte budgets`, () => {
      const bytes = statSync(join(SAMPLES, name)).size;
      if (name.startsWith("hero-")) {
        expect(bytes).toBeLessThanOrEqual(200_000);
      } else {
        expect(bytes).toBeLessThanOrEqual(200_000);
      }
      // per-route sample pack ceiling
      expect(bytes).toBeLessThanOrEqual(1_000_000);
    });
  }

  test("total sample SVG set stays under 1MB", () => {
    const total = svgs.reduce(
      (sum, n) => sum + statSync(join(SAMPLES, n)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(1_000_000);
  });
});

describe("sample rasters and manifest", () => {
  test("each SVG has PNG and WebP derivatives under 5 MiB", () => {
    for (const name of sampleFiles(".svg")) {
      const stem = name.replace(/\.svg$/, "");
      for (const ext of [".png", ".webp"]) {
        const path = join(SAMPLES, stem + ext);
        const bytes = statSync(path).size;
        expect(bytes).toBeGreaterThan(200);
        expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
      }
    }
  });

  test("hero PNG stays under the 200KB first-view budget", () => {
    const bytes = statSync(join(SAMPLES, "hero-order-stack.png")).size;
    expect(bytes).toBeLessThanOrEqual(200_000);
  });

  test("manifest.tsv pins sha256 for every SVG", () => {
    const lines = readFileSync(MANIFEST, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    const rows = lines.slice(1); // skip header
    const names = rows.map((l) => l.split("\t")[0]);
    expect(names).toEqual(sampleFiles(".svg"));
    for (const line of rows) {
      const [name, bytes, sha] = line.split("\t");
      expect(Number(bytes)).toBe(statSync(join(SAMPLES, name)).size);
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("standalone QA fixture", () => {
  test("qa-fixtures.html labels samples and exposes light/dark/375px", () => {
    const html = readFileSync(join(SAMPLES, "qa-fixtures.html"), "utf8");
    expect(html).toMatch(/sample/i);
    expect(html).toMatch(/prefers-color-scheme|data-theme|theme/i);
    expect(html).toMatch(/375/);
    expect(html).toMatch(/still-hero\.svg/);
    expect(html).toMatch(/still-detail\.svg/);
    expect(html).toMatch(/still-collection\.svg/);
    expect(html).toMatch(/hero-order-stack\.svg/);
    expect(html).not.toMatch(/<script\b/i);
  });
});
