import { PublicPageTitle } from "../components/PublicPageTitle";
import { Panel } from "../components/ui";

export function NotFound() {
  return (
    <>
      <PublicPageTitle title="Page not found" />
      <Panel className="reading-panel">
        <p>This prototype contains only the sample order.</p>
        <a href="/" className="button">
          Back to the Milo overview ↗
        </a>
      </Panel>
    </>
  );
}
