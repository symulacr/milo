import { Link } from "react-router";
import { Panel } from "../components/ui";
import { useWorkspace } from "../workspace/model";

export function WorkspaceNotFound() {
  const { mainHeading } = useWorkspace();
  return (
    <Panel className="reading-panel">
      <h1 tabIndex={-1} ref={mainHeading}>
        Page not found
      </h1>
      <p>This sample workspace has no page at this address.</p>
      <Link className="button" to="/orders">
        Back to your orders
      </Link>
    </Panel>
  );
}
