import { Link } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { Badge, Panel } from "../components/ui";
import { roleNames, useWorkspace } from "../workspace/model";

export function Account() {
  const { state } = useWorkspace();
  return (
    <>
      <PageTitle title="Account" />
      <Panel className="reading-panel">
        <Badge>Sample identity</Badge>
        <h2>{roleNames[state.role]}</h2>
        <p>
          Not authenticated. Sign-in and wallet checks live in connection
          diagnostics; neither grants authority over orders.
        </p>
        <Link className="button secondary" to="/connections">
          Open connection diagnostics ↗
        </Link>
        <div className="boundary-cards">
          <div>
            <h3>Wallet recovery</h3>
            <p>Restores only what the wallet backs up.</p>
          </div>
          <div>
            <h3>Order capability</h3>
            <p>
              Lives in order-scoped private state — email reset cannot recreate
              it.
            </p>
          </div>
          <div>
            <h3>Application records</h3>
            <p>App restore covers records and files, not wallet secrets.</p>
          </div>
        </div>
        {/* Deep link restores the scenario without a hidden global reset. */}
        <Link
          className="button secondary"
          to="/orders/sample-001?scenario=lost-capability&role=buyer"
        >
          Explore lost-capability recovery ↗
        </Link>
      </Panel>
    </>
  );
}
