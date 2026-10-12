/**
 * RECONSTRUCTED (P8-W1-C) - evidence-gated release flags, single source of truth.
 *
 * Every harness emits `releaseFlags()` / `releaseFlagsFromEvidence()`.
 * Defaults are frozen false. A flag flips only when a stored receipt is
 * supplied; boolean claims, fixture shapes, and incomplete receipts stay false.
 *
 * - `immutableOrderAdmission` requires a stored canonical binding receipt
 *   (source "canonicalBindings", verdict "bound", full AdmissionBinding identity).
 * - `r1Complete` additionally requires a chain-witnessed reservation receipt
 *   (source "chain-observer", kind "reserved").
 *
 * Without stored receipts the flags are false. This module never invents
 * evidence and never reads the network.
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

export const RELEASE_FLAG_DEFAULTS: ReleaseFlags = Object.freeze({
  immutableOrderAdmission: false,
  r1Complete: false,
});

function isCanonicalBindingReceipt(
  value: unknown,
): value is AdmissionBindingReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as {
    source?: unknown;
    verdict?: unknown;
    binding?: unknown;
  };
  if (receipt.source !== "canonicalBindings" || receipt.verdict !== "bound") {
    return false;
  }
  const binding = receipt.binding;
  if (!binding || typeof binding !== "object") return false;
  const b = binding as Record<string, unknown>;
  return (
    typeof b.network === "string" &&
    b.network.length > 0 &&
    typeof b.nonce === "string" &&
    b.nonce.length > 0 &&
    typeof b.address === "string" &&
    b.address.length > 0 &&
    typeof b.quoteId === "string" &&
    b.quoteId.length > 0 &&
    typeof b.observationId === "string" &&
    b.observationId.length > 0 &&
    typeof b.authorizationId === "string" &&
    b.authorizationId.length > 0 &&
    typeof b.boundAt === "number" &&
    Number.isSafeInteger(b.boundAt) &&
    b.boundAt >= 0
  );
}

function isChainReservationReceipt(
  value: unknown,
): value is ChainReservationReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as {
    source?: unknown;
    kind?: unknown;
    orderId?: unknown;
    address?: unknown;
    observedAt?: unknown;
  };
  if (receipt.source !== "chain-observer" || receipt.kind !== "reserved") {
    return false;
  }
  return (
    typeof receipt.orderId === "string" &&
    receipt.orderId.length > 0 &&
    typeof receipt.address === "string" &&
    receipt.address.length > 0 &&
    typeof receipt.observedAt === "number" &&
    Number.isSafeInteger(receipt.observedAt) &&
    receipt.observedAt >= 0
  );
}

/**
 * Evidence-driven setter. Incomplete or absent receipts leave flags false.
 */
export function releaseFlagsFromEvidence(
  evidence?: ReleaseEvidence | null,
): ReleaseFlags {
  const immutableOrderAdmission = isCanonicalBindingReceipt(
    evidence?.canonicalBinding,
  );
  const r1Complete =
    immutableOrderAdmission &&
    isChainReservationReceipt(evidence?.chainReservation);
  return Object.freeze({ immutableOrderAdmission, r1Complete });
}

/**
 * What every harness emits today. No evidence -> frozen defaults (all false).
 */
export function releaseFlags(evidence?: ReleaseEvidence | null): ReleaseFlags {
  if (evidence === undefined || evidence === null) return RELEASE_FLAG_DEFAULTS;
  return releaseFlagsFromEvidence(evidence);
}
