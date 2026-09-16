import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { App } from "./App";
import { PublicApp } from "./public-main";

function renderRoute(path: string, publicSurface = false) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      {publicSurface ? <PublicApp /> : <App />}
    </MemoryRouter>,
  );
}

describe("route heading accessibility", () => {
  for (const [path, publicSurface] of [
    ["/demo", true],
    ["/privacy", true],
    ["/terms", true],
    ["/pilot", true],
    ["/how-it-works", true],
    ["/sign-in", true],
    ["/m/north-studio", true],
    ["/orders", false],
    ["/orders/sample-001", false],
    ["/orders/sample-001/receipt", false],
    ["/quotes/sample-001", false],
    ["/merchant/orders", false],
    ["/merchant/quotes/new", false],
    ["/operator/cases", false],
    ["/operator/cases/sample-001", false],
    ["/account", false],
    ["/connections", false],
    ["/connections/", false],
    ["/orders/unknown", false],
    ["/unknown", false],
  ] as const) {
    test(`${path} has one programmatically focusable main heading`, () => {
      const markup = renderRoute(path, publicSurface);
      const main = markup.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
      expect(main).toBeDefined();
      const headings = [...(main ?? "").matchAll(/<h1\b([^>]*)>/g)];
      expect(headings).toHaveLength(1);
      expect(headings[0]?.[1]).toContain('tabindex="-1"');
    });
  }

  for (const [path, role] of [
    ["/merchant/orders", "merchant"],
    ["/merchant/quotes/new", "merchant"],
    ["/operator/cases", "operator"],
    ["/operator/cases/sample-001", "operator"],
  ]) {
    test(`${path} labels the gate and exposes a native keyboard button`, () => {
      const markup = renderRoute(path ?? "");
      expect(markup).toContain(
        `<h1 tabindex="-1">This is the ${role} view.</h1>`,
      );
      expect(markup).toContain(
        `<button type="button" class="button">Explore the ${role} perspective</button>`,
      );
    });
  }
});

describe("shared NotFound CTA (A3-01)", () => {
  for (const publicSurface of [false, true]) {
    test(`${publicSurface ? "public" : "workspace"} bundle 404 CTA is a cross-entry anchor to the landing`, () => {
      const markup = renderRoute("/unknown", publicSurface);
      const cta = markup.match(/<a [^>]*>Back to the Milo overview/);
      expect(cta?.[0]).toContain('href="/"');
    });
  }
});
