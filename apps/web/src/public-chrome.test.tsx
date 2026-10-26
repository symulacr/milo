import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { ORDER_WINDOWS_MS } from "../../../packages/backend/src/order-windows";
import { sampleFiles } from "./assets";
import { InfoPage } from "./routes/InfoPage";
import { PublicShell } from "./shells/PublicShell";

type GlobalSlot = Record<string, unknown>;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const shell = renderToStaticMarkup(
  <MemoryRouter>
    <PublicShell />
  </MemoryRouter>,
);

/** Both surfaces that must agree: the rendered shell and the landing HTML. */
const SURFACES = [shell, landing];

function navHrefs(source: string, label: string): string[] {
  const nav = source.match(
    new RegExp(`<nav aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`),
  )?.[1];
  if (!nav) throw new Error(`Missing ${label} nav`);
  return [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

describe("public chrome parity", () => {
  for (const label of ["Main navigation", "Footer"])
    test(`${label} matches between landing and PublicShell`, () => {
      expect(navHrefs(shell, label)).toEqual(navHrefs(landing, label));
    });

  test("Privacy and Terms appear once, in the footer only", () => {
    for (const source of SURFACES)
      expect(source.match(/href="\/(privacy|terms)"/g)).toHaveLength(2);
  });

  test("both expose the same wordmark home link", () => {
    for (const source of SURFACES)
      expect(source).toMatch(
        /<a href="\/" class="wordmark"[^>]*>[\s\S]*?milo[\s\S]*?wordmark-star/,
      );
  });

  test("every order window on the landing matches ORDER_WINDOWS_MS", () => {
    const hours = (ms: number) => ms / 3_600_000;
    expect(landing).toContain(`${hours(ORDER_WINDOWS_MS.delivery)} h`);
    expect(landing).toContain(`${hours(ORDER_WINDOWS_MS.review)} h`);
    expect(landing).toContain(
      `within ${hours(ORDER_WINDOWS_MS.acceptance)} hour`,
    );
    expect(landing).toContain(
      `has ${hours(ORDER_WINDOWS_MS.resolution)} hours`,
    );
    expect(landing).not.toMatch(/\b12 hours\b|\b12 h\b/);
  });

  test("the skip link comes before the page content", () => {
    for (const source of SURFACES) {
      expect(source).toContain('class="skip-link" href="#main"');
      expect(source.indexOf("skip-link")).toBeLessThan(source.indexOf("<main"));
    }
  });
});

describe("sample image integrity", () => {
  for (const file of sampleFiles) {
    test(`${file.title} has the pinned SHA-256 and WebP 600×720 header`, async () => {
      const bytes = await Bun.file(`apps/web/public${file.src}`).arrayBuffer();
      const view = new DataView(bytes);
      const head = [...new Uint8Array(bytes).slice(0, 16)];
      expect(head.slice(0, 4)).toEqual([82, 73, 70, 70]);
      expect(head.slice(8, 12)).toEqual([87, 69, 66, 80]);
      expect(view.getUint16(26, true) & 0x3fff).toBe(600);
      expect(view.getUint16(28, true) & 0x3fff).toBe(720);
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
        file.hash,
      );
    });
  }

  test("three distinct digests commit to one manifest", () => {
    const manifest = new Bun.CryptoHasher("sha256")
      .update(sampleFiles.map((file) => file.hash).join(""))
      .digest("hex");
    expect(manifest).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(sampleFiles.map((file) => file.hash)).size).toBe(3);
  });
});

describe("public skip link keeps focus on a cold load", () => {
  test("an info route does not move focus past the skip link", async () => {
    const window = new Window({ url: "http://localhost/privacy" });
    (globalThis as GlobalSlot).window = window;
    // Everything the component tree touches comes from the window; copy every
    // own key rather than naming a subset that drifts.
    for (const key of Object.getOwnPropertyNames(window)) {
      if (key in globalThis) continue;
      const value = (window as unknown as GlobalSlot)[key];
      if (value !== undefined) (globalThis as GlobalSlot)[key] = value;
    }
    const document = window.document;
    const container = document.createElement("div");
    document.body.appendChild(container as never);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/privacy"]}>
          <Routes>
            <Route element={<PublicShell />}>
              <Route path="/privacy" element={<InfoPage kind="privacy" />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });
    expect(document.activeElement?.tagName ?? "BODY").toBe("BODY");
    await act(async () => root.unmount());
    window.close();
  });
});
