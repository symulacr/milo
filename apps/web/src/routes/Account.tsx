import { Link } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { Badge, Panel } from "../components/ui";
import { RecoveryKitPanel } from "../RecoveryKitPanel";
import { roleNames, useWorkspace } from "../workspace/model";

const BOUNDARIES = [
  ["Wallet recovery", "Restores only what the wallet backs up."],
  [
    "Order capability",
    "Lives in order-scoped private state — email reset cannot recreate it.",
  ],
  [
    "Application records",
    "App restore covers records and files, not wallet secrets.",
  ],
];

export function Account() {
  const { state } = useWorkspace();
  return (
    <>
      <PageTitle title="Account" />
      <Panel className="reading-panel">
        <Badge>Sample identity</Badge>
        <h2>{roleNames[state.role]}</h2>
        <Link className="button secondary" to="/connections">
          Open connection diagnostics ↗
        </Link>
        <div className="boundary-cards">
          {BOUNDARIES.map(([title, body]) => (
            <div key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <Link
          className="button secondary"
          to="/orders/sample-001?scenario=lost-capability&role=buyer"
        >
          Explore lost-capability recovery ↗
        </Link>
        <details className="evidence-panel">
          <summary>
            Local recovery kit vault &amp; 7 recovery operations (sample-001)
          </summary>
          <RecoveryKitPanel defaultOrderNonce="sample-001" />
        </details>
      </Panel>
    </>
  );
}
