import { AlertDialog, Dialog } from "radix-ui";
import type { ReactNode } from "react";
import type { Action } from "../../../../packages/domain/src/prototype";
import { sampleFiles } from "../assets";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { useWorkspace } from "../workspace/model";

type Row = { term: string; value: ReactNode };
type Ctx = { quoteName: string; money: string; filesVerified: boolean };

type Spec = {
  title: string;
  description: string;
  rows?: (ctx: Ctx) => Row[];
  note?: string;
  consent?: string;
  guard?: string;
  action?: Action;
  actionLabel?: string;
  navigate?: string;
};

const SCOPE_ROWS = (ctx: Ctx): Row[] => [
  { term: "Agreement", value: ctx.quoteName },
  { term: "Scope", value: "Three final images · fixed version" },
  { term: "Agreed amount", value: `${ctx.money} USD` },
  { term: "Payment", value: "Hold authorized; not captured" },
  { term: "Deadline", value: `${REVIEW_DEADLINE} · sample clock` },
];

const resolveRows =
  (decision: string, payment: string) =>
  (ctx: Ctx): Row[] => [
    { term: "Agreement", value: ctx.quoteName },
    {
      term: "Authority",
      value: "Pre-agreed operator · committed before purchase",
    },
    { term: "Decision", value: decision },
    { term: "Payment", value: payment },
  ];

const RESOLVE_NOTE =
  "Resolution is final in full — no partial approval, no reopened terms, no rewritten history.";
const RESOLVE_DESC = "Your decision is final and applies in full.";

const SPECS: Record<string, Spec> = {
  approve: {
    title: "Approve this delivery?",
    description: "Approve this exact delivery.",
    rows: (ctx) => [
      { term: "Agreement", value: ctx.quoteName },
      { term: "Creative partner", value: "North Studio" },
      { term: "Delivery", value: "Three final sample images · fixed version" },
      { term: "Agreed amount", value: `${ctx.money} USD` },
      {
        term: "Byte check",
        value: ctx.filesVerified ? "All sample files match" : "Not checked",
      },
      {
        term: "What becomes shared",
        value:
          "The order phase and your approval record — illustrated only. Brief, files and price stay off the public ledger in this design.",
      },
    ],
    note: "Approval requests payment capture as a separate result; capture can still fail and is never guaranteed by approval. This decision is final for this delivery.",
    consent: "I reviewed all three images.",
    guard: "Approval is blocked for this sample.",
    action: "approve",
    actionLabel: "Approve delivery and request payment capture",
  },
  submit: {
    title: "Submit this delivery?",
    description: "One fixed submission; no replacement or revision rounds.",
    rows: (ctx) => [
      { term: "Agreement", value: ctx.quoteName },
      { term: "Delivery", value: "Three final sample images · fixed version" },
      {
        term: "Consequence",
        value: "No replacement or revision rounds after submission",
      },
    ],
    note: "The buyer reviews this exact version. A submitted delivery cannot be edited, swapped or withdrawn in this design.",
    consent:
      "I confirm these three files are the final submission for this order.",
    guard: "Submission is blocked for this sample.",
    action: "submit",
    actionLabel: "Submit the delivery",
  },
  "resolve-approve": {
    title: "Resolve this dispute?",
    description: RESOLVE_DESC,
    rows: resolveRows(
      "Full approval of the submitted delivery",
      "Capture may be reconciled separately; not guaranteed",
    ),
    note: RESOLVE_NOTE,
    action: "resolve-approve",
    actionLabel: "Resolve: approve delivery",
  },
  "resolve-cancel": {
    title: "Resolve this dispute?",
    description: RESOLVE_DESC,
    rows: resolveRows(
      "Full cancellation of the order",
      "Any hold is released or refunded by the provider, reconciled separately",
    ),
    note: RESOLVE_NOTE,
    action: "resolve-cancel",
    actionLabel: "Resolve: cancel order",
  },
  reserve: {
    title: "Reserve these terms?",
    description: "Reservation binds the exact terms on the checked deployment.",
    rows: SCOPE_ROWS,
    note: "Reservation binds these exact terms on the checked deployment. Several confirmed steps follow one another; no single click completes the order.",
    action: "reserve",
    actionLabel: "Reserve the terms",
    navigate: "/orders/sample-001",
  },
  accept: {
    title: "Accept this order?",
    description:
      "Acceptance commits you to deliver this exact pack by the deadline.",
    rows: SCOPE_ROWS,
    note: "Acceptance commits you to deliver this exact pack by the deadline. A missed delivery opens the dispute path.",
    action: "accept",
    actionLabel: "Accept the order",
  },
  dispute: {
    title: "Open a dispute",
    description: "A dispute pauses approval for the pre-agreed operator.",
  },
  decline: {
    title: "Decline this scope?",
    description: "Declining releases the reservation; nothing is captured.",
  },
  cancel: {
    title: "Cancel this reservation?",
    description: "Cancelling releases the sample hold; nothing is captured.",
  },
  deploy: {
    title: "Deploy the bootstrap?",
    description: "Deployment is a separate confirmed step before any hold.",
  },
};

type Confirm = { body: string; label: string; action: Action };

const CONFIRM: Record<string, Confirm> = {
  decline: {
    body: "Declining releases the reservation and returns the order to the quote. Nothing is captured.",
    label: "Decline the scope",
    action: "decline",
  },
  cancel: {
    body: "Cancelling releases the sample hold and ends this reservation. Nothing is captured.",
    label: "Cancel the reservation",
    action: "cancel",
  },
  deploy: {
    body: "Deployment publishes the bootstrap for this sample order. It is a separate confirmed step, never a side effect of another click.",
    label: "Deploy the bootstrap",
    action: "deploy",
  },
};

