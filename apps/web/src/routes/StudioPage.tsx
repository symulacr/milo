import { PublicPageTitle } from "../components/PublicPageTitle";
import { Panel } from "../components/ui";

export function StudioPage() {
  return (
    <>
      <PublicPageTitle title="North Studio" />
      <Panel className="reading-panel">
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
