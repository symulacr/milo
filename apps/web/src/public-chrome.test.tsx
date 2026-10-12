import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { demoContexts } from "./demo-fixtures";
import { REVIEW_DEADLINE } from "./reviewDeadline";
import { DemoPage } from "./routes/DemoPage";
import { PublicShell } from "./shells/PublicShell";

declare global {
  // React's act reads IS_REACT_ACT_ENVIRONMENT to allow act() outside test runners.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
        "Prototype — orders and artwork are samples. Preprod test network only. No live payments.",
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

/**
 * WCAG 2.2 SC 2.4.1 (Bypass Blocks): the skip link must be the first
 * focusable element, so the first Tab after a cold load reaches it and not a
 * control inside <main>. The regression this guards: DemoPage focused its
 * page heading on first mount, which moved the browser's sequential-focus
 * starting point past the skip link (e2e/flows/fl-keyboard.mjs).
 */
describe("public skip link is the first focusable element", () => {
  async function mountDemoAt(path: string) {
    const window = new Window({ url: `http://localhost${path}` });
    // @ts-expect-error happy-dom window as global
    globalThis.window = window;
    for (const key of [
      "document",
      "HTMLElement",
      "HTMLAnchorElement",
      "Element",
      "Node",
      "navigator",
      "location",
      "history",
      "MutationObserver",
      "getComputedStyle",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "AbortController",
      "Blob",
      "URL",
      "CustomEvent",
      "KeyboardEvent",
      "PointerEvent",
      "MouseEvent",
      "Event",
    ]) {
      // @ts-expect-error wiring happy-dom globals
      globalThis[key] = window[key] ?? globalThis[key];
    }
    const container = window.document.createElement("div");
    window.document.body.appendChild(container as never);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<PublicShell />}>
              <Route path="/demo" element={<DemoPage />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });
    return { window, root };
  }

  test("the skip link precedes the demo heading in the rendered shell", async () => {
    const { window, root } = await mountDemoAt("/demo");
    const html = window.document.body.innerHTML;
    const skipIndex = html.indexOf("skip-link");
    const headingIndex = html.indexOf("Explore a sample order");
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(skipIndex).toBeLessThan(headingIndex);
    await act(async () => root.unmount());
    window.close();
  });

  test("a cold load does not move focus into the demo content", async () => {
    const { window, root } = await mountDemoAt("/demo");
    // On a cold load nothing is focused, so the first Tab starts at the top of
    // the document and reaches the skip link. Focusing the heading here would
    // put activeElement inside <main> and defeat the skip link.
    const active = window.document.activeElement;
    expect(active?.className ?? "").not.toContain("demo-title");
    expect(active?.tagName ?? "BODY").toBe("BODY");
    await act(async () => root.unmount());
    window.close();
  });
});
