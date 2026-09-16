import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { demoContexts } from "./demo-fixtures";
import { REVIEW_DEADLINE } from "./reviewDeadline";
import { PublicShell } from "./shells/PublicShell";

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function navHrefs(source: string, label: string): string[] {
  const nav = source.match(
    new RegExp(`<nav aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`),
  )?.[1];
  if (!nav) throw new Error(`Missing ${label} nav`);
  return [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

describe("public chrome parity", () => {
  const shell = renderToStaticMarkup(
    <MemoryRouter>
      <PublicShell />
    </MemoryRouter>,
  );

  test("main navigation matches between landing and PublicShell", () => {
    expect(navHrefs(shell, "Main navigation")).toEqual(
      navHrefs(landing, "Main navigation"),
    );
  });

  test("footer navigation matches between landing and PublicShell", () => {
    expect(navHrefs(shell, "Footer")).toEqual(navHrefs(landing, "Footer"));
  });

  test("both expose the same wordmark home link", () => {
    for (const source of [shell, landing]) {
      const wordmark = source.match(
        /<a href="\/" class="wordmark"[^>]*>([\s\S]*?)<\/a>/,
      );
      expect(wordmark?.[1]).toContain("milo");
      expect(wordmark?.[1]).toContain("wordmark-star");
    }
  });

  test("skip link and prototype notice match between landing and PublicShell", () => {
    for (const source of [shell, landing]) {
      expect(source).toContain('class="skip-link" href="#main"');
      expect(source).toContain(
        "Prototype — all orders and artwork are samples. No live payments or",
      );
    }
  });

  // The static landing frame cannot import the single sources (no hydration,
  // 01 §9.1), so this parity assertion is the control (C-A-17 convention).
  test("static workspace frame facts match the registered carriers", () => {
    const sc01 = demoContexts.find((context) => context.id === "SC-01");
    if (!sc01) throw new Error("SC-01 fixture missing");
    expect(landing).toContain(`review due ${REVIEW_DEADLINE}`);
    expect(landing).toContain(`fixed ${sc01.amount}`);
    expect(landing).toContain(sc01.pack);
    // Mirrors PaymentPanel's neutral ○ glyph + "authorized" copy (A3-03).
    expect(landing).toContain("○ Sample authorized");
  });
});
