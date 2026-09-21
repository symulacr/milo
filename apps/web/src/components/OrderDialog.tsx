import { Dialog } from "radix-ui";
import { sampleFiles } from "../assets";
import { REVIEW_DEADLINE } from "../reviewDeadline";
import { useWorkspace } from "../workspace/model";

export function OrderDialog() {
  const {
    modal,
    setModal,
    setConsent,
    modalOrigin,
    mainHeading,
    state,
    money,
    consent,
    can,
    act,
    navigate,
    reason,
    setReason,
  } = useWorkspace();
  const image = modal !== null && typeof modal === "object" ? modal : null;
  return (
    <Dialog.Root
      open={modal !== null}
      onOpenChange={(open) => {
        if (!open) {
          setModal(null);
          setConsent(false);
        }
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
          <Dialog.Title>
            {modal === "approve"
              ? "Approve this delivery?"
              : modal === "dispute"
                ? "Open a dispute"
                : modal === "submit"
                  ? "Submit this delivery?"
                  : modal === "resolve-approve" || modal === "resolve-cancel"
                    ? "Resolve this dispute?"
                    : modal === "reserve"
                      ? "Reserve these terms?"
                      : modal === "accept"
                        ? "Accept this order?"
                        : sampleFiles[image?.index ?? 0]?.title}
          </Dialog.Title>
          <Dialog.Description>
            {modal === "approve"
              ? "Approve this exact delivery."
              : modal === "dispute"
                ? "A dispute pauses approval for the pre-agreed operator."
                : modal === "submit"
                  ? "One fixed submission; no replacement or revision rounds."
                  : modal === "resolve-approve" || modal === "resolve-cancel"
                    ? "Your decision is final and applies in full."
                    : modal === "reserve"
                      ? "Reservation binds the exact terms on the checked deployment."
                      : modal === "accept"
                        ? "Acceptance commits you to deliver this exact pack by the deadline."
                        : "Sample artwork at full size."}
          </Dialog.Description>
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
                onClick={() => {
                  setModal(null);
                  setConsent(false);
                }}
              >
                Back to review
              </button>
              <button
                type="button"
                className="quiet-button full"
                onClick={() => {
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
              <button
                type="button"
                className="button full"
                disabled={!can("submit")}
                onClick={() => act("submit")}
              >
                Submit the delivery
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={() => setModal(null)}
              >
                Back
              </button>
            </>
          )}
          {(modal === "resolve-approve" || modal === "resolve-cancel") && (
            <>
              <dl className="confirmation-summary">
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
                onClick={() => setModal(null)}
              >
                Back
              </button>
            </>
          )}
          {(modal === "reserve" || modal === "accept") && (
            <>
              <dl className="confirmation-summary">
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
                  act(modal);
                  if (modal === "reserve") navigate("/orders/sample-001");
                }}
              >
                {modal === "reserve" ? "Reserve the terms" : "Accept the order"}
              </button>
              <button
                type="button"
                className="button secondary full"
                onClick={() => setModal(null)}
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
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
