import { Route, Routes } from "react-router";
import { installRecovery, mount } from "./bootstrap";
import { InfoPage } from "./routes/InfoPage";
import { NotFound } from "./routes/NotFound";
import { PublicShell } from "./shells/PublicShell";

installRecovery();

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
