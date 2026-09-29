/**
 * Thin structural types for the order contract boundary.
 *
 * Circuit identifiers and private-state shapes are derived from the generated
 * contract artifacts (packages/contract/generated/contract/index.d.ts), not a
 * parallel hand-maintained union. `hashTerms` / `hashCapability` live on the
 * generated module's `pureCircuits` and are never reimplemented here — openings
 * must never cross as transaction arguments (packages/contract/SPEC.md).
 *
 * Runtime loading of the generated module is a Wave B concern (it pulls the
 * Compact WASM runtime). This package only needs the types.
 */

/** Mirrors generated `Phase`. */
export const Phase = {
  DEPLOYED: 0,
  RESERVED: 1,
  ACCEPTED: 2,
  SUBMITTED: 3,
  DISPUTED: 4,
  APPROVED: 5,
  CANCELLED: 6,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

/** Mirrors generated `Role` (`BUYER=0`, `MERCHANT=1`, `OPERATOR=2`). */
export const Role = {
  BUYER: 0,
  MERCHANT: 1,
  OPERATOR: 2,
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Mirrors generated `Terms`. Values are Compact-serialized field shapes. */
export type Terms = {
  readonly serviceVersion: bigint;
  readonly packQuantity: bigint;
  readonly outputCount: bigint;
  readonly unitPrice: bigint;
  readonly total: bigint;
  readonly currency: Uint8Array;
  readonly scopeDigest: Uint8Array;
  readonly rightsDigest: Uint8Array;
  readonly paymentPolicy: Uint8Array;
  readonly salt: Uint8Array;
};

/** Mirrors generated `Configuration` (public constructor inputs). */
export type Configuration = {
  readonly network: Uint8Array;
  readonly orderNonce: Uint8Array;
  readonly termsCommitment: Uint8Array;
  readonly buyerCommitment: Uint8Array;
  readonly merchantCommitment: Uint8Array;
  readonly operatorCommitment: Uint8Array;
  readonly acceptanceDeadline: bigint;
  readonly deliveryDeadline: bigint;
  readonly reviewDeadline: bigint;
  readonly resolutionDeadline: bigint;
};

/**
 * Actor-local private state for the buyer `reserve` path. Secrets never
 * synchronize through Convex or Cascade (packages/contract/SPEC.md).
 */
export type BuyerPrivateState = {
  readonly actor: "buyer";
  readonly secret: Uint8Array;
  readonly terms: Terms;
  /** Buyer approval limit. Reserve-only and self-declared. */
  readonly limit: bigint;
};

/** Actor-local private state for the merchant `accept` path. */
export type MerchantPrivateState = {
  readonly actor: "merchant";
  readonly secret: Uint8Array;
  readonly terms: Terms;
};
