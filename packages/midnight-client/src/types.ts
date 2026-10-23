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

export const Role = {
  BUYER: 0,
  MERCHANT: 1,
  OPERATOR: 2,
} as const;
export type Role = (typeof Role)[keyof typeof Role];

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

export type BuyerPrivateState = {
  readonly actor: "buyer";
  readonly secret: Uint8Array;
  readonly terms: Terms;
  readonly limit: bigint;
};

export type MerchantPrivateState = {
  readonly actor: "merchant";
  readonly secret: Uint8Array;
  readonly terms: Terms;
};
