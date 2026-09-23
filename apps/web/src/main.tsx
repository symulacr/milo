import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";

// Wallet extensions (e.g. Talisman mid-onboarding) reject out of band; not app errors.
addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  const reason = e.reason as Error | string | undefined;
  const text = `${typeof reason === "string" ? reason : (reason?.message ?? "")} ${typeof reason === "object" ? (reason?.stack ?? "") : ""}`;
  if (
    /chrome-extension:\/\/|Receiving end does not exist|Talisman extension/.test(
      text,
    )
  )
    e.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
