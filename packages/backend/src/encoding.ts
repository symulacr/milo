import {
  bytesToHex as nobleBytesToHex,
  hexToBytes as nobleHexToBytes,
} from "@noble/hashes/utils.js";

export const HEX64 = /^[a-f0-9]{64}$/;

/** Hex codec: `@noble/hashes` already ships it and is a direct dependency. */
export const hexToBytes = (hex: string): Uint8Array => nobleHexToBytes(hex);
export const bytesToHex = (b: Uint8Array | ArrayLike<number>): string =>
  nobleBytesToHex(b instanceof Uint8Array ? b : Uint8Array.from(b));

/**
 * A trimmed, non-empty environment value, or undefined. One definition for the
 * three Convex modules that used to carry their own copy.
 */
export function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The canonical origin: the first entry of the comma list SITE_URL becomes
 * during a host cutover. `trustedOrigins` gets every entry; links and wallet
 * audiences must name exactly one.
 */
export const canonicalSiteUrl = (fallback: string): string =>
  (env("SITE_URL") ?? fallback).split(",")[0].trim();

/** Bytes from the platform CSPRNG. Never `Math.random()` for a secret. */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** A 32-byte random value as lowercase hex. */
export const randomHex = (): string => bytesToHex(randomBytes(32));

/**
 * Compare two hex strings without leaking where they differ. Unparseable hex is
 * a non-match, never an exception: both callers compare attacker-controlled
 * input on a public path. `http.ts` grew this for the webhook secret; the invite
 * token is the same kind of bearer secret, so it lives here now.
 */
export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  let a: Uint8Array;
  let b: Uint8Array;
  try {
    a = hexToBytes(aHex);
    b = hexToBytes(bHex);
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * PBKDF2-SHA256 -> AES-GCM-256, the one derivation both encrypted blobs use
 * (`workspace/keys.ts` backups, `chain/private-state.ts` exports). The iteration
 * count is the caller's policy, so it is a parameter. `extractable: false` keeps
 * the derived bytes out of JavaScript.
 */
export const deriveAesKey = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};
