import { Route, Routes } from "react-router";
import { ignoreExtensionNoise, mount } from "./bootstrap";
import { InfoPage } from "./routes/InfoPage";
import { NotFound } from "./routes/NotFound";
import { PublicShell } from "./shells/PublicShell";

ignoreExtensionNoise();

export function PublicApp() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/privacy" element={<InfoPage kind="privacy" />} />
        <Route path="/terms" element={<InfoPage kind="terms" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

mount(PublicApp);
