import { Tabs } from "radix-ui";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { sampleFiles } from "../assets";
import {
  ActionPanel,
  EvidencePanel,
  PaymentPanel,
  Progress,
  Scope,
  Timeline,
} from "../components/order";
import { Badge, Icon, Panel } from "../components/ui";
import { phaseFrame } from "../workspace/framing";
import { useWorkspace } from "../workspace/model";

export function OrderView() {
  const {
    state,
    quote,
    mainHeading,
    tab,
    setTab,
    setModal,
    checking,
    checkFiles,
    fileCheckError,
  } = useWorkspace();
  const frame = phaseFrame(state.phase, state.role);
  // The browser already holds the delivered bytes, so run the pinned-byte
  // check for the reviewer instead of making it a separate click. One
  // automatic attempt per order revision; the manual button stays as fallback.
  const autoCheck = useRef("");
  useEffect(() => {
    const key = `${state.revision}:${state.phase}:${state.role}`;
    if (
      state.phase === "SUBMITTED" &&
      state.role === "buyer" &&
      !state.filesVerified &&
      !state.outcomeUnknown &&
      state.capabilityAvailable &&
      !checking &&
      autoCheck.current !== key
    ) {
      autoCheck.current = key;
      checkFiles();
    }
  }, [state, checking, checkFiles]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumbs">
            <Link
              to={
                state.role === "merchant"
                  ? "/merchant/orders"
                  : state.role === "operator"
                    ? "/operator/cases"
                    : "/orders"
              }
            >
              {state.role === "merchant"
                ? "Studio queue"
                : state.role === "operator"
                  ? "Resolution desk"
                  : "Your orders"}
            </Link>
            <span>/</span>
            <span>Sample 001</span>
          </div>
          <h1 tabIndex={-1} ref={mainHeading}>
            {frame.heading}
          </h1>
          <p>
            {quote.name} <span className="dot-divider">·</span> North Studio
          </p>
          <p className="order-status">
            Next: {frame.next}
            {frame.due && ` · due ${frame.due} · sample clock`}
            {` · ${frame.consequence}`}
          </p>
        </div>
      </div>
      <Progress />
      <div className="workspace-grid order-layout">
        <aside className="primary-action" aria-label="Order actions">
          <ActionPanel />
        </aside>
        <div className="work-column">
          <Panel className="delivery-panel">
            <Tabs.Root value={tab} onValueChange={setTab}>
              <Tabs.List className="tabs" aria-label="Order information">
                <Tabs.Trigger value="delivery">Delivery</Tabs.Trigger>
                <Tabs.Trigger value="scope">Agreed scope</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="delivery">
                <div className="delivery-heading">
                  <div>
                    <h2>The delivery</h2>
                  </div>
                  <Badge tone="neutral">Sample artwork</Badge>
                </div>
                <div className="image-grid">
                  {sampleFiles.map((file, i) => (
                    <button
                      type="button"
                      className="image-card"
                      key={file.id}
                      onClick={() => setModal({ kind: "image", index: i })}
                      aria-label={`Inspect ${file.title}`}
                    >
                      <div className="image-wrap">
                        <img
                          src={file.src}
                          alt={`Sample product photography — ${file.title.toLowerCase()}`}
                          width="600"
                          height="720"
                        />
                        <span className="image-expand" aria-hidden="true">
                          ↗
                        </span>
                      </div>
                      <div className="image-description">
                        <strong>{file.title}</strong>
                        <span>{file.note}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="delivery-bottom">
                  <p>
                    <Icon>◇</Icon>{" "}
                    {fileCheckError ||
                      (state.filesVerified
                        ? "Matches submitted manifest — all three files."
                        : "File check pending.")}
                  </p>
                  <span>PNG · 3 files</span>
                </div>
                {!["SUBMITTED", "DISPUTED", "APPROVED"].includes(
                  state.phase,
                ) && (
                  <div className="soft-note">
                    Reference images. No delivery is submitted at this phase.
                  </div>
                )}
              </Tabs.Content>
              <Tabs.Content value="scope">
                <Scope />
              </Tabs.Content>
            </Tabs.Root>
          </Panel>
          {/* Timeline + evidence stay visible in the work column
              (04 §7.1), not behind a tab. */}
          <Panel className="activity-panel">
            <h2 className="activity-heading">Activity</h2>
            <Timeline />
            <EvidencePanel />
          </Panel>
          <div className="work-notes">
            <p className="privacy-inline">
              <Icon>◇</Icon> <a href="/privacy">Who sees what →</a>
            </p>
          </div>
        </div>
        <aside
          className="payment-summary"
          aria-label="Independent payment status"
        >
          <PaymentPanel />
        </aside>
      </div>
    </>
  );
}
