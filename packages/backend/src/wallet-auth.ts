import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  canonicalSiteUrl,
  hexToBytes,
  timingSafeEqualHex,
} from "./encoding.ts";

export const WALLET_NONCE_TTL_MS = 5 * 60 * 1000;
/**
 * R23 J-02: the `domain:` line a wallet shows, and the value the server checks.
 * It used to be the literal "milo", which binds nothing: the signed text carried
 * no deployment, so a signature for one Milo deployment was textually valid at
 * any other. The client signs whatever message the server returns
 * (`auth-client.ts:115-130` passes `challenge.data.message` straight to
 * `signData`), so the audience is fixed server-side with no client release. It
 * reads the deployment's own origin — the same value `trustedOrigins` uses — so
 * the two cannot disagree.
 */
export const WALLET_MESSAGE_DOMAIN = "milo";

/** The host a wallet should see, e.g. `milo-nine-delta.vercel.app`. */
export const walletMessageDomain = (): string => {
  const site = canonicalSiteUrl("");
  if (!site) return WALLET_MESSAGE_DOMAIN;
  try {
    return new URL(site).host;
  } catch {
    return WALLET_MESSAGE_DOMAIN;
  }
};
export const WALLET_NETWORK = "preprod";
export const WALLET_PROVIDER_ID = "milo-wallet";
export const WALLET_EMAIL_DOMAIN = "wallet.milo.local";

const ADDRESS_PREFIX = "mn_addr_preprod";
const SIGNED_MESSAGE_PREFIX = "midnight_signed_message";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CHECKSUM = 0x2bc830a3;
const BECH32_GENERATOR = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const MESSAGE_HEADER = "milo.wallet.sign-in";
const MESSAGE_FIELDS = [
  "domain",
  "network",
  "address",
  "nonce",
  "issued-at",
  "expires-at",
] as const;

const FIELD_MODULUS = 2n ** 256n - 2n ** 32n - 977n;
const CURVE_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GENERATOR_X =
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GENERATOR_Y =
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const ENCODER = new TextEncoder();

type Point = { x: bigint; y: bigint } | null;

export type WalletSignInRequest = {
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export type WalletNonceRecord = { value: string; expiresAt: number };

export type WalletNonceStore = {
  put(identifier: string, value: string, expiresAt: number): Promise<void>;
  /** Read without consuming, so a wrong guess cannot burn the real nonce. */
  get(identifier: string): Promise<WalletNonceRecord | null>;
  take(identifier: string): Promise<WalletNonceRecord | null>;
};

export type WalletSignatureInput = {
  message: string;
  verifyingKey: string;
  signature: string;
  scheme?: string;
};

const mod = (value: bigint, modulus: bigint): bigint =>
  ((value % modulus) + modulus) % modulus;

function power(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = mod(base, modulus);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    remaining >>= 1n;
  }
  return result;
}

function addPoints(left: Point, right: Point): Point {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x && mod(left.y + right.y, FIELD_MODULUS) === 0n)
    return null;
  const same = left.x === right.x && left.y === right.y;
  const inverse = power(
    same ? 2n * left.y : right.x - left.x,
    FIELD_MODULUS - 2n,
    FIELD_MODULUS,
  );
  const slope = same
    ? mod(3n * left.x * left.x * inverse, FIELD_MODULUS)
    : mod((right.y - left.y) * inverse, FIELD_MODULUS);
  const x = mod(slope * slope - left.x - right.x, FIELD_MODULUS);
  return { x, y: mod(slope * (left.x - x) - left.y, FIELD_MODULUS) };
}

