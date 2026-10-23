import { Link } from "react-router";
import { PaymentPanel, Scope } from "../components/order";
import { PageTitle } from "../components/PageTitle";
import { Icon, Panel } from "../components/ui";
import { RecoveryKitPanel } from "../RecoveryKitPanel";
import { actionLabels, useWorkspace } from "../workspace/model";

export function QuoteView() {
  const { state, chooseRole, can, act, setModal } = useWorkspace();
  return (
    <>
      <PageTitle title="Review the agreement" />
      <div className="workspace-grid">
        <Panel>
          <Scope />
          {/* The recovery kit belongs next to the order it protects: preparing
              the order needs the local context and the canonical address
              checkpoint, so both are inspectable here instead of only on the
              diagnostics and account surfaces. */}
          <details className="evidence-panel">
            <summary>
              Order recovery kit &amp; capability checkpoint (sample-001)
            </summary>
            <RecoveryKitPanel defaultOrderNonce="sample-001" />
          </details>
        </Panel>
        <aside
          className="action-column"
          aria-label="Order preparation and payment"
        >
          <Panel className="action-panel">
            <h2>Prepare this order</h2>
            {/* Three documented checks (04 §5.2/§6.2, 05 §4.2): only the
                current blocker is actionable; completed checks stay visible. */}
            <ol className="setup-list">
              {(
                [
                  {
                    label: "Prepare this device",
                    done: state.ready,
                    action: "ready",
                  },
                  {
                    label: "Verify the recovery kit",
                    done: state.recoveryVerified,
                    action: "verify-recovery",
                  },
                  {
                    label: "Separate payment authorization",
                    done: state.payment === "authorized",
                    action: "authorize",
                  },
                ] as const
              ).map((check, index, checks) => {
                const current =
                  !check.done && checks.slice(0, index).every((c) => c.done);
                return (
                  <li
                    key={check.label}
                    data-state={
                      check.done ? "done" : current ? "current" : "pending"
                    }
                  >
                    <Icon>{check.done ? "✓" : current ? "→" : "○"}</Icon>
                    {check.done ? (
                      <span>{check.label}</span>
                    ) : current &&
                      state.role === "buyer" &&
                      can(check.action) ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => act(check.action)}
                      >
                        {actionLabels[check.action]}
                      </button>
                    ) : (
                      <span>{check.label}</span>
                    )}
                  </li>
                );
              })}
              <li data-state={state.phase === "RESERVED" ? "done" : "pending"}>
                <Icon>{state.phase === "RESERVED" ? "✓" : "○"}</Icon>
                <span>Checked deployment, then reservation</span>
              </li>
            </ol>
            {state.role !== "buyer" ? (
              <button
                className="button full"
                type="button"
                onClick={() => chooseRole("buyer")}
              >
                Explore buyer setup
              </button>
            ) : (
              <>
                {/* Both setup actions are irreversible-shaped, so both open the
                    confirmation modal. Deploy used to act immediately, which
                    made the two buttons promise different levels of consent.
                    `as const` keeps the element type as the literal union, which
                    is what `setModal` accepts (`Action` is wider than
                    `WorkspaceModal`). */}
                <p className="proximate-disclosure">
                  Sample setup · no live hold or on-chain deploy
                </p>
                {(["deploy", "reserve"] as const).filter(can).map((action) => (
                  <button
                    className="button full"
                    type="button"
                    key={action}
                    onClick={() => setModal(action)}
                  >
                    {actionLabels[action]}
                  </button>
                ))}
              </>
            )}
            {!["DRAFT", "DEPLOYED"].includes(state.phase) && (
              <Link to="/orders/sample-001" className="button full">
                Return to this sample order
              </Link>
            )}
            <div className="soft-note">
              Readiness comes before any real hold.
            </div>
          </Panel>
          <PaymentPanel />
        </aside>
      </div>
    </>
  );
}
