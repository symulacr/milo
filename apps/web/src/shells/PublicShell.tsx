import { Link, Outlet } from "react-router";
import { Wordmark, WordmarkStar } from "../components/Wordmark";

const PUBLIC_NOTICE = "Midnight Preprod. Cards run in Stripe test mode.";

export function PublicShell() {
  return (
    <div className="flex min-h-svh flex-col bg-white">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-3 bg-white px-4 py-4 sm:px-8">
        <Wordmark />
        <nav
          aria-label="Main navigation"
          className="ml-auto flex flex-wrap items-center gap-5 text-sm font-semibold"
        >
          <a className="hidden hover:text-brand sm:inline" href="/#how">
            How it works
          </a>
          <a className="cta -mr-4 h-9 px-4 text-sm" href="/orders">
            Sign in
          </a>
        </nav>
      </header>
      <main id="main" className="flex-1 px-4 pt-10 pb-20 sm:px-8 lg:pt-14">
        <Outlet />
      </main>
      <footer className="grid gap-10 overflow-hidden bg-pink px-4 pt-16 pb-10 text-black sm:px-8">
        <nav aria-label="Footer" className="flex gap-5 text-sm font-semibold">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
        <a
          href="/"
          className="wordmark text-[clamp(5rem,22vw,20rem)] leading-[0.8]"
        >
          milo
          <WordmarkStar />
        </a>
        <p className="text-sm">{PUBLIC_NOTICE}</p>
      </footer>
    </div>
  );
}