function Summary({ rows }: { rows: Row[] }) {
  return (
    <dl className="confirmation-summary">
      {rows.map(({ term, value }) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OrderDialog() {
  const {
    modal,
    setModal,
    setConsent,
    modalOrigin,
    mainHeading,
    state,
    quote,
    money,
    consent,
    can,
    act,
    navigate,
    reason,
    setReason,
    modalReturn,
    setModalReturn,
  } = useWorkspace();
  const image = modal !== null && typeof modal === "object" ? modal : null;
  const key = typeof modal === "string" ? modal : null;
  const spec = key ? SPECS[key] : undefined;
  const confirm = key ? CONFIRM[key] : undefined;
  const title = spec
    ? spec.title
    : image
      ? (sampleFiles[image.index]?.title ?? "Sample artwork")
      : "Sample dialog";
  const description = spec
    ? spec.description
    : image
      ? "Sample artwork at full size."
      : "This sample dialog has no further content.";
  const ctx: Ctx = {
    quoteName: quote.name,
    money,
    filesVerified: state.filesVerified,
  };

  function close() {
    setModal(null);
    setConsent(false);
    setReason("");
    setModalReturn(null);
  }

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (modalOrigin.current?.isConnected) modalOrigin.current.focus();
    else mainHeading.current?.focus();
  };

  const back = (label = "Back") => (
    <button type="button" className="button secondary full" onClick={close}>
      {label}
    </button>
  );

  if (confirm) {
    return (
      <AlertDialog.Root
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content
            className="dialog-content"
            onCloseAutoFocus={restoreFocus}
          >
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
            <Summary
              rows={[
                { term: "Agreement", value: quote.name },
                { term: "Agreed amount", value: `${money} USD` },
                { term: "Consequence", value: confirm.body },
              ]}
            />
            <AlertDialog.Action
              className="button full"
              disabled={!can(confirm.action)}
              onClick={(event) => {
                if (!act(confirm.action)) event.preventDefault();
              }}
            >
              {confirm.label}
            </AlertDialog.Action>
            <AlertDialog.Cancel className="button secondary full">
              Back
            </AlertDialog.Cancel>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    );
  }

  return (
    <Dialog.Root
      open={modal !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          onCloseAutoFocus={restoreFocus}
          className={`dialog-content ${image ? "image-dialog" : ""}`}
        >
          <Dialog.Close className="dialog-close" aria-label="Close dialog">
            ×
          </Dialog.Close>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {image && (
            <>
              <img
                className="lightbox-image"
                src={sampleFiles[image.index]?.src}
                alt={`Sample product photography — ${sampleFiles[image.index]?.title}`}
                width="600"
                height="720"
              />
              <div className="lightbox-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={image.index === 0}
                  onClick={() =>
                    setModal({ kind: "image", index: image.index - 1 })
                  }
                >
                  ← Previous
                </button>
                <a
                  className="text-link"
                  href={sampleFiles[image.index]?.src}
                  download={sampleFiles[image.index]?.name}
                >
                  Download PNG ↓
                </a>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={image.index === sampleFiles.length - 1}
                  onClick={() =>
                    setModal({ kind: "image", index: image.index + 1 })
                  }
                >
                  Next →
                </button>
              </div>
            </>
          )}
          {spec?.rows && <Summary rows={spec.rows(ctx)} />}
          {spec?.note && <div className="soft-note">{spec.note}</div>}
          {spec?.consent && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              {spec.consent}
            </label>
          )}
          {spec?.guard && spec.action && !can(spec.action) && (
            <p role="note" className="guard-note">
              {spec.guard}{" "}
              {state.filesVerified
                ? "The buyer capability is not available in this perspective."
                : "The three sample files have not matched the submitted manifest yet."}
            </p>
          )}
          {spec?.action && spec.actionLabel && (
            <button
              type="button"
              className="button full"
              disabled={!can(spec.action) || (!!spec.consent && !consent)}
              onClick={() => {
                if (!spec.action) return;
                if (act(spec.action) && spec.navigate) navigate(spec.navigate);
              }}
            >
              {spec.actionLabel}
            </button>
          )}
          {key === "approve" && (
            <>
              {back("Back to review")}
              <button
                type="button"
                className="quiet-button full"
                onClick={() => {
                  setModalReturn("approve");
                  setReason("");
                  setModal("dispute");
                }}
              >
                Open a dispute instead
              </button>
            </>
          )}
          {key === "dispute" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (reason.trim().length >= 10) act("dispute");
              }}
            >
              <label className="field">
                Sample reason
                <textarea
                  required
                  minLength={10}
                  maxLength={500}
                  value={reason}
                  rows={4}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Describe a fictional scope mismatch. Do not enter private information."
                />
              </label>
              <button
                type="submit"
                className="button full"
                disabled={reason.trim().length < 10 || !can("dispute")}
              >
                Open the sample dispute
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={() => {
                  if (modalReturn === "approve") {
                    setModalReturn(null);
                    setModal("approve");
                  } else {
                    close();
                  }
                }}
              >
                {modalReturn === "approve" ? "Back to approval" : "Back"}
              </button>
            </form>
          )}
          {spec?.action && back()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
