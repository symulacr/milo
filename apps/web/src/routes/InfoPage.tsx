import { Link } from "react-router";
import { PublicPageTitle } from "../components/PublicPageTitle";
import { Panel } from "../components/ui";
import { type InfoKind, infoContent } from "./info-content";

export function InfoPage({ kind }: { kind: InfoKind }) {
  const content = infoContent[kind];
  return (
    <>
      <PublicPageTitle title={content.title} />
      <Panel className="reading-panel">
        <p className="intro-copy">{content.intro}</p>
        {content.items.map(([heading, paragraph]) => (
          <section className="info-section" key={heading}>
            <h2>{heading}</h2>
            <p>{paragraph}</p>
          </section>
        ))}
        {kind === "sign-in" && (
          <p>
            <a className="text-link" href="/connections">
              Open the live sign-in diagnostic →
            </a>
          </p>
        )}
        <Link className="button" to="/demo">
          Explore a sample order ↗
        </Link>
      </Panel>
    </>
  );
}
