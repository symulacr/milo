import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { applyCheckpoint } from "./buyer-reserve-runtime";
import {
  type ChainOrderRecord,
  describeUnconfiguredOrderRecord,
  ORDER_RECORD_FUNCTION,
  OrderRecordController,
  orderRecordProvenance,
  type OrderRecordTransport,
  type OrderRecordView,
} from "./order-record-runtime";
import {
  emitRecoveryKitChanged,
  readKit,
  writeKit,
} from "./recovery-runtime";

const readOrder = makeFunctionReference<
  "query",
  { quoteId: string },
  ChainOrderRecord | null
>(ORDER_RECORD_FUNCTION);

/**
 * Chain-backed order record from the Convex projection (A1 ingest path).
 * Renders a phase label only when a backing record exists; the checkpoint
 * address is the projection's canonical address, never a typed invention.
 */
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
      read: (args) => client.query(readOrder, args) as Promise<ChainOrderRecord | null>,
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

export function OrderRecordControls({
  transport,
  actorId,
  onRecord,
  unconfigured = false,
}: {
  transport: OrderRecordTransport;
  actorId?: string | undefined;
  onRecord?: (view: OrderRecordView) => void;
  unconfigured?: boolean;
}) {
  const controller = useMemo(
    () => new OrderRecordController(transport),
    [transport],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [snapshot.outcome]);
  const view: OrderRecordView = unconfigured
    ? describeUnconfiguredOrderRecord()
    : controller.view();
  useEffect(() => {
    onRecord?.(view);
  }, [view, onRecord]);
  return (
    <section aria-labelledby="order-record-title">
      <h3 id="order-record-title">Chain-backed order record</h3>
      <p>
        Reads the Convex order projection written by the A1 ingest path. The
        checkpoint address and phase below come only from that record; no phase
        label is shown without a backing record.
      </p>
      <p className="micro muted">{orderRecordProvenance()}</p>
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
      <p className="micro muted">
        Read as of {new Date(now).toISOString()}. Freshness is read-model only
        and never grants phase authority.
      </p>
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
      setNotice(
        "Sign in is required to bind a local recovery context before checkpointing.",
      );
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
        "No local recovery context exists for this actor and quote. Prepare and verify the context first, then checkpoint the projected address.",
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
    setNotice(
      `Projected checkpoint address ${checkpointAddress} bound into the local recovery context. The address came from the Convex projection, not from typed input.`,
    );
  }
  return (
    <div data-order-record="record">
      <p role="status" data-order-record-phase={record.phase}>
        <strong>{phaseLabel}</strong>
      </p>
      <dl className="detail-grid">
        <div>
          <dt>Checkpoint address (projection)</dt>
          <dd>
            <code>{checkpointAddress}</code>
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{record.network}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{record.revision}</dd>
        </div>
        <div>
          <dt>Latest observation</dt>
          <dd>
            {record.observedAt == null
              ? "None recorded"
              : new Date(record.observedAt).toISOString()}
            {record.fresh === true
              ? " · inside freshness window"
              : record.fresh === false
                ? " · outside freshness window (read-model only)"
                : ""}
          </dd>
        </div>
        <div>
          <dt>Delivery files</dt>
          <dd>{record.fileCount}</dd>
        </div>
        <div>
          <dt>Delivery manifest</dt>
          <dd>{record.deliveryManifest ?? "None"}</dd>
        </div>
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
