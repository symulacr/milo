import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// v1: lowercase hex Bytes<32>, UTF-8 network right-padded with zeros,
// safe integer seconds converted losslessly to Uint<64>; protocol 1 initial ledger.
export const CONSTRUCTOR_ENCODING = "milo:compact-configuration:v1";
const INVALID_CONSTRUCTOR = "Invalid versioned public constructor inputs";
const nonzeroHex = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value) &&
  value !== "0".repeat(64);
const bytes = (hex) =>
  Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
const fingerprint = (kind, value) =>
  bytesToHex(
    sha256(JSON.stringify(["milo:admission-observation:v2", kind, value])),
  );

export function reconstructPublicConstructor(quote) {
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
    orderNonce: bytes(quote.nonce),
    termsCommitment: bytes(quote.termsCommitment),
    buyerCommitment: bytes(roles[0]),
    merchantCommitment: bytes(roles[1]),
    operatorCommitment: bytes(roles[2]),
    acceptanceDeadline: BigInt(deadlines[0]),
    deliveryDeadline: BigInt(deadlines[1]),
    reviewDeadline: BigInt(deadlines[2]),
    resolutionDeadline: BigInt(deadlines[3]),
  };
}

export function publicConstructorFingerprints(quote) {
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

export function validPublicConstructor(quote) {
  try {
    const expected = publicConstructorFingerprints(quote);
    return Object.entries(expected).every(
      ([key, value]) => quote[key] === value,
    );
  } catch (error) {
    // Only the designed validation failure is a "false" verdict; programmer
    // errors (throwing getters, proxies, null shapes) must surface as bugs.
    if (error instanceof Error && error.message === INVALID_CONSTRUCTOR)
      return false;
    throw error;
  }
}
