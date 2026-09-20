import { Link } from "react-router";
import type { Action } from "../../../../packages/domain/src/prototype";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { actionLabels, useWorkspace } from "../workspace/model";
import { Badge, Icon, Panel } from "./ui";

export function Progress() {
  const { state } = useWorkspace();
  // Explicit phase→step map (04 §7.1): the track never runs ahead of the phase.
  const stepIndex: Record<string, number> = {
    DRAFT: 0,
    DEPLOYED: 0,
    RESERVED: 0,
    ACCEPTED: 1,
    SUBMITTED: 2,
    APPROVED: 3,
  };
  const halted = state.phase === "CANCELLED" || state.phase === "DISPUTED";
  const current = stepIndex[state.phase] ?? 0;
  const complete = state.phase === "APPROVED";
  return (
    <ol className="progress-track" aria-label="Sample order progress">
      {["Agreement", "In the studio", "Your review", "Approval"].map(
        (label, i) => {
          const reached = !halted && (i < current || complete);
          return (
            <li
              key={label}
              className={reached ? "reached" : ""}
              aria-current={
                !halted && !complete && i === current ? "step" : undefined
              }
            >
              {reached && <Icon>✓</Icon>}
              {label}
            </li>
          );
        },
      )}
      {/* Halted flows leave the happy-path track visibly instead of
          blanking it (04 §12.1 quiet stage indicator). */}
      {halted && (
        <li className="halted">
          <Icon>{state.phase === "DISPUTED" ? "!" : "×"}</Icon>
          {state.phase === "DISPUTED"
            ? "Disputed — awaiting resolution"
            : "Cancelled"}
        </li>
      )}
    </ol>
  );
}

export function Scope() {
  const { quote, money } = useWorkspace();
  return (
    <div className="scope-content">
      <h2>{quote.name}</h2>
      <p>{quote.brief}</p>
      <dl className="detail-grid">
        <div>
          <dt>Deliverables</dt>
          <dd>Three final PNG images</dd>
        </div>
        <div>
          <dt>Fixed price</dt>
          <dd>{money} USD · one pack</dd>
        </div>
        <div>
          <dt>Creative partner</dt>
          <dd>North Studio</dd>
        </div>
        <div>
          <dt>Commissioned by</dt>
          <dd>Still Studio · Alex</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>Website and organic social</dd>
        </div>
        <div>
          <dt>Review deadline</dt>
          <dd>{REVIEW_DEADLINE} · sample clock</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>Pre-agreed operator · full approval or cancellation</dd>
        </div>
        <div>
          <dt>Service context</dt>
          <dd>Commerce imagery (SC-01)</dd>
        </div>
        <div>
          <dt>Who sees this</dt>
          <dd>Milo, North Studio and the chosen proving path</dd>
        </div>
        <div>
          <dt>Delivery policy</dt>
          <dd>One fixed submission; no replacement or revision rounds</dd>
        </div>
      </dl>
      <div className="soft-note">
        Sample terms — a real order would freeze them on Midnight.
      </div>
    </div>
  );
}

