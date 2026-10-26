import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

const EXTENSION_NOISE =
  /chrome-extension:\/\/|Receiving end does not exist|Talisman extension/;

export function ignoreExtensionNoise() {
  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason as Error | string | undefined;
    const text = `${typeof reason === "string" ? reason : (reason?.message ?? "")} ${typeof reason === "object" ? (reason?.stack ?? "") : ""}`;
    if (EXTENSION_NOISE.test(text)) e.preventDefault();
  });
}

export function mount(App: ComponentType) {
  if (typeof document === "undefined") return;
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}