function multiplyPoint(point: Point, scalar: bigint): Point {
  let result: Point = null;
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if (remaining & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

function liftX(x: bigint): Point {
  if (x >= FIELD_MODULUS) return null;
  const candidate = mod(x * x * x + 7n, FIELD_MODULUS);
  const y = power(candidate, (FIELD_MODULUS + 1n) / 4n, FIELD_MODULUS);
  if (mod(y * y, FIELD_MODULUS) !== candidate) return null;
  return { x, y: y % 2n === 0n ? y : FIELD_MODULUS - y };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  const hex = bytesToHex(bytes);
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagDigest = sha256(ENCODER.encode(tag));
  const buffer = new Uint8Array(64 + message.length);
  buffer.set(tagDigest, 0);
  buffer.set(tagDigest, 32);
  buffer.set(message, 64);
  return sha256(buffer);
}

export function verifySchnorrDigest(
  publicKey: Uint8Array,
  digest: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (
    publicKey.length !== 32 ||
    digest.length !== 32 ||
    signature.length !== 64
  )
    return false;
  const point = liftX(bytesToBigInt(publicKey));
  if (!point) return false;
  const r = bytesToBigInt(signature.subarray(0, 32));
  const s = bytesToBigInt(signature.subarray(32));
  if (r >= FIELD_MODULUS || s >= CURVE_ORDER) return false;
  const challengeInput = new Uint8Array(96);
  challengeInput.set(signature.subarray(0, 32), 0);
  challengeInput.set(publicKey, 32);
  challengeInput.set(digest, 64);
  const challenge = mod(
    bytesToBigInt(taggedHash("BIP0340/challenge", challengeInput)),
    CURVE_ORDER,
  );
  const commitment = addPoints(
    multiplyPoint({ x: GENERATOR_X, y: GENERATOR_Y }, s),
    multiplyPoint(point, mod(CURVE_ORDER - challenge, CURVE_ORDER)),
  );
  if (!commitment || commitment.y % 2n !== 0n) return false;
  return commitment.x === r;
}

function bech32Polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) {
      if ((top >> index) & 1) checksum ^= BECH32_GENERATOR[index] ?? 0;
    }
  }
  return checksum;
}

function bech32PrefixExpanded(prefix: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (const character of prefix) {
    const code = character.charCodeAt(0);
    high.push(code >> 5);
    low.push(code & 31);
  }
  return [...high, 0, ...low];
}