export function Timeline() {
  const { state } = useWorkspace();
  return (
    <ul className="timeline">
      {[...state.events].reverse().map((event) => (
        <li className="timeline-item" key={event.id}>
          <span className="timeline-dot" aria-hidden="true" />
          <div>
            <strong>{event.label}</strong>
            <p>{event.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EvidencePanel() {
  const { state, exportReceipt } = useWorkspace();
  return (
    <details className="evidence-panel">
      <summary>What was verified and who can see it</summary>
      <dl className="detail-grid">
        <div>
          <dt>Source</dt>
          <dd>In-memory simulator</dd>
        </div>
        <div>
          <dt>File check</dt>
          <dd>
            {state.filesVerified
              ? "Matches submitted manifest"
              : "Not checked in this context"}
          </dd>
        </div>
      </dl>
      <p>
        Real files stay visible to authorized participants only. Sample artwork
        here is public static media.
      </p>
      <p className="soft-note">
        Sample evidence only. A byte match proves identity, not ownership,
        quality or a chain commitment.
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={exportReceipt}
      >
        Download receipt ↓
      </button>
    </details>
  );
}

export function PaymentPanel() {
  const { state, money, can, act } = useWorkspace();
  return (
    <Panel className="payment-panel">
      <div className="panel-heading">
        <h3>Payment</h3>
        <Icon>↗</Icon>
      </div>
      <div className="payment-total">
        {money}
        <span>USD</span>
      </div>
      {/* No single green "Success": capture is an independent observation,
          and an expired hold is warning, not neutral (04 §7.3, 05 §5.3). */}
      <Badge tone={state.payment === "expired" ? "warning" : "neutral"}>
        {state.payment === "none" ? "No payment attempt" : state.payment}
      </Badge>
      <p>
        {state.payment === "authorized"
          ? "Payment hold authorized; not captured."
          : state.payment === "captured"
            ? "Captured separately from approval."
            : state.payment === "expired"
              ? "Payment hold expired; payment unresolved."
              : "No hold yet — readiness comes first."}
      </p>
      {can("capture") && (
        <button
          className="button secondary full"
          type="button"
          onClick={() => act("capture")}
        >
          Capture payment
        </button>
      )}
      {can("void") && (
        <button
          className="button secondary full"
          type="button"
          onClick={() => act("void")}
        >
          Release the hold
        </button>
      )}
    </Panel>
  );
}

export function ActionPanel() {
  const {
    state,
    can,
    act,
    checking,
    checkFiles,
    setConsent,
    setModal,
    setReason,
  } = useWorkspace();
  return (
    <Panel className="action-panel">
      {state.outcomeUnknown ? (
        <>
          <h2>Outcome being checked</h2>
          <p>A submitted request may have succeeded — don’t send another.</p>
          <button
            type="button"
            className="button full"
            onClick={() => act("reconcile")}
          >
            Recheck the outcome
          </button>
        </>
      ) : !state.capabilityAvailable ? (
        <>
          <h2>Capability unavailable</h2>
          <p>
            Reading still works. Signing in again cannot restore an order
            capability.
          </p>
          <button
            type="button"
            className="button full"
            onClick={() => act("restore")}
          >
            Restore capability locally
          </button>
          <p className="micro">No backup is created or recovered here.</p>
        </>
      ) : state.phase === "SUBMITTED" && state.role === "buyer" ? (
        <>
          <h2>Review the delivery</h2>
          <p>Check the three images against the agreed scope.</p>
          <div className="check-list">
            <span>
              <Icon>{state.filesVerified ? "✓" : "○"}</Icon>
              {state.filesVerified
                ? "Matches submitted manifest"
                : "File check first"}
            </span>
          </div>
          <button
            type="button"
            className={`button ${state.filesVerified ? "secondary" : ""} full`}
            disabled={checking}
            onClick={checkFiles}
          >
            {checking
              ? "Checking file…"
              : state.filesVerified
                ? "Recheck files"
                : "Check the three files"}
          </button>
          <button
            type="button"
            className="button full"
            disabled={!can("approve") || checking}
            onClick={() => {
              setConsent(false);
              setModal("approve");
            }}
          >
            Approve delivery <span aria-hidden="true">↗</span>
          </button>
          {state.payment === "expired" && (
            <p className="micro">
              Approval stays blocked: the sample hold expired and payment is
              unresolved. You can still review the delivery or open a dispute;
              no new hold can be created for this order.
            </p>
          )}
          <button
            type="button"
            className="quiet-button full"
            onClick={() => {
              setReason("");
              setModal("dispute");
            }}
          >
            Something isn’t right?
          </button>
        </>
      ) : state.phase === "SUBMITTED" ? (
        <>
          {/* Non-buyer perspective (04 §7.2): the buyer acts next. */}
          <h2>Waiting for the buyer's review</h2>
          <p>
            {state.role === "merchant"
              ? "Your delivery is submitted. The buyer reviews this exact version."
              : "The buyer reviews the submitted delivery."}
          </p>
        </>
      ) : state.phase === "APPROVED" ? (
        <>
          <h2>Delivery approved</h2>
          <p>Payment remains a separate result, checked below.</p>
          <Link className="button full" to="/orders/sample-001/receipt">
            View receipt ↗
          </Link>
        </>
      ) : state.phase === "CANCELLED" ? (
        <>
          <h2>Order closed</h2>
          <p>
            Cancellation is final. Any payment hold still reconciles separately.
          </p>
          <Link
            className="button secondary full"
            to="/orders/sample-001/receipt"
          >
            View the record
          </Link>
        </>
      ) : state.phase === "DISPUTED" ? (
        <>
          <h2>Resolve the dispute</h2>
          <p>The pre-agreed operator decides: approve or cancel, in full.</p>
          {state.role === "operator" ? (
            <>
              {/* Resolution is terminal and full; it gets the same deliberate
                  confirmation as buyer approval (05 §4.2, 04 §9.2). */}
              <button
                type="button"
                className="button full"
                disabled={!can("resolve-approve")}
                onClick={() => setModal("resolve-approve")}
              >
                Resolve: approve delivery
              </button>
              <button
                type="button"
                className="button secondary full"
                disabled={!can("resolve-cancel")}
                onClick={() => setModal("resolve-cancel")}
              >
                Resolve: cancel order
              </button>
            </>
          ) : (
            <p>
              The operator resolves this dispute; perspectives switch above.
            </p>
          )}
        </>
      ) : (
        <>
          {/* The page h1 already names the state; this region leads with the
              action group (04 §7.1), never a repeated phase heading. */}
          {(state.phase === "RESERVED" || state.phase === "DRAFT") && (
            <h2>Your next step</h2>
          )}
          {state.phase === "RESERVED" && state.role === "merchant" && (
            <p>
              The scope is reserved and a sample hold is authorized; not
              captured. Accept to start, or decline before the cutoff.
            </p>
          )}
          {state.phase === "DRAFT" && (
            <p>Review the quote, then setup, hold and reservation.</p>
          )}
          {(["accept", "decline", "submit", "cancel"] as Action[])
            .filter(can)
            .map((action) => (
              <button
                type="button"
                key={action}
                className="button full"
                onClick={() =>
                  action === "submit"
                    ? setModal("submit")
                    : action === "accept"
                      ? setModal("accept")
                      : act(action)
                }
              >
                {actionLabels[action]}
              </button>
            ))}
          {(state.phase === "DRAFT" || state.phase === "DEPLOYED") && (
            <Link className="button full" to="/quotes/sample-001">
              Prepare this sample order ↗
            </Link>
          )}
          {state.phase === "ACCEPTED" && can("dispute") && (
            <button
              type="button"
              className="quiet-button full"
              onClick={() => {
                setReason("");
                setModal("dispute");
              }}
            >
              Open a sample dispute
            </button>
          )}
        </>
      )}
      <div className="action-footnote">
        <Icon>◇</Icon> Sample actions only — no wallet prompts. Wrong state?
        Switch scenario or perspective above.
      </div>
    </Panel>
  );
}
