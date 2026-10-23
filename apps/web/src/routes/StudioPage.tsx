import { Link } from "react-router";
import { PublicPageTitle } from "../components/PublicPageTitle";
import { Panel } from "../components/ui";

export function StudioPage() {
  return (
    <>
      <PublicPageTitle title="North Studio" />
      <Panel className="reading-panel">
        <img
          className="studio-cover"
          src="/images/studio-cover.webp"
          alt="Sample North Studio photography: ceramic vessels on a warm studio shelf"
          width="1536"
          height="1024"
        />
        <p>
          A sample creative studio making considered product imagery, not a real
          listing.
        </p>
        <div className="hero-actions">
          <a href="/quotes/sample-001" className="button">
            View the sample agreement ↗
          </a>
          <Link to="/demo" className="button secondary">
            Take the 4-step guided tour
          </Link>
        </div>
      </Panel>
    </>
  );
}