export function decodeBech32m(
  value: string,
): { prefix: string; bytes: Uint8Array } | null {
  if (value.length < 8 || value.length > 90) return null;
  if (value !== value.toLowerCase()) return null;
  const separator = value.lastIndexOf("1");
  if (separator < 1 || separator + 7 > value.length) return null;
  const prefix = value.slice(0, separator);
  const words: number[] = [];
  for (const character of value.slice(separator + 1)) {
    const index = BECH32_CHARSET.indexOf(character);
    if (index < 0) return null;
    words.push(index);
  }
  const checksum = bech32Polymod([...bech32PrefixExpanded(prefix), ...words]);
  if (checksum !== BECH32M_CHECKSUM) return null;
  const payload = words.slice(0, -6);
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const word of payload) {
    accumulator = (accumulator << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  if (bits >= 5) return null;
  if ((accumulator & ((1 << bits) - 1)) !== 0) return null;
  return { prefix, bytes: new Uint8Array(bytes) };
}

export function unshieldedAddressHex(value: string): string | null {
  const decoded = decodeBech32m(value);
  if (!decoded) return null;
  if (decoded.prefix !== ADDRESS_PREFIX) return null;
  if (decoded.bytes.length !== 32) return null;
  return bytesToHex(decoded.bytes);
}

export function isPreprodUnshieldedAddress(value: string): boolean {
  return unshieldedAddressHex(value) !== null;
}

export function addressFromVerifyingKey(verifyingKey: string): string | null {
  const normalized = verifyingKey.toLowerCase();
  if (!HEX_32.test(normalized)) return null;
  return bytesToHex(sha256(hexToBytes(normalized)));
}

export function walletNonceIdentifier(address: string): string {
  return `milo-wallet-nonce:${address}`;
}

export function createWalletNonce(
  random: (byteLength: number) => Uint8Array,
): string {
  return bytesToHex(random(32));
}

export function isNonceUsable(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function memoryWalletNonceStore(): WalletNonceStore {
  const records = new Map<string, WalletNonceRecord>();
  return {
    async put(identifier, value, expiresAt) {
      records.set(identifier, { value, expiresAt });
    },
    async get(identifier) {
      return records.get(identifier) ?? null;
    },
    async take(identifier) {
      const record = records.get(identifier) ?? null;
      records.delete(identifier);
      return record;
    },
  };
}

export async function issueWalletNonce(
  store: WalletNonceStore,
  address: string,
  now: number,
  random: (byteLength: number) => Uint8Array,
): Promise<{ nonce: string; expiresAt: number; message: string }> {
  const nonce = createWalletNonce(random);
  const expiresAt = now + WALLET_NONCE_TTL_MS;
  await store.put(walletNonceIdentifier(address), nonce, expiresAt);
  return {
    nonce,
    expiresAt,
    message: buildWalletSignInMessage({
      address,
      nonce,
      issuedAt: now,
      expiresAt,
    }),
  };
}

export async function consumeWalletNonce(
  store: WalletNonceStore,
  address: string,
  nonce: string,
  now: number,
): Promise<boolean> {
  const identifier = walletNonceIdentifier(address);
  // Read first, consume only on a match. `take` deletes unconditionally, so a
  // wrong guess used to destroy the legitimate nonce and lock the real user out
  // of their own in-flight sign-in — a one-request denial of service, since
  // addresses are public on chain.
  const record = await store.get(identifier);
  if (!record || !isNonceUsable(record.expiresAt, now)) return false;
  if (!timingSafeEqualHex(record.value, nonce)) return false;
  // The compare passed, so this deletes the record we just validated.
  await store.take(identifier);
  return true;
}

export function buildWalletSignInMessage(request: WalletSignInRequest): string {
  return [
    MESSAGE_HEADER,
    `domain: ${walletMessageDomain()}`,
    `network: ${WALLET_NETWORK}`,
    `address: ${request.address}`,
    `nonce: ${request.nonce}`,
    `issued-at: ${new Date(request.issuedAt).toISOString()}`,
    `expires-at: ${new Date(request.expiresAt).toISOString()}`,
  ].join("\n");
}

export function parseWalletSignInMessage(
  message: string,
): WalletSignInRequest | null {
  const lines = message.split("\n");
  if (lines[0] !== MESSAGE_HEADER) return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(": ");
    if (separator < 0) return null;
    const key = line.slice(0, separator);
    if (!(MESSAGE_FIELDS as readonly string[]).includes(key)) return null;
    if (fields.has(key)) return null;
    fields.set(key, line.slice(separator + 2));
  }
  const address = fields.get("address");
  const nonce = fields.get("nonce");
  const issuedAt = fields.get("issued-at");
  const expiresAt = fields.get("expires-at");
  if (!address || !nonce || !issuedAt || !expiresAt) return null;
  if (fields.get("domain") !== walletMessageDomain()) return null;
  if (fields.get("network") !== WALLET_NETWORK) return null;
  if (!isPreprodUnshieldedAddress(address)) return null;
  if (!HEX_32.test(nonce)) return null;
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return null;
  if (expires <= issued) return null;
  return { address, nonce, issuedAt: issued, expiresAt: expires };
}

export function verifyWalletSignature(input: WalletSignatureInput): boolean {
  if (input.scheme && input.scheme !== "schnorr_bip340") return false;
  const verifyingKey = input.verifyingKey.toLowerCase();
  const signature = input.signature.toLowerCase();
  if (!HEX_32.test(verifyingKey)) return false;
  if (!HEX_64.test(signature)) return false;
  const publicKey = hexToBytes(verifyingKey);
  const signatureBytes = hexToBytes(signature);
  const data = ENCODER.encode(input.message);
  // Only the domain-separated form is accepted. The prefix is what stops a
  // signature made for another protocol over the same text from signing in here,
  // so accepting the bare digest as well would defeat it.
  const prefixed = ENCODER.encode(
    `${SIGNED_MESSAGE_PREFIX}:${data.length}:${input.message}`,
  );
  return verifySchnorrDigest(publicKey, sha256(prefixed), signatureBytes);
}

export function walletBoundToAddress(
  verifyingKey: string,
  address: string,
): boolean {
  const derived = addressFromVerifyingKey(verifyingKey);
  const claimed = unshieldedAddressHex(address);
  if (!derived || !claimed) return false;
  return derived === claimed;
}
