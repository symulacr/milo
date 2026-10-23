import { Link } from "react-router";
import { sampleFiles } from "../assets";
import { PageTitle } from "../components/PageTitle";
import { Panel } from "../components/ui";
import { paymentLine, phaseFrame } from "../workspace/framing";
import { useWorkspace } from "../workspace/model";

export function Receipt() {
  const { state, quote, money, exportReceipt } = useWorkspace();
  const rows = [
    ["Order phase", phaseFrame(state.phase, state.role).heading],
    ["Payment observation", paymentLine(state.payment)],
    ["Agreed amount", `${money} USD`],
    [
      "Sample file bytes",
      state.filesVerified
        ? "Locally checked"
        : "Not checked in this actor context",
    ],
    ["Network / transaction", "None · simulator only"],
    ["Observation freshness", "Simulator: state is instantaneous"],
    ["Sample revision", String(state.revision)],
  ];
  return (
    <>
      <PageTitle title="Sample receipt" />
      <Panel className="reading-panel receipt">
        <div className="receipt-mark" aria-hidden="true">
          m
        </div>
        <h2>{quote.name}</h2>
        <dl className="detail-grid">
          {rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
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
