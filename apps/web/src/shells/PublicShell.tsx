import { Link, Outlet } from "react-router";
import { ArrowUpRightIcon } from "../components/icons";
import { WordmarkStar } from "../components/Wordmark";

export function PublicShell() {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <section className="public-notice" aria-label="Prototype notice">
        Prototype — orders and artwork are samples. Preprod test network only.
        No live payments.
      </section>
      <header className="public-header">
        <a href="/" className="wordmark" aria-label="Milo home">
          milo
          <WordmarkStar />
        </a>
        <nav aria-label="Main navigation">
          <Link to="/how-it-works">How it works</Link>
          <Link to="/privacy" data-testid="public-header-privacy">
            Privacy
          </Link>
          <Link to="/sign-in">Sign in</Link>
          <Link
            className="button small"
            to="/demo"
            data-testid="public-header-demo-cta"
          >
            Explore a sample order <ArrowUpRightIcon />
          </Link>
        </nav>
      </header>
      <main id="main" className="public-main page-width">
        <Outlet />
      </main>
      <footer className="public-footer page-width">
        <a href="/" className="wordmark">
          milo
          <WordmarkStar />
        </a>
        <p>Private agreements. Clear approvals.</p>
        <nav aria-label="Footer">
          <Link to="/privacy" data-testid="public-footer-privacy">
            Privacy
          </Link>
          <Link to="/terms">Terms</Link>
          <Link to="/pilot">Pilot status</Link>
        </nav>
        <span className="micro muted">Sample product photography · 2026</span>
      </footer>
    </div>
  );
}
