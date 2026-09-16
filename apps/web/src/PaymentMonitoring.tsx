import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  MonitoringController,
  type MonitoringTransport,
  type MonitorStatus,
  monitoringControls,
} from "./payment-monitoring-runtime";

const statusQuery = makeFunctionReference<
  "query",
  { quoteId: string; refreshToken: string },
  MonitorStatus
>("paymentMonitoring:status");
const startMutation = makeFunctionReference<
  "mutation",
  { quoteId: string; expectedVersion: number; consent: "monitor-test-payment" },
  unknown
>("paymentMonitoring:start");
const stopMutation = makeFunctionReference<
  "mutation",
  { quoteId: string },
  unknown
>("paymentMonitoring:stop");

export function PaymentMonitoring() {
  const client = useConvex();
  const transport = useMemo<MonitoringTransport>(
    () => ({
      status: (args) =>
        client.query(statusQuery, {
          ...args,
          refreshToken: crypto.randomUUID(),
        }),
      start: (args) => client.mutation(startMutation, args),
      stop: (args) => client.mutation(stopMutation, args),
    }),
    [client],
  );
  return <PaymentMonitoringControls transport={transport} />;
}

export function PaymentMonitoringControls({
  transport,
}: {
  transport: MonitoringTransport;
}) {
  const [quoteId, setQuoteId] = useState("");
  return (
    <section aria-labelledby="payment-monitoring-title">
      <h3 id="payment-monitoring-title">Read-only test payment monitoring</h3>
      <p>
        Observes an existing Stripe test payment by quote ID. It cannot create,
        capture or settle anything.
      </p>
      <p>Sessions expire after five minutes, with no automatic renewal.</p>
      <label htmlFor="monitor-quote-id">Quote ID</label>
      <input
        id="monitor-quote-id"
        type="text"
        autoComplete="off"
        value={quoteId}
        onChange={(event) => setQuoteId(event.target.value)}
      />
      {quoteId.trim() ? (
        <QuoteMonitoring
          key={quoteId.trim()}
          quoteId={quoteId.trim()}
          transport={transport}
        />
      ) : (
        <p role="status">Enter a quote ID to look up monitoring status.</p>
      )}
    </section>
  );
}

function QuoteMonitoring({
  quoteId,
  transport,
}: {
  quoteId: string;
  transport: MonitoringTransport;
}) {
  const controller = useMemo(
    () => new MonitoringController(quoteId, transport),
    [quoteId, transport],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => () => controller.invalidate(), [controller]);
  const expiresAt = snapshot.status?.expiresAt;
  useEffect(() => {
    setNow(Date.now());
    if (expiresAt == null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const controls = monitoringControls(snapshot.status, now);
  return (
    <>
      <p role="status">{snapshot.message}</p>
      {snapshot.status && (
        <p>
          Last checked monitoring state:{" "}
          <strong>
            {controls.stale
              ? "expired (local clock; refresh to verify)"
              : snapshot.status.state}
          </strong>
          {expiresAt != null && (
            <>
              {" "}
              · Expires{" "}
              <time dateTime={new Date(expiresAt).toISOString()}>
                {new Date(expiresAt).toLocaleString()}
              </time>
            </>
          )}
        </p>
      )}
      {controls.stale && (
        <p>
          Local expiry does not grant permission to start again. Refresh for
          server-authorized controls.
        </p>
      )}
      <label className="connection-consent">
        <input
          type="checkbox"
          checked={snapshot.consent}
          disabled={
            snapshot.busy || snapshot.needsRefresh || !controls.canStart
          }
          onChange={(event) => controller.consent(event.target.checked)}
        />{" "}
        I consent to five minutes of read-only observation of this quote’s
        existing Stripe test payment. This is not consent to move money.
      </label>
      <div className="connection-actions">
        <button
          className="button secondary"
          type="button"
          disabled={snapshot.busy}
          onClick={() => {
            void controller.refresh();
          }}
        >
          Refresh monitoring status
        </button>
        <button
          className="button"
          type="button"
          disabled={
            snapshot.busy ||
            snapshot.needsRefresh ||
            !snapshot.consent ||
            !controls.canStart
          }
          onClick={() => {
            void controller.mutate("start");
          }}
        >
          Start read-only monitoring
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={snapshot.busy || snapshot.needsRefresh || !controls.canStop}
          onClick={() => {
            void controller.mutate("stop");
          }}
        >
          Stop monitoring
        </button>
      </div>
    </>
  );
}
