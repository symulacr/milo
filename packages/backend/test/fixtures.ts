import type { FrozenQuote } from "../src/admission-policy";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../src/public-constructor.mjs";

/**
 * Shared preprod quote fixture for the backend admission and monitoring
 * suites. Defaults are the common shape; each suite overrides what its
 * assertions actually distinguish (deadline values are load-bearing, see
 * admission-policy.test.ts). Fingerprints are recomputed after overrides so
 * commitment changes cannot desync them. The local-lane harness keeps its own
 * copy in scripts/convex-local-fixtures.ts because that harness copies only
 * convex/ and packages/backend/src.
 */
const HASH = "a".repeat(64);

const IMAGE_PACK_POLICY: {
  serviceVersion: number;
  packQuantity: number;
  outputCount: number;
  unitPriceMinor: number;
} = {
  serviceVersion: 1,
  packQuantity: 1,
  outputCount: 3,
  unitPriceMinor: 1200,
};

type QuoteFixture = FrozenQuote &
  Record<string, unknown> & {
    imagePackPolicy: typeof IMAGE_PACK_POLICY;
    expiresAt?: number;
  };

export function buildQuote(
  overrides: Record<string, unknown> = {},
): QuoteFixture {
  const now = Date.now();
  const defaults = {
    constructorVersion: 1 as const,
    constructorEncoding: CONSTRUCTOR_ENCODING,
    buyerCommitment: "1".repeat(64),
    merchantCommitment: "2".repeat(64),
    operatorCommitment: "3".repeat(64),
    id: "quote-1",
    scopeId: "scope-1",
    network: "preprod",
    nonce: "4".repeat(64),
    version: 1,
    amountMinor: 36000,
    currency: "USD",
    buyerAccountId: "buyer-1",
    termsCommitment: HASH,
    artifactFingerprint: HASH,
    keySetFingerprint: HASH,
    rolesFingerprint: HASH,
    initialStateFingerprint: HASH,
    genesisHash: HASH,
    acceptanceDeadlineSeconds: Math.floor(now / 1000) + 600,
    deliveryDeadlineSeconds: Math.floor(now / 1000) + 1200,
    reviewDeadlineSeconds: Math.floor(now / 1000) + 1800,
    resolutionDeadlineSeconds: Math.floor(now / 1000) + 2400,
    // fresh copy per call: suites mutate the policy on their own quote
    imagePackPolicy: { ...IMAGE_PACK_POLICY },
  };
  // Overrides may replace commitments; the derived fingerprints are recomputed
  // afterwards. The cast is honest: overrides are dynamic test data.
  const quote = { ...defaults, ...overrides } as typeof defaults &
    Record<string, unknown>;
  Object.assign(quote, publicConstructorFingerprints(quote));
  return quote as unknown as QuoteFixture;
}
