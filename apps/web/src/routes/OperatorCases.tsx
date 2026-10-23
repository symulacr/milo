import { RoleRequired } from "../components/gates";
import { PageTitle } from "../components/PageTitle";
import { Panel } from "../components/ui";
import { useWorkspace } from "../workspace/model";

export function OperatorCases() {
  const { state, reset, navigate, disputeReason, quote } = useWorkspace();
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
        <div className="guard-note">
          <strong>Sample 001 — {quote.name}</strong>
          <p>“{disputeReason}”</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => {
            if (state.phase !== "DISPUTED") reset("dispute");
            navigate("/operator/cases/sample-001");
          }}
        >
          Explore the sample dispute ↗
        </button>
      </Panel>
    </RoleRequired>
  );
}
