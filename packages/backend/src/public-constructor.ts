import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, HEX64, hexToBytes } from "./encoding.ts";

// v1: lowercase hex Bytes<32>, UTF-8 network right-padded with zeros,
// safe integer seconds converted losslessly to Uint<64>; protocol 1 initial ledger.
export const CONSTRUCTOR_ENCODING: "milo:compact-configuration:v1" =
  "milo:compact-configuration:v1";
const INVALID_CONSTRUCTOR = "Invalid versioned public constructor inputs";

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

const nonzeroHex = (value: unknown) =>
  typeof value === "string" && HEX64.test(value) && value !== "0".repeat(64);
const fingerprint = (kind: string, value: unknown) =>
  bytesToHex(
    sha256(JSON.stringify(["milo:admission-observation:v2", kind, value])),
  );

export function reconstructPublicConstructor(quote: ConstructorQuote) {
  const roles = [
    quote.buyerCommitment,
    quote.merchantCommitment,
    quote.operatorCommitment,
  ];
  const deadlines = [
    quote.acceptanceDeadlineSeconds,
    quote.deliveryDeadlineSeconds,
    quote.reviewDeadlineSeconds,
    quote.resolutionDeadlineSeconds,
  ];
  if (
    quote.constructorVersion !== 1 ||
    quote.constructorEncoding !== CONSTRUCTOR_ENCODING ||
    !["preprod", "undeployed"].includes(quote.network) ||
    ![quote.nonce, quote.termsCommitment, ...roles].every(nonzeroHex) ||
    new Set(roles).size !== 3 ||
    !deadlines.every(
      (value, index) =>
        Number.isSafeInteger(value) &&
        value > (index === 0 ? 0 : deadlines[index - 1]),
    )
  )
    throw new Error(INVALID_CONSTRUCTOR);
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode(quote.network));
  return {
    network,
    orderNonce: hexToBytes(quote.nonce),
    termsCommitment: hexToBytes(quote.termsCommitment),
    buyerCommitment: hexToBytes(roles[0]),
    merchantCommitment: hexToBytes(roles[1]),
    operatorCommitment: hexToBytes(roles[2]),
    acceptanceDeadline: BigInt(deadlines[0]),
    deliveryDeadline: BigInt(deadlines[1]),
    reviewDeadline: BigInt(deadlines[2]),
    resolutionDeadline: BigInt(deadlines[3]),
  };
}

export function publicConstructorFingerprints(quote: ConstructorQuote) {
  const config = reconstructPublicConstructor(quote);
  const roles = [
    quote.buyerCommitment,
    quote.merchantCommitment,
    quote.operatorCommitment,
  ];
  return {
    rolesFingerprint: fingerprint("roles", roles),
    initialStateFingerprint: fingerprint("initial-ledger", [
      "1",
      bytesToHex(config.network),
      quote.nonce,
      quote.termsCommitment,
      ...roles,
      config.acceptanceDeadline.toString(),
      config.deliveryDeadline.toString(),
      config.reviewDeadline.toString(),
      config.resolutionDeadline.toString(),
      "0",
      "0",
      "0".repeat(64),
      "0".repeat(64),
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
    // Only the designed validation failure is a "false" verdict; programmer
    // errors (throwing getters, proxies, null shapes) must surface as bugs.
    if (error instanceof Error && error.message === INVALID_CONSTRUCTOR)
      return false;
    throw error;
  }
}
