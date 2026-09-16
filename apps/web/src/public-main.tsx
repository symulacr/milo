import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { DemoPage } from "./routes/DemoPage";
import { InfoPage } from "./routes/InfoPage";
import { NotFound } from "./routes/NotFound";
import { StudioPage } from "./routes/StudioPage";
import { PublicShell } from "./shells/PublicShell";

/**
 * Lean public entry (01 §7.4): /demo and the info pages must not ship the
 * auth, wallet, backend or workspace-simulator stack. The import boundary is
 * enforced by demo-boundary.test.tsx's reachable-source scan.
 */
/** Public route tree, extracted so heading tests render the real thing. */
export function PublicApp() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/privacy" element={<InfoPage kind="privacy" />} />
        <Route path="/terms" element={<InfoPage kind="terms" />} />
        <Route path="/pilot" element={<InfoPage kind="pilot" />} />
        <Route
          path="/how-it-works"
          element={<InfoPage kind="how-it-works" />}
        />
        <Route path="/sign-in" element={<InfoPage kind="sign-in" />} />
        <Route path="/m/north-studio" element={<StudioPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

// Importing PublicApp in tests must not mount; guard the side effect.
const root =
  typeof document === "undefined" ? null : document.getElementById("root");
if (root) {
  createRoot(root).render(
    <BrowserRouter>
      <PublicApp />
    </BrowserRouter>,
  );
}
