import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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

const TITLE = "Read-only test payment monitoring";
const TITLE_ID = "payment-monitoring-title";

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID}>{TITLE}</h3>
      <p>Observes an existing Stripe test payment by quote ID.</p>
      {children}
    </section>
  );
}

export function PaymentMonitoring({
  defaultQuoteId,
}: {
  defaultQuoteId?: string;
} = {}) {
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
  return (
    <PaymentMonitoringControls
      transport={transport}
      defaultQuoteId={defaultQuoteId}
    />
  );
}

export function UnconfiguredPaymentMonitoring({
  defaultQuoteId,
}: {
  defaultQuoteId?: string;
}) {
  return (
    <Section>
      <p role="status">
        Convex is not configured, so no payment monitoring state is reachable.
      </p>
      {defaultQuoteId ? (
        <p>
          Quote ID <code>{defaultQuoteId}</code> is held locally only.
        </p>
      ) : null}
    </Section>
  );
}

function PaymentMonitoringControls({
  transport,
  defaultQuoteId,
}: {
  transport: MonitoringTransport;
  defaultQuoteId?: string | undefined;
}) {
  const [quoteId, setQuoteId] = useState(defaultQuoteId ?? "");
  return (
    <Section>
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
    </Section>
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
  const fenced = snapshot.busy || snapshot.needsRefresh;
  return (
    <>
      <p role="status">{snapshot.message}</p>
      {snapshot.status && (
        <p>
          Monitoring state:{" "}
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
      <label className="connection-consent">
        <input
          type="checkbox"
          checked={snapshot.consent}
          disabled={fenced || !controls.canStart}
          onChange={(event) => controller.consent(event.target.checked)}
        />{" "}
        I consent to five minutes of read-only observation of this quote’s
        existing Stripe test payment. This is not consent to move money.
      </label>
      <div className="connection-actions">
        {(
          [
            ["Refresh monitoring status", snapshot.busy, "refresh", true],
            [
              "Start read-only monitoring",
              fenced || !snapshot.consent || !controls.canStart,
              "start",
              false,
            ],
            ["Stop monitoring", fenced || !controls.canStop, "stop", true],
          ] as const
        ).map(([label, disabled, action, secondary]) => (
          <button
            key={label}
            className={secondary ? "button secondary" : "button"}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (action === "refresh") void controller.refresh();
              else void controller.mutate(action);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
