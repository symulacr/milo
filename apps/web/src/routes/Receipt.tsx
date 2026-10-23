import { Link } from "react-router";
import { sampleFiles } from "../assets";
import { PageTitle } from "../components/PageTitle";
import { Panel } from "../components/ui";
import { paymentLine, phaseFrame } from "../workspace/framing";
import { useWorkspace } from "../workspace/model";

export function Receipt() {
  const { state, quote, money, exportReceipt } = useWorkspace();
  return (
    <>
      <PageTitle title="Sample receipt" />
      <Panel className="reading-panel receipt">
        <div className="receipt-mark" aria-hidden="true">
          m
        </div>
        <h2>{quote.name}</h2>
        <dl className="detail-grid">
          <div>
            <dt>Order phase</dt>
            <dd>{phaseFrame(state.phase, state.role).heading}</dd>
          </div>
          <div>
            <dt>Payment observation</dt>
            <dd>{paymentLine(state.payment)}</dd>
          </div>
          <div>
            <dt>Agreed amount</dt>
            <dd>{money} USD</dd>
          </div>
          <div>
            <dt>Sample file bytes</dt>
            <dd>
              {state.filesVerified
                ? "Locally checked"
                : "Not checked in this actor context"}
            </dd>
          </div>
          <div>
            <dt>Network / transaction</dt>
            <dd>None · simulator only</dd>
          </div>
          <div>
            <dt>Observation freshness</dt>
            <dd>Simulator: state is instantaneous</dd>
          </div>
          <div>
            <dt>Sample revision</dt>
            <dd>{state.revision}</dd>
          </div>
        </dl>
        <h3>Manifest SHA-256 digests (3 files)</h3>
        <dl className="detail-grid">
          {sampleFiles.map((file) => (
            <div key={file.id}>
              <dt>
                {file.id} · {file.title}
              </dt>
              <dd>
                <code className="hash">{file.hash}</code>
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" className="button" onClick={exportReceipt}>
          Download receipt ↓
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => window.print()}
        >
          Print receipt
        </button>
        <p>
          <Link className="text-link" to="/orders/sample-001">
            Back to the order
          </Link>
        </p>
      </Panel>
    </>
  );
}
