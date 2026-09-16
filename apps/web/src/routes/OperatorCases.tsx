import { RoleRequired } from "../components/gates";
import { PageTitle } from "../components/PageTitle";
import { Panel } from "../components/ui";
import { useWorkspace } from "../workspace/model";

export function OperatorCases() {
  const { state, reset, navigate } = useWorkspace();
  return (
    <RoleRequired requiredRole="operator">
      <PageTitle title="Resolution desk" />
      <Panel className="reading-panel">
        <h2>
          {state.phase === "DISPUTED"
            ? "One sample case needs a decision."
            : "No disputed sample is selected."}
        </h2>
        <p>The operator decides resolution — never the buyer’s approval.</p>
        <p className="micro muted">
          The protocol keeps dispute and finance authorities separate (01
          §3.4.3); this sample collapses them into one operator role for
          exploration.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            reset("dispute");
            navigate("/operator/cases/sample-001");
          }}
        >
          Explore the sample dispute ↗
        </button>
      </Panel>
    </RoleRequired>
  );
}
