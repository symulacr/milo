export interface AdmissionBindingReceipt {
  source: "canonicalBindings";
  verdict: "bound";
  binding: {
    network: string;
    nonce: string;
    address: string;
    quoteId: string;
    observationId: string;
    authorizationId: string;
    boundAt: number;
  };
}

export interface ChainReservationReceipt {
  source: "chain-observer";
  kind: "reserved";
  orderId: string;
  address: string;
  observedAt: number;
}

export interface ReleaseEvidence {
  canonicalBinding?: AdmissionBindingReceipt | undefined;
  chainReservation?: ChainReservationReceipt | undefined;
}

export interface ReleaseFlags {
  readonly immutableOrderAdmission: boolean;
  readonly r1Complete: boolean;
}

export const RELEASE_FLAG_DEFAULTS: ReleaseFlags = Object.freeze({
  immutableOrderAdmission: false,
  r1Complete: false,
});

type ReceiptShape = {
  readonly tag: Readonly<Record<string, string>>;
  readonly text: readonly string[];
  readonly stamp: string;
  readonly nested?: string;
};

const SHAPES = {
  canonicalBinding: {
    tag: { source: "canonicalBindings", verdict: "bound" },
    nested: "binding",
    text: [
      "network",
      "nonce",
      "address",
      "quoteId",
      "observationId",
      "authorizationId",
    ],
    stamp: "boundAt",
  },
  chainReservation: {
    tag: { source: "chain-observer", kind: "reserved" },
    text: ["orderId", "address"],
    stamp: "observedAt",
  },
} as const satisfies Record<string, ReceiptShape>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function matchesShape(value: unknown, shape: ReceiptShape): boolean {
  if (!isRecord(value)) return false;
  if (Object.entries(shape.tag).some(([key, want]) => value[key] !== want)) {
    return false;
  }
  const target = shape.nested ? value[shape.nested] : value;
  if (!isRecord(target)) return false;
  const stamp = target[shape.stamp];
  return (
    shape.text.every((field) => {
      const text = target[field];
      return typeof text === "string" && text.length > 0;
    }) &&
    typeof stamp === "number" &&
    Number.isSafeInteger(stamp) &&
    stamp >= 0
  );
}

export function releaseFlagsFromEvidence(
  evidence?: ReleaseEvidence | null,
): ReleaseFlags {
  const immutableOrderAdmission = matchesShape(
    evidence?.canonicalBinding,
    SHAPES.canonicalBinding,
  );
  const r1Complete =
    immutableOrderAdmission &&
    matchesShape(evidence?.chainReservation, SHAPES.chainReservation);
  return Object.freeze({ immutableOrderAdmission, r1Complete });
}

export function releaseFlags(evidence?: ReleaseEvidence | null): ReleaseFlags {
  if (evidence === undefined || evidence === null) return RELEASE_FLAG_DEFAULTS;
  return releaseFlagsFromEvidence(evidence);
}
