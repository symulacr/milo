import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { bytesToHex, HEX64, hexToBytes } from "./encoding.ts";

export const CONSTRUCTOR_ENCODING: "milo:compact-configuration:v1" =
  "milo:compact-configuration:v1";
const INVALID_CONSTRUCTOR = "Invalid versioned public constructor inputs";
const ZERO64 = "0".repeat(64);
const NETWORKS = new Set(["preprod", "undeployed"]);
const ENCODER = new TextEncoder();

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

const nonzeroHex = (value: unknown): boolean =>
  typeof value === "string" && HEX64.test(value) && value !== ZERO64;

const fingerprint = (kind: string, value: unknown) =>
  bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify(["milo:admission-observation:v2", kind, value]),
      ),
    ),
  );

const roles = (q: ConstructorQuote) => [
  q.buyerCommitment,
  q.merchantCommitment,
  q.operatorCommitment,
];
export function reconstructPublicConstructor(quote: ConstructorQuote) {
  const commitments = roles(quote);
  const deadlines = [
    quote.acceptanceDeadlineSeconds,
    quote.deliveryDeadlineSeconds,
    quote.reviewDeadlineSeconds,
    quote.resolutionDeadlineSeconds,
  ];
  const ordered = deadlines.every(
    (v, i) => Number.isSafeInteger(v) && v > (i === 0 ? 0 : deadlines[i - 1]),
  );
  const valid =
    quote.constructorVersion === 1 &&
    quote.constructorEncoding === CONSTRUCTOR_ENCODING &&
    NETWORKS.has(quote.network) &&
    [quote.nonce, quote.termsCommitment, ...commitments].every(nonzeroHex) &&
    new Set(commitments).size === 3 &&
    ordered;
  if (!valid) throw new Error(INVALID_CONSTRUCTOR);
  const network = new Uint8Array(32);
  network.set(ENCODER.encode(quote.network));
  const [a, b, c, d] = deadlines.map(BigInt);
  return {
    network,
    orderNonce: hexToBytes(quote.nonce),
    termsCommitment: hexToBytes(quote.termsCommitment),
    buyerCommitment: hexToBytes(commitments[0]),
    merchantCommitment: hexToBytes(commitments[1]),
    operatorCommitment: hexToBytes(commitments[2]),
    acceptanceDeadline: a,
    deliveryDeadline: b,
    reviewDeadline: c,
    resolutionDeadline: d,
  };
}

export function publicConstructorFingerprints(quote: ConstructorQuote) {
  const config = reconstructPublicConstructor(quote);
  const commitments = roles(quote);
  return {
    rolesFingerprint: fingerprint("roles", commitments),
    initialStateFingerprint: fingerprint("initial-ledger", [
      "1",
      bytesToHex(config.network),
      quote.nonce,
      quote.termsCommitment,
      ...commitments,
      config.acceptanceDeadline.toString(),
      config.deliveryDeadline.toString(),
      config.reviewDeadline.toString(),
      config.resolutionDeadline.toString(),
      "0",
      "0",
      ZERO64,
      ZERO64,
    ]),
  };
}

export function validPublicConstructor(quote: unknown): boolean {
  try {
    const expected = publicConstructorFingerprints(quote as ConstructorQuote);
    const record = quote as Record<string, unknown>;
    return Object.entries(expected).every(
      ([key, value]) => record[key] === value,
    );
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_CONSTRUCTOR)
      return false;
    throw error;
  }
}
