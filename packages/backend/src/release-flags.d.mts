/**
 * RECONSTRUCTED (P8-W1-C) — types for the evidence-gated release-flag SSoT.
 * Flags stay false until stored receipts are supplied. See release-flags.mjs.
 */

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

export const RELEASE_FLAG_DEFAULTS: ReleaseFlags;
export function releaseFlags(evidence?: ReleaseEvidence | null): ReleaseFlags;
export function releaseFlagsFromEvidence(
  evidence?: ReleaseEvidence | null,
): ReleaseFlags;
