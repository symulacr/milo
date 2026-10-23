import { AlertDialog, Dialog } from "radix-ui";
import { sampleFiles } from "../assets";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { useWorkspace } from "../workspace/model";

/**
 * Copy for every string-keyed modal. An unknown key renders neutral copy
 * instead of falling through to the first sample image (D9/D12).
 */
const dialogCopy: Record<string, { title: string; description: string }> = {
  approve: {
    title: "Approve this delivery?",
    description: "Approve this exact delivery.",
  },
  dispute: {
    title: "Open a dispute",
    description: "A dispute pauses approval for the pre-agreed operator.",
  },
  submit: {
    title: "Submit this delivery?",
    description: "One fixed submission; no replacement or revision rounds.",
  },
  "resolve-approve": {
    title: "Resolve this dispute?",
    description: "Your decision is final and applies in full.",
  },
  "resolve-cancel": {
    title: "Resolve this dispute?",
    description: "Your decision is final and applies in full.",
  },
  reserve: {
    title: "Reserve these terms?",
    description: "Reservation binds the exact terms on the checked deployment.",
  },
  accept: {
    title: "Accept this order?",
    description:
      "Acceptance commits you to deliver this exact pack by the deadline.",
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

/** Neutral fallback: never the first sample file's title. */
const fallbackTitle = "Sample dialog";

type ConfirmationKey = "decline" | "cancel" | "deploy";

const confirmationCopy: Record<
  ConfirmationKey,
  { body: string; action: string }
> = {
  decline: {
    body: "Declining releases the reservation and returns the order to the quote. Nothing is captured.",
    action: "Decline the scope",
  },
  cancel: {
    body: "Cancelling releases the sample hold and ends this reservation. Nothing is captured.",
    action: "Cancel the reservation",
  },
  deploy: {
    body: "Deployment publishes the bootstrap for this sample order. It is a separate confirmed step, never a side effect of another click.",
    action: "Deploy the bootstrap",
  },
};

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
  const copy = key ? dialogCopy[key] : undefined;
  const title = copy
    ? copy.title
    : image
      ? (sampleFiles[image.index]?.title ?? "Sample artwork")
      : fallbackTitle;
  const description = copy
    ? copy.description
    : image
      ? "Sample artwork at full size."
      : "This sample dialog has no further content.";
  const confirmation: ConfirmationKey | null =
    key === "decline" || key === "cancel" || key === "deploy" ? key : null;
  /** D10: every close path clears the transient dialog inputs. */
  function close() {
    setModal(null);
    setConsent(false);
    setReason("");
    setModalReturn(null);
  }
  return confirmation ? (
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
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (modalOrigin.current?.isConnected) modalOrigin.current.focus();
            else mainHeading.current?.focus();
          }}
        >
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <dl className="confirmation-summary">
            <div>
              <dt>Agreement</dt>
              <dd>{quote.name}</dd>
            </div>
            <div>
              <dt>Agreed amount</dt>
              <dd>{money} USD</dd>
            </div>
            <div>
              <dt>Consequence</dt>
              <dd>{confirmationCopy[confirmation].body}</dd>
            </div>
          </dl>
          <div className="soft-note">
            This confirmation is a sample only — no wallet prompt, payment or
            transaction follows.
          </div>
          <AlertDialog.Action
            className="button full"
            disabled={!can(confirmation)}
            onClick={(event) => {
              // Close only on a real transition; a refused action keeps the
              // dialog open so the notice explains why.
              if (!act(confirmation)) event.preventDefault();
            }}
          >
            {confirmationCopy[confirmation].action}
          </AlertDialog.Action>
          <AlertDialog.Cancel className="button secondary full">
            Back
          </AlertDialog.Cancel>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ) : (
    <Dialog.Root
      open={modal !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (modalOrigin.current?.isConnected) modalOrigin.current.focus();
            else mainHeading.current?.focus();
          }}
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
          {modal === "approve" && (
            <>
              <dl className="confirmation-summary">
                <div>
                  <dt>Agreement</dt>
                  <dd>{quote.name}</dd>
                </div>
                <div>
                  <dt>Creative partner</dt>
                  <dd>North Studio</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>Three final sample images · fixed version</dd>
                </div>
                <div>
                  <dt>Agreed amount</dt>
                  <dd>{money} USD</dd>
                </div>
                <div>
                  <dt>Byte check</dt>
                  <dd>
                    {state.filesVerified
                      ? "All sample files match"
                      : "Not checked"}
                  </dd>
                </div>
                <div>
                  <dt>What becomes shared</dt>
                  <dd>
                    The order phase and your approval record — illustrated only.
                    Brief, files and price stay off the public ledger in this
                    design.
                  </dd>
                </div>
              </dl>
              <div className="soft-note">
                Approval requests payment capture as a separate result; capture
                can still fail and is never guaranteed by approval. This
                decision is final for this delivery.
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I reviewed all three images.
              </label>
              {/* D11: the blocked reason is stated inline, not only by a
                  disabled button. */}
              {!can("approve") && (
                <p role="note" className="guard-note">
                  Approval is blocked for this sample:{" "}
                  {state.filesVerified
                    ? "the buyer capability is not available in this perspective."
                    : "the three sample files have not matched the submitted manifest yet."}
                </p>
              )}
              <button
                type="button"
                className="button full"
                disabled={!consent || !can("approve")}
                onClick={() => act("approve")}
              >
                {/* Rank-1 label (01 §8.2 item 8); 04 §8.2's shorter wireframe
                    label is superseded. */}
                Approve delivery and request payment capture
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={close}
              >
                Back to review
              </button>
              <button
                type="button"
                className="quiet-button full"
                onClick={() => {
                  // D2: remember where we came from so the dispute dialog can
                  // offer "Back to approval" instead of dropping the user out.
                  setModalReturn("approve");
                  setReason("");
                  setModal("dispute");
                }}
              >
                Open a dispute instead
              </button>
            </>
          )}
          {modal === "submit" && (
            <>
              <dl className="confirmation-summary">
                <div>
                  <dt>Agreement</dt>
                  <dd>{quote.name}</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>Three final sample images · fixed version</dd>
                </div>
                <div>
                  <dt>Consequence</dt>
                  <dd>No replacement or revision rounds after submission</dd>
                </div>
              </dl>
              <div className="soft-note">
                The buyer reviews this exact version. A submitted delivery
                cannot be edited, swapped or withdrawn in this design.
              </div>
              {/* D4: the fixed submission is gated by an explicit consent
                  checkbox, not just a click. */}
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I confirm these three files are the final submission for this
                order.
              </label>
              {!can("submit") && (
                <p role="note" className="guard-note">
                  Submission is blocked for this sample: the merchant capability
                  is not available in this perspective.
                </p>
              )}
              <button
                type="button"
                className="button full"
                disabled={!consent || !can("submit")}
                onClick={() => act("submit")}
              >
                Submit the delivery
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={close}
              >
                Back
              </button>
            </>
          )}
          {(modal === "resolve-approve" || modal === "resolve-cancel") && (
            <>
              <dl className="confirmation-summary">
                <div>
                  <dt>Agreement</dt>
                  <dd>{quote.name}</dd>
                </div>
                <div>
                  <dt>Authority</dt>
                  <dd>Pre-agreed operator · committed before purchase</dd>
                </div>
                <div>
                  <dt>Decision</dt>
                  <dd>
                    {modal === "resolve-approve"
                      ? "Full approval of the submitted delivery"
                      : "Full cancellation of the order"}
                  </dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd>
                    {modal === "resolve-approve"
                      ? "Capture may be reconciled separately; not guaranteed"
                      : "Any hold is released or refunded by the provider, reconciled separately"}
                  </dd>
                </div>
              </dl>
              <div className="soft-note">
                Resolution is final in full — no partial approval, no reopened
                terms, no rewritten history.
              </div>
              <button
                type="button"
                className="button full"
                disabled={!can(modal)}
                onClick={() => act(modal)}
              >
                {modal === "resolve-approve"
                  ? "Resolve: approve delivery"
                  : "Resolve: cancel order"}
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={close}
              >
                Back
              </button>
            </>
          )}
          {(modal === "reserve" || modal === "accept") && (
            <>
              <dl className="confirmation-summary">
                <div>
                  <dt>Agreement</dt>
                  <dd>{quote.name}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>Three final images · fixed version</dd>
                </div>
                <div>
                  <dt>Agreed amount</dt>
                  <dd>{money} USD</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd>Hold authorized; not captured</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{REVIEW_DEADLINE} · sample clock</dd>
                </div>
              </dl>
              <div className="soft-note">
                {modal === "reserve"
                  ? "Reservation binds these exact terms on the checked deployment. Several confirmed steps follow one another; no single click completes the order."
                  : "Acceptance commits you to deliver this exact pack by the deadline. A missed delivery opens the dispute path."}
              </div>
              <button
                type="button"
                className="button full"
                disabled={!can(modal)}
                onClick={() => {
                  // D5: navigate only when the transition actually succeeded;
                  // a blocked reserve must leave the user on this page.
                  const applied = act(modal);
                  if (applied && modal === "reserve")
                    navigate("/orders/sample-001");
                }}
              >
                {modal === "reserve" ? "Reserve the terms" : "Accept the order"}
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={close}
              >
                Back
              </button>
            </>
          )}
          {modal === "dispute" && (
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
              <p className="micro muted">
                Not sent or saved. Min 10 characters.
              </p>
              <button
                type="submit"
                className="button full"
                disabled={reason.trim().length < 10 || !can("dispute")}
              >
                Open the sample dispute
              </button>
              {/* D1/D2: a dispute opened from approval can go straight back. */}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
