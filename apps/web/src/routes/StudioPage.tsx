import { PublicPageTitle } from "../components/PublicPageTitle";
import { Panel } from "../components/ui";

export function StudioPage() {
  return (
    <>
      <PublicPageTitle title="North Studio" />
      <Panel className="reading-panel">
        {/* The sample cover photograph is unavailable: the file was committed with
            deflate-level corruption and no valid copy exists in git history, on this
            host, or in the live deployment. The design's own art tokens carry the
            block until the source art is re-exported. */}
        <div
          className="studio-cover studio-cover-unavailable"
          role="img"
          aria-label="Sample North Studio photography: ceramic vessels on a warm studio shelf"
        >
          <span>Sample photography unavailable</span>
        </div>
        <p>
          A sample creative studio making considered product imagery, not a real
          listing.
        </p>
        <p>“Warm light, quiet shapes — one vessel, one story.”</p>
        <a href="/quotes/sample-001" className="button">
          View the sample agreement ↗
        </a>
      </Panel>
    </>
  );
}
