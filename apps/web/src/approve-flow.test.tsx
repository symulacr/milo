import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { App } from "./App";

declare global {
  // React's act reads IS_REACT_ACT_ENVIRONMENT to allow act() outside test runners.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let window: Window;
let root: Root;
let container: HTMLDivElement;

async function renderApp(route: string) {
  window = new Window({ url: `http://localhost${route}` });
  // @ts-expect-error happy-dom window as global
  globalThis.window = window;
  // Serve the real sample images from disk so the byte check verifies the
  // pinned SHA-256 digests end to end, without a dev server.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "");
    const file = Bun.file(`apps/web/public${path}`);
    if (!(await file.exists()))
      return new Response("not found", { status: 404 });
    return new Response(await file.arrayBuffer());
  }) as typeof fetch;
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
  container = window.document.createElement("div") as unknown as HTMLDivElement;
  window.document.body.appendChild(
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

async function flush(milliseconds = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
}

function byText<T extends HTMLElement = HTMLElement>(
  selector: string,
  text: string,
): T | null {
  return (
    ([...container.querySelectorAll(selector)].find((el) =>
      el.textContent?.includes(text),
    ) as T | undefined) ?? null
  );
}

beforeEach(() => {
  window?.close();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  window?.close();
});

describe("approve flow", () => {
  test("byte check runs automatically and enables approval for the buyer", async () => {
    await renderApp("/orders/sample-001?scenario=review&role=buyer");
    const approve = byText<HTMLButtonElement>("button", "Approve delivery");
    expect(approve).not.toBeNull();
    expect(approve?.disabled).toBe(true);
    // The auto check fetches and hashes the three files; allow it to settle.
    await flush(3000);
    const enabled = byText<HTMLButtonElement>("button", "Approve delivery");
    expect(enabled?.disabled).toBe(false);
    const notice = container.querySelector(".notice");
    expect(notice?.textContent).toContain("match the submitted manifest");
  }, 10000);

  // Dialog interaction (consent gating) is covered by the domain
  // state-machine tests and browser sweeps: Radix Portal does not mount
  // under happy-dom, so a jsdom-style dialog test cannot work here.
  test("deep link restores a merchant dispute state without clicks", async () => {
    await renderApp("/orders/sample-001?scenario=dispute&role=merchant");
    await flush();
    expect(container.querySelector("h1")?.textContent).toContain(
      "clear resolution",
    );
    // Perspective switching lives in the sample controls, not in-content.
    expect(container.textContent).toContain("perspectives switch above");
  }, 10000);

  test("unknown order id settles on an honest 404 title (C-A-06)", async () => {
    await renderApp("/orders/unknown");
    await flush();
    expect(container.querySelector("h1")?.textContent).toContain(
      "Page not found",
    );
    expect(window.document.title).toBe("Milo — Page not found");
  }, 10000);
});
