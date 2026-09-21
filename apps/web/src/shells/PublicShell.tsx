import { Outlet } from "react-router";
import { WordmarkStar } from "../components/Wordmark";

/**
 * Public marketing chrome, mirroring the static landing header/footer in
 * apps/web/index.html. Keep the two in sync when navigation changes.
 */
export function PublicShell() {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <section className="public-notice" aria-label="Prototype notice">
        Prototype — all orders and artwork are samples. No live payments or
        blockchain activity.
      </section>
      <header className="public-header">
        <a href="/" className="wordmark" aria-label="Milo home">
          milo
          <WordmarkStar />
        </a>
        <nav aria-label="Main navigation">
          <a href="/how-it-works">How it works</a>
          <a href="/privacy">Privacy</a>
          <a href="/sign-in">Sign in</a>
          <a className="button small" href="/demo">
            Explore a sample order <span aria-hidden="true">↗</span>
          </a>
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
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/pilot">Pilot status</a>
        </nav>
        <span className="micro muted">Sample product photography · 2026</span>
      </footer>
    </div>
  );
}
