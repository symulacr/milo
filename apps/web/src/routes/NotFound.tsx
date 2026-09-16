import { PublicPageTitle } from "../components/PublicPageTitle";
import { Panel } from "../components/ui";

export function NotFound() {
  return (
    <>
      <PublicPageTitle title="Page not found" />
      <Panel className="reading-panel">
        <p>This prototype contains only the sample order.</p>
        {/* Shared by both bundles, so no client-side target is valid in both;
            "/" is the always-routable static landing (E-1 resolution). */}
        <a href="/" className="button">
          Back to the Milo overview ↗
        </a>
      </Panel>
    </>
  );
}
