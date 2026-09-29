export interface DeliveryCommitmentFile {
  sha256: string;
}
/**
 * SHA-256 of concatenated ordered file digests (hex(f0)||hex(f1)||hex(f2)).
 * Digest-bound; never a randomBytes placeholder.
 */
export function deliveryCommitment(
  files: readonly DeliveryCommitmentFile[],
): string;
