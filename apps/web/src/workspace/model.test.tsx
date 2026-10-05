import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { App } from "../App";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GLOBAL_KEYS = [
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
  "MouseEvent",
  "Event",
];

let win: Window | undefined;
let root: Root | undefined;
let container: HTMLDivElement;

async function renderApp(route: string) {
  win = new Window({ url: `http://localhost${route}` });
  // @ts-expect-error react-dom reads the ambient window, not a lexical one
  globalThis.window = win;
  for (const key of GLOBAL_KEYS) {
    // @ts-expect-error wiring happy-dom globals
    globalThis[key] = win[key] ?? globalThis[key];
  }
  container = win.document.createElement("div") as unknown as HTMLDivElement;
  win.document.body.appendChild(
    container as unknown as InstanceType<Window["Node"]>,
  );
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    );
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

beforeEach(() => {
  win?.close();
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  win?.close();
});

function focusables() {
  return [
    ...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

describe("workspace skip link is the first tab stop (B1-F038N)", () => {
  for (const route of ["/orders", "/orders/sample-001", "/account"]) {
    test(`${route} leaves the cold-load focus at the document start`, async () => {
      await renderApp(`${route}?scenario=review&role=buyer`);
      const heading = container.querySelector("h1");
      expect(heading).not.toBeNull();
      expect(win?.document.activeElement).not.toBe(heading);
      expect(win?.document.activeElement).toBe(win?.document.body);
    });
  }

  test("the workspace skip link is the first focusable and targets the workspace", async () => {
    await renderApp("/orders?scenario=review&role=buyer");
    const skip = required(
      container.querySelector('a.skip-link[href="#workspace"]'),
      "workspace skip link",
    );
    expect(focusables()[0]).toBe(skip);
  });

  test("a client-side route change still moves focus to the new heading", async () => {
    await renderApp("/orders?scenario=review&role=buyer");
    const link = required(
      container.querySelector('a[href="/quotes/sample-001"]'),
      "agreement nav link",
    );
    await click(link);
    const heading = required(win?.document.querySelector("h1"), "agreement h1");
    expect(heading.textContent).toContain("Review the agreement");
    expect(
      required(win?.document.activeElement, "active element after navigation"),
    ).toBe(heading);
  });
});

describe("a deep link restores its scenario on client-side navigation (I140)", () => {
  test("the lost-capability link applies without a reload", async () => {
    await renderApp("/account?scenario=review&role=buyer");
    expect(container.textContent).toContain("Account");
    const link = required(
      container.querySelector(
        'a[href^="/orders/sample-001?scenario=lost-capability"]',
      ),
      "lost-capability deep link",
    );
    await click(link);
    expect(
      required(win?.document.querySelector("h2"), "capability h2").textContent,
    ).toBe("Capability unavailable");
  });

  test("a scenario the model wrote itself is not re-applied", async () => {
    await renderApp("/orders?scenario=review&role=buyer");
    const select = required(
      container.querySelector<HTMLSelectElement>(
        "details.prototype-toolbar select",
      ),
      "scenario select",
    );
    await act(async () => {
      select.value = "dispute";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      required(win?.document.querySelector("h1"), "orders h1").textContent,
    ).toBe("Your orders");
    expect(win?.document.body.textContent).toContain(
      "Dispute needs a decision",
    );
    expect(win?.document.body.textContent).not.toContain(
      "Delivery ready for review",
    );
  });
});
