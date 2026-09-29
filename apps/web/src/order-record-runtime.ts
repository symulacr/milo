/**
 * Browser view-model for the one chain-backed order record the console may
 * show. The record is the Convex projection written by the A1 ingest path
 * (`observationIngest:recordDeployment` / `orders:recordObservation` →
 * `orders` + `chainObservations`); this module never invents a row.
 *
 * Invariant (B3): a phase label is only present when a backing record exists.
 * There is no default phase, no placeholder phase, and no phase for loading,
 * missing, or error states.
 */

export type OrderPhase =
  | "DEPLOYED"
  | "RESERVED"
  | "ACCEPTED"
  | "SUBMITTED"
  | "DISPUTED"
  | "APPROVED"
  | "CANCELLED";

/** Resonance of `convex/orders.ts` `read` returns — the projection, not a client invention. */
export type ChainOrderRecord = {
  orderId: string;
  network: "preprod";
  /** Canonical contract address from the admitted binding / observation. */
  address: string;
  phase: OrderPhase;
  revision: number;
  deliveryManifest: string | null;
  observedAt: number | null;
  /** Read-model freshness only; never transition authority (06 3.1). */
  fresh: boolean | null;
  fileCount: number;
};

export type OrderRecordAbsentReason =
  | "no-quote"
  | "unloaded"
  | "loading"
  | "missing"
  | "error"
  | "unconfigured";

/**
 * Every display state of the order record. `phase` and `checkpointAddress`
 * exist only on the `record` arm — the type itself forbids a phase label
 * without a backing record.
 */
export type OrderRecordView =
  | {
      readonly kind: "absent";
      readonly reason: OrderRecordAbsentReason;
      readonly message: string;
    }
  | {
      readonly kind: "record";
      readonly quoteId: string;
      readonly record: ChainOrderRecord;
      /** Checkpoint address from the projection; never typed or invented. */
      readonly checkpointAddress: string;
      readonly phase: OrderPhase;
      readonly phaseLabel: string;
    };

export const ORDER_RECORD_FUNCTION = "orders:read";

export type OrderRecordTransport = {
  read(args: { quoteId: string }): Promise<ChainOrderRecord | null>;
};

const ABSENT_COPY: Record<OrderRecordAbsentReason, string> = {
  "no-quote":
    "Enter a quote ID to load the chain-backed order record. No phase is shown without a backing record.",
  unloaded:
    "Quote ID set. Load the chain-backed order record from the Convex projection. No phase is shown without a backing record.",
  loading: "Loading the chain-backed order record from the Convex projection…",
  missing:
    "No chain-backed order record is projected for this quote. The A1 ingest path has not recorded an admitted order for it, so no phase and no checkpoint address are shown.",
  error:
    "The order record could not be read from the Convex projection. No phase is shown without a backing record.",
  unconfigured:
    "Convex is not configured, so no chain-backed order record is reachable. No phase is shown without a backing record.",
};

/**
 * Pure display decision. A phase label and checkpoint address are returned
 * only together with a non-null backing record; every other path is an
 * explicit absence that names what is missing.
 */
export function describeOrderRecord(
  quoteId: string | null | undefined,
  outcome:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "result"; record: ChainOrderRecord | null },
): OrderRecordView {
  const trimmed = (quoteId ?? "").trim();
  if (!trimmed) {
    return {
      kind: "absent",
      reason: "no-quote",
      message: ABSENT_COPY["no-quote"],
    };
  }
  if (outcome.status === "idle") {
    return {
      kind: "absent",
      reason: "unloaded",
      message: ABSENT_COPY.unloaded,
    };
  }
  if (outcome.status === "loading") {
    return {
      kind: "absent",
      reason: "loading",
      message: ABSENT_COPY.loading,
    };
  }
  if (outcome.status === "error") {
    return { kind: "absent", reason: "error", message: ABSENT_COPY.error };
  }
  const record = outcome.record;
  if (!record || typeof record.address !== "string" || !record.address) {
    return { kind: "absent", reason: "missing", message: ABSENT_COPY.missing };
  }
  return {
    kind: "record",
    quoteId: trimmed,
    record,
    checkpointAddress: record.address,
    phase: record.phase,
    phaseLabel: `Phase ${record.phase} · revision ${record.revision} · backed by order ${record.orderId}`,
  };
}

export function describeUnconfiguredOrderRecord(): OrderRecordView {
  return {
    kind: "absent",
    reason: "unconfigured",
    message: ABSENT_COPY.unconfigured,
  };
}

/**
 * A1 ingest provenance line for the diagnostics surface. The console reads the
 * projection; it does not re-ingest or simulate observations.
 */
export function orderRecordProvenance(): string {
  return "Chain-backed order record: Convex orders projection written by the A1 ingest path (observationIngest → chainObservations → orders). Read-only from the browser; the console never writes phases.";
}

export class OrderRecordController {
  private listeners = new Set<() => void>();
  private snapshot: {
    quoteId: string;
    outcome:
      | { status: "idle" }
      | { status: "loading" }
      | { status: "error" }
      | { status: "result"; record: ChainOrderRecord | null };
    busy: boolean;
    message: string;
  } = {
    quoteId: "",
    outcome: { status: "idle" },
    busy: false,
    message: ABSENT_COPY["no-quote"],
  };

  constructor(private readonly transport: OrderRecordTransport) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  setQuoteId(quoteId: string) {
    const trimmed = quoteId.trim();
    this.update({
      quoteId,
      outcome: { status: "idle" },
      busy: false,
      message: trimmed ? ABSENT_COPY.unloaded : ABSENT_COPY["no-quote"],
    });
  }

  async refresh() {
    const quoteId = this.snapshot.quoteId.trim();
    if (!quoteId) {
      this.update({
        message: ABSENT_COPY["no-quote"],
        busy: false,
        outcome: { status: "idle" },
      });
      return;
    }
    this.update({
      busy: true,
      outcome: { status: "loading" },
      message: ABSENT_COPY.loading,
    });
    try {
      const record = await this.transport.read({ quoteId });
      this.update({
        busy: false,
        outcome: { status: "result", record },
        message: record
          ? `Loaded chain-backed order record for ${quoteId}.`
          : ABSENT_COPY.missing,
      });
    } catch {
      this.update({
        busy: false,
        outcome: { status: "error" },
        message: ABSENT_COPY.error,
      });
    }
  }

  /** The pure view for the current snapshot — phase only with a backing record. */
  view(): OrderRecordView {
    return describeOrderRecord(this.snapshot.quoteId, this.snapshot.outcome);
  }
}
