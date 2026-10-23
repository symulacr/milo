import type { ReactNode } from "react";
import { Link } from "react-router";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { paymentBadge } from "../workspace/framing";
import { actionLabels, useWorkspace } from "../workspace/model";
import { Badge, Icon, Panel } from "./ui";

const STEPS = ["Agreement", "In the studio", "Your review", "Approval"];

const STEP_INDEX: Record<string, number> = {
  DRAFT: 0,
  DEPLOYED: 0,
  RESERVED: 0,
  ACCEPTED: 1,
  SUBMITTED: 2,
  APPROVED: 3,
};

const PAYMENT_COPY: Record<string, string> = {
  authorized: "Payment hold authorized; not captured.",
  captured: "Captured separately from approval.",
  expired: "Payment hold expired; payment unresolved.",
};

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="detail-grid">
      {rows.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Progress() {
  const { state } = useWorkspace();
  const halted = state.phase === "CANCELLED" || state.phase === "DISPUTED";
  const current = STEP_INDEX[state.phase] ?? 0;
  const complete = state.phase === "APPROVED";
  return (
    <ol className="progress-track" aria-label="Sample order progress">
      {STEPS.map((label, i) => {
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
      })}
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
      <Rows
        rows={[
          ["Deliverables", "Three final PNG images"],
          ["Fixed price", `${money} USD · one pack`],
          ["Creative partner", "North Studio"],
          ["Commissioned by", "Still Studio · Alex"],
          ["Usage", "Website and organic social"],
          ["Review deadline", `${REVIEW_DEADLINE} · sample clock`],
          ["Resolution", "Pre-agreed operator · full approval or cancellation"],
          ["Service context", "Commerce imagery (SC-01)"],
          ["Who sees this", "Milo, North Studio and the chosen proving path"],
          [
            "Delivery policy",
            "One fixed submission; no replacement or revision rounds",
          ],
        ]}
      />
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
      <Rows
        rows={[
          ["Source", "In-memory simulator"],
          [
            "File check",
            state.filesVerified
              ? "Matches submitted manifest"
              : "Not checked in this context",
          ],
        ]}
      />
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
      <Badge tone={state.payment === "expired" ? "warning" : "neutral"}>
        {paymentBadge[state.payment]}
      </Badge>
      <p>
        {PAYMENT_COPY[state.payment] ?? "No hold yet — readiness comes first."}
      </p>
      {[
        { label: "Capture payment", action: "capture" as const },
        { label: "Release the hold", action: "void" as const },
      ]
        .filter(({ action }) => can(action))
        .map(({ label, action }) => (
          <button
            key={action}
            className="button secondary full"
            type="button"
            onClick={() => act(action)}
          >
            {label}
          </button>
        ))}
    </Panel>
  );
}

function Btn({
  label,
  onClick,
  disabled,
  className = "button full",
}: {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
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
    disputeReason,
  } = useWorkspace();
  const openDispute = () => {
    setReason("");
    setModal("dispute");
  };
  return (
    <Panel className="action-panel">
      {state.outcomeUnknown ? (
        <>
          <h2>Outcome being checked</h2>
          <p>A submitted request may have succeeded — don’t send another.</p>
          <Btn label="Recheck the outcome" onClick={() => act("reconcile")} />
        </>
      ) : !state.capabilityAvailable ? (
        <>
          <h2>Capability unavailable</h2>
          <p>Signing in again cannot restore an order capability.</p>
          <Btn
            label="Restore capability locally"
            onClick={() => act("restore")}
          />
        </>
      ) : state.phase === "SUBMITTED" && state.role === "buyer" ? (
        <>
          <h2>Review the delivery</h2>
          <div className="check-list">
            <span>
              <Icon>{state.filesVerified ? "✓" : "○"}</Icon>
              {state.filesVerified
                ? "Matches submitted manifest"
                : "File check first"}
            </span>
          </div>
          <Btn
            className={`button ${state.filesVerified ? "secondary" : ""} full`}
            disabled={checking}
            onClick={checkFiles}
            label={
              checking
                ? "Checking file…"
                : state.filesVerified
                  ? "Recheck files"
                  : "Check the three files"
            }
          />
          <Btn
            label={
              <>
                Approve delivery <span aria-hidden="true">↗</span>
              </>
            }
            disabled={!can("approve") || checking}
            onClick={() => {
              setConsent(false);
              setModal("approve");
            }}
          />
          {state.payment === "expired" && (
            <p className="micro">
              Approval stays blocked: the sample hold expired and payment is
              unresolved.
            </p>
          )}
          <Btn
            className="quiet-button full"
            label="Something isn’t right?"
            onClick={openDispute}
          />
        </>
      ) : state.phase === "SUBMITTED" ? (
        <>
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
          <div className="guard-note">
            <strong>Recorded dispute reason:</strong> “{disputeReason}”
          </div>
          {state.role === "operator" ? (
            <>
              <Btn
                label="Resolve: approve delivery"
                disabled={!can("resolve-approve")}
                onClick={() => setModal("resolve-approve")}
              />
              <Btn
                className="button secondary full"
                label="Resolve: cancel order"
                disabled={!can("resolve-cancel")}
                onClick={() => setModal("resolve-cancel")}
              />
            </>
          ) : (
            <p>
              The operator resolves this dispute; perspectives switch above.
            </p>
          )}
        </>
      ) : (
        <>
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
          {(["accept", "decline", "submit", "cancel"] as const)
            .filter(can)
            .map((action) => (
              <Btn
                key={action}
                label={actionLabels[action]}
                onClick={() => setModal(action)}
              />
            ))}
          {(state.phase === "DRAFT" || state.phase === "DEPLOYED") && (
            <Link className="button full" to="/quotes/sample-001">
              Prepare this sample order ↗
            </Link>
          )}
          {state.phase === "ACCEPTED" && can("dispute") && (
            <Btn
              className="quiet-button full"
              label="Open a sample dispute"
              onClick={openDispute}
            />
          )}
        </>
      )}
      <p className="proximate-disclosure">
        Sample action · no wallet signature or live funds
      </p>
      <div className="action-footnote">
        <Icon>◇</Icon> Sample actions only — no wallet prompts.
      </div>
    </Panel>
  );
}
