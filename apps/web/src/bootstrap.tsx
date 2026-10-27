import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

const EXTENSION_NOISE =
  /chrome-extension:\/\/|Receiving end does not exist|Talisman extension/;

/**
 * A dynamic import that fails because the hashed chunk no longer exists on the
 * server. That happens when a tab is older than the deployment: the build wrote
 * `chunk-abc123.js`, the tab asks for it, and the new deployment has
 * `chunk-def456.js`. The only fix is a reload, which fetches current HTML and
 * therefore current chunk names.
 */
const STALE_CHUNK =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/**
 * One guarded reload per tab. Without the guard a genuinely broken chunk would
 * reload forever; with it, a second failure is left to the error boundary.
 */
function reloadOnce(): void {
  try {
    if (sessionStorage.getItem("milo:reloaded")) return;
    sessionStorage.setItem("milo:reloaded", "1");
  } catch {
    // Storage can throw in a locked-down context; reloading once is still right.
  }
  location.reload();
}

/**
 * Two kinds of noise the app should absorb rather than show: browser-extension
 * rejections, which are not ours, and a stale-chunk import failure, which is
 * fixed by one reload.
 */
export function installRecovery() {
  const onFailure = (text: string): boolean => {
    if (EXTENSION_NOISE.test(text)) return true;
    if (STALE_CHUNK.test(text)) {
      reloadOnce();
      return true;
    }
    return false;
  };
  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason as Error | string | undefined;
    const text = `${typeof reason === "string" ? reason : (reason?.message ?? "")} ${typeof reason === "object" ? (reason?.stack ?? "") : ""}`;
    if (onFailure(text)) e.preventDefault();
  });
  addEventListener("error", (e: ErrorEvent) => {
    // A failed <script> or import surfaces here with the chunk URL as message.
    if (onFailure(`${e.message} ${e.filename}`)) e.preventDefault();
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
