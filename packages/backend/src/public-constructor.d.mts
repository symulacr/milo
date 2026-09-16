export const CONSTRUCTOR_ENCODING: "milo:compact-configuration:v1";
export interface PublicConstructorInputs {
  constructorVersion: 1;
  constructorEncoding: typeof CONSTRUCTOR_ENCODING;
  buyerCommitment: string;
  merchantCommitment: string;
  operatorCommitment: string;
}
export interface ConstructorQuote extends PublicConstructorInputs {
  network: string;
  nonce: string;
  termsCommitment: string;
  acceptanceDeadlineSeconds: number;
  deliveryDeadlineSeconds: number;
  reviewDeadlineSeconds: number;
  resolutionDeadlineSeconds: number;
}
export function reconstructPublicConstructor(quote: ConstructorQuote): {
  network: Uint8Array;
  orderNonce: Uint8Array;
  termsCommitment: Uint8Array;
  buyerCommitment: Uint8Array;
  merchantCommitment: Uint8Array;
  operatorCommitment: Uint8Array;
  acceptanceDeadline: bigint;
  deliveryDeadline: bigint;
  reviewDeadline: bigint;
  resolutionDeadline: bigint;
};
export function publicConstructorFingerprints(quote: ConstructorQuote): {
  rolesFingerprint: string;
  initialStateFingerprint: string;
};
export function validPublicConstructor(quote: unknown): boolean;
