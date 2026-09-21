import { Link } from "react-router";
import { sampleFiles } from "../assets";
import { PageTitle } from "../components/PageTitle";
import { Badge } from "../components/ui";
import { paymentLine, phaseFrame } from "../workspace/framing";
import { useWorkspace } from "../workspace/model";

export function Orders({ merchant = false }: { merchant?: boolean }) {
  const { state, quote, money } = useWorkspace();
  const frame = phaseFrame(state.phase, state.role);
  return (
    <>
      <PageTitle title={merchant ? "Studio queue" : "Your orders"} />
      <div className="list-toolbar">
        <span className="muted">1 sample order · refresh resets</span>
        {merchant && (
          <Link className="button small" to="/merchant/quotes/new">
            Prepare a sample quote ↗
          </Link>
        )}
      </div>
      <Link to="/orders/sample-001" className="order-list-card">
        <img
          src={sampleFiles[0].src}
          alt="Sample Still Studio photography"
          width="104"
          height="120"
        />
        <div>
          <h2>{quote.name}</h2>
          <p>
            North Studio · three-image pack · {money} USD · {frame.next}
            {frame.due && ` · due ${frame.due} · sample clock`}
            {` · ${paymentLine(state.payment)}`}
          </p>
        </div>
        <Badge>{frame.heading}</Badge>
        <span className="list-arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
    </>
  );
}
