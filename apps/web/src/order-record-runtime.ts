export type OrderPhase =
  | "DEPLOYED"
  | "RESERVED"
  | "ACCEPTED"
  | "SUBMITTED"
  | "DISPUTED"
  | "APPROVED"
  | "CANCELLED";

export type ChainOrderRecord = {
  orderId: string;
  network: "preprod";
  address: string;
  phase: OrderPhase;
  revision: number;
  deliveryManifest: string | null;
  observedAt: number | null;
  fresh: boolean | null;
  fileCount: number;
};

type OrderRecordAbsentReason =
  | "no-quote"
  | "unloaded"
  | "loading"
  | "missing"
  | "error"
  | "unconfigured";

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
      readonly checkpointAddress: string;
      readonly phase: OrderPhase;
      readonly phaseLabel: string;
    };

export const ORDER_RECORD_FUNCTION = "orders:read";

export type OrderRecordTransport = {
  read(args: { quoteId: string }): Promise<ChainOrderRecord | null>;
};

type Outcome =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "result"; record: ChainOrderRecord | null };

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

const absent = (reason: OrderRecordAbsentReason): OrderRecordView => ({
  kind: "absent",
  reason,
  message: ABSENT_COPY[reason],
});

export function describeOrderRecord(
  quoteId: string | null | undefined,
  outcome: Outcome,
): OrderRecordView {
  const trimmed = (quoteId ?? "").trim();
  if (!trimmed) return absent("no-quote");
  if (outcome.status === "idle") return absent("unloaded");
  if (outcome.status === "loading") return absent("loading");
  if (outcome.status === "error") return absent("error");
  const record = outcome.record;
  if (!record || typeof record.address !== "string" || !record.address)
    return absent("missing");
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
  return absent("unconfigured");
}

export function orderRecordProvenance(): string {
  return "Chain-backed order record: Convex orders projection written by the A1 ingest path (observationIngest → chainObservations → orders). Read-only from the browser; the console never writes phases.";
}

type Snapshot = {
  quoteId: string;
  outcome: Outcome;
  busy: boolean;
  message: string;
};

export class OrderRecordController {
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = {
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

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  setQuoteId(quoteId: string) {
    this.update({
      quoteId,
      outcome: { status: "idle" },
      busy: false,
      message: quoteId.trim() ? ABSENT_COPY.unloaded : ABSENT_COPY["no-quote"],
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

  view(): OrderRecordView {
    return describeOrderRecord(this.snapshot.quoteId, this.snapshot.outcome);
  }
}
