import { Link, Outlet } from "react-router";
import { PublicFooter, PublicHeader } from "./public-chrome";

export function PublicShell() {
  return (
    <div className="flex min-h-svh flex-col bg-white">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <PublicHeader className="bg-white" />
      <main id="main" className="flex-1 px-4 pt-10 pb-20 sm:px-8 lg:pt-14">
        <Outlet />
      </main>
      <PublicFooter
        privacy={<Link to="/privacy">Privacy</Link>}
        terms={<Link to="/terms">Terms</Link>}
      />
    </div>
  );
}
