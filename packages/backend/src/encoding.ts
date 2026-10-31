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

/** A loopback origin: localhost, 127.0.0.1 or [::1], with any port. */
const LOOPBACK_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * R51: drop loopback origins from the auth trusted list unless this deployment
 * *is* local.
 *
 * Better Auth's security guidance is explicit: "Do not leave the localhost
 * origin in a trusted origins list of a production auth instance." Production
 * `SITE_URL` carries `http://localhost:3000` and `http://127.0.0.1:3000` so that
 * a developer's `.env.local` can reuse one variable, which put both in the
 * live `trustedOrigins`.
 *
 * The local signal is derived from `SITE_URL` itself rather than from
 * `NODE_ENV` or a new env var: a deployment whose origins are *all* loopback is
 * a local one, because nothing else could reach it. That holds for every dev
 * shape (`http://localhost:3000`, `http://127.0.0.1:5173`, `http://[::1]:3000`,
 * and the unset default), and is false for production, which always names at
 * least one public origin. It cannot be spoofed by a lookalike host: the regex
 * is anchored to the whole origin, so `http://localhost.evil.com` and
 * `http://localhost:3000.evil.com` are not loopback.
 *
 * A local deployment keeps its loopback origins, so `bun dev` sign-in still
 * works; a non-local one loses them, so a page served from localhost can no
 * longer drive the production auth instance.
 */
export function authTrustedOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isLocal =
    origins.length > 0 &&
    origins.every((origin) => LOOPBACK_ORIGIN.test(origin));
  return isLocal ? origins : origins.filter((o) => !LOOPBACK_ORIGIN.test(o));
}

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
