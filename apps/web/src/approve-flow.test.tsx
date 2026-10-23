import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { App } from "./App";

/** The DOM-backed slice of globalThis the tests swap for a happy-dom window. */
type GlobalSlot = Record<string, unknown>;

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
  (globalThis as GlobalSlot).window = window;
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
    (globalThis as GlobalSlot)[key] =
      (window as unknown as GlobalSlot)[key] ?? (globalThis as GlobalSlot)[key];
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

  test("three-slot SHA-256 strip transitions to match and order record disclosure mounts", async () => {
    await renderApp("/orders/sample-001?scenario=review&role=buyer");
    await flush(3000);
    const slots = [...container.querySelectorAll(".verify-slot")];
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.getAttribute("data-state")).toBe("match");
      expect(slot.textContent).toContain("✓ SHA-256 verified");
    }
    expect(container.textContent).toContain(
      "Chain-backed order record & payment monitoring (sample-001)",
    );
  }, 10000);

  test("switching perspectives preserves per-role setup checks across buyer and merchant views", async () => {
    await renderApp("/quotes/sample-001?scenario=fresh&role=buyer");
    await flush();
    const prepareBtn = byText<HTMLButtonElement>(
      "button",
      "Prepare this device",
    );
    expect(prepareBtn).not.toBeNull();
    await act(async () => {
      prepareBtn?.click();
    });
    const verifyBtn = byText<HTMLButtonElement>(
      "button",
      "Verify the recovery kit",
    );
    expect(verifyBtn).not.toBeNull();
    await act(async () => {
      verifyBtn?.click();
    });
    const doneItemsBefore = container.querySelectorAll(
      '.setup-list li[data-state="done"]',
    );
    expect(doneItemsBefore.length).toBeGreaterThanOrEqual(2);

    // Switch to merchant perspective via the Explore button or select, then back to buyer
    const selects = [...container.querySelectorAll("select")];
    const roleSelect = selects.find((el) =>
      [...el.querySelectorAll("option")].some((o) => o.value === "merchant"),
    );
    expect(roleSelect).toBeDefined();
    await act(async () => {
      if (roleSelect) {
        roleSelect.value = "merchant";
        roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const returnBuyerBtn = byText<HTMLButtonElement>(
      "button",
      "Explore buyer setup",
    );
    expect(returnBuyerBtn).not.toBeNull();
    await act(async () => {
      returnBuyerBtn?.click();
    });
    const doneItemsAfter = container.querySelectorAll(
      '.setup-list li[data-state="done"]',
    );
    expect(doneItemsAfter.length).toBeGreaterThanOrEqual(2);
  }, 10000);

  test("receipt renders all three pinned SHA-256 digests and print action", async () => {
    await renderApp("/orders/sample-001/receipt");
    await flush();
    expect(container.textContent).toContain(
      "Manifest SHA-256 digests (3 files)",
    );
    expect(container.textContent).toContain(
      "a70f248e5504aeec43e59ac68ebd9516614dd5c839a338635bceabf2cdfa8fda",
    );
    expect(container.textContent).toContain(
      "3a07f69f751b1ec4bee4ffe0fd95dbaed043d7553bf5375f6dba9f3d797cf8bf",
    );
    expect(container.textContent).toContain(
      "e994848a179a98868efdf731e761b0560790aaea029626d455e2a5a7fd9ba9a7",
    );
    expect(byText<HTMLButtonElement>("button", "Print receipt")).not.toBeNull();
  }, 10000);
});
