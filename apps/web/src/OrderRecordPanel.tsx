import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { applyCheckpoint } from "./buyer-reserve-runtime";
import {
  type ChainOrderRecord,
  describeUnconfiguredOrderRecord,
  ORDER_RECORD_FUNCTION,
  OrderRecordController,
  type OrderRecordTransport,
  type OrderRecordView,
  orderRecordProvenance,
} from "./order-record-runtime";
import { emitRecoveryKitChanged, readKit, writeKit } from "./recovery-runtime";

const readOrder = makeFunctionReference<
  "query",
  { quoteId: string },
  ChainOrderRecord | null
>(ORDER_RECORD_FUNCTION);

const UNCONFIGURED_TRANSPORT: OrderRecordTransport = {
  read: async () => null,
};

export function OrderRecordPanel({
  actorId,
  onRecord,
}: {
  actorId?: string | undefined;
  onRecord?: (view: OrderRecordView) => void;
}) {
  const client = useConvex();
  const transport = useMemo<OrderRecordTransport>(
    () => ({
      read: (args) =>
        client.query(readOrder, args) as Promise<ChainOrderRecord | null>,
    }),
    [client],
  );
  return (
    <OrderRecordControls
      transport={transport}
      actorId={actorId}
      onRecord={onRecord}
    />
  );
}

export function UnconfiguredOrderRecordPanel({
  defaultQuoteId,
}: {
  defaultQuoteId?: string;
}) {
  return (
    <OrderRecordControls
      transport={UNCONFIGURED_TRANSPORT}
      unconfigured
      defaultQuoteId={defaultQuoteId}
    />
  );
}

export function OrderRecordControls({
  transport,
  actorId,
  onRecord,
  unconfigured = false,
  defaultQuoteId,
}: {
  transport: OrderRecordTransport;
  actorId?: string | undefined;
  onRecord?: (view: OrderRecordView) => void;
  unconfigured?: boolean;
  defaultQuoteId?: string | undefined;
}) {
  const controller = useMemo(() => {
    const created = new OrderRecordController(transport);
    if (defaultQuoteId !== undefined) created.setQuoteId(defaultQuoteId);
    return created;
  }, [transport, defaultQuoteId]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  const [seenOutcome, setSeenOutcome] = useState(snapshot.outcome);
  if (seenOutcome !== snapshot.outcome) {
    setSeenOutcome(snapshot.outcome);
    setNow(Date.now());
  }
  const view: OrderRecordView = unconfigured
    ? describeUnconfiguredOrderRecord()
    : controller.view();
  useEffect(() => {
    onRecord?.(view);
  }, [view, onRecord]);
  return (
    <section aria-labelledby="order-record-title">
      <h3 id="order-record-title">Chain-backed order record</h3>
      <p className="micro muted">{orderRecordProvenance()}</p>
      <p className="micro muted">
        The checkpoint address and phase come only from that record; no phase
        label appears without one.
      </p>
      <label htmlFor="order-record-quote-id">Quote ID</label>
      <input
        id="order-record-quote-id"
        type="text"
        autoComplete="off"
        value={snapshot.quoteId}
        disabled={unconfigured}
        onChange={(event) => controller.setQuoteId(event.target.value)}
      />
      <div className="connection-actions">
        <button
          className="button"
          type="button"
          disabled={unconfigured || snapshot.busy || !snapshot.quoteId.trim()}
          onClick={() => {
            void controller.refresh();
          }}
        >
          Load chain-backed record
        </button>
      </div>
      <p role="status">{snapshot.message}</p>
      {view.kind === "record" ? (
        <RecordFacts view={view} actorId={actorId} />
      ) : (
        <p role="status" data-order-record="absent">
          No phase and no checkpoint address: {view.message}
        </p>
      )}
      <p className="micro muted">Read as of {new Date(now).toISOString()}.</p>
    </section>
  );
}

function RecordFacts({
  view,
  actorId,
}: {
  view: Extract<OrderRecordView, { kind: "record" }>;
  actorId?: string | undefined;
}) {
  const [notice, setNotice] = useState("");
  const { record, checkpointAddress, phaseLabel } = view;
  function checkpointFromProjection() {
    if (!actorId) {
      setNotice("Sign in is required to bind a local recovery context.");
      return;
    }
    const scope = {
      actorId,
      network: record.network,
      orderNonce: view.quoteId,
    };
    const existing = readKit(scope);
    if (!existing) {
      setNotice(
        "No local recovery context exists for this actor and quote. Prepare and verify the context first.",
      );
      return;
    }
    const result = applyCheckpoint(existing, checkpointAddress);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    writeKit(scope, result.kit);
    emitRecoveryKitChanged();
    setNotice(`Bound ${checkpointAddress} into the local recovery context.`);
  }
  const observed =
    record.observedAt == null
      ? "None recorded"
      : new Date(record.observedAt).toISOString();
  const freshness =
    record.fresh === true
      ? " · inside freshness window"
      : record.fresh === false
        ? " · outside freshness window (read-model only)"
        : "";
  const facts: [string, ReactNode][] = [
    [
      "Checkpoint address (projection)",
      <code key="address">{checkpointAddress}</code>,
    ],
    ["Network", record.network],
    ["Revision", record.revision],
    ["Latest observation", `${observed}${freshness}`],
    ["Delivery files", record.fileCount],
    ["Delivery manifest", record.deliveryManifest ?? "None"],
  ];
  return (
    <div data-order-record="record">
      <p role="status" data-order-record-phase={record.phase}>
        <strong>{phaseLabel}</strong>
      </p>
      <dl className="detail-grid">
        {facts.map(([term, detail]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{detail}</dd>
          </div>
        ))}
      </dl>
      <div className="connection-actions">
        <button
          className="button"
          type="button"
          disabled={!actorId}
          onClick={checkpointFromProjection}
        >
          Checkpoint projected address
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
