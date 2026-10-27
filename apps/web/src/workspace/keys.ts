import { z } from "zod";

const ITERATIONS = 310_000;
const FORMAT = "milo-order-keys";
const ringKey = (subject: string) => `milo:order-keys:${subject}`;

// A backup file is user-supplied input. Validate it before it reaches the key
// ring, so a hostile file cannot inject an actor or a non-hex secret.
const hex = z.string().regex(/^[0-9a-f]+$/i);
const keySchema = z.object({
  quoteId: z.string().min(1),
  actor: z.enum(["buyer", "merchant", "operator"]),
  secret: hex,
  nonce: hex,
});
const ringSchema = z.record(z.string(), keySchema);
const fileSchema = z.object({
  format: z.literal(FORMAT),
  kdf: z.object({ salt: hex }),
  iv: hex,
  data: hex,
});

export type OrderKey = z.infer<typeof keySchema>;

type KeyRing = Record<string, OrderKey>;

const NOT_A_BACKUP = "This file is not a Milo key backup.";

/** Validate raw JSON text; malformed JSON and a wrong shape are one failure. */
const parse = <T>(schema: z.ZodType<T>, text: string): T | null => {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    return null;
  }
};

export const toHex = (bytes: Uint8Array) => bytes.toHex();

/**
 * Native parsing rejects an odd-length string instead of silently dropping the
 * last nibble, which matters because a backup file is user-supplied input.
 */
export const fromHex = (hex: string) => Uint8Array.fromHex(hex);

export const randomHex = (length = 32) =>
  toHex(crypto.getRandomValues(new Uint8Array(length)));

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array) {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  );
}

export const readKeys = (subject: string): KeyRing => {
  // The legacy single-entry ring first, then every per-order entry, which wins
  // because it is the newer format.
  const legacy =
    parse(ringSchema, localStorage.getItem(ringKey(subject)) ?? "{}") ?? {};
  const prefix = `${ringKey(subject)}:`;
  const ring: KeyRing = { ...legacy };
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index);
    if (!name?.startsWith(prefix)) continue;
    const one = parse(keySchema, localStorage.getItem(name) ?? "");
    if (one) ring[one.quoteId] = one;
  }
  return ring;
};

export const keyFor = (subject: string, quoteId: string) =>
  readKeys(subject)[quoteId] ?? null;

/**
 * One storage entry per order, not one entry for the whole ring.
 *
 * `localStorage` has no atomic read-modify-write. With a single ring entry, two
 * tabs saving at the same moment each spread a snapshot taken before the other's
 * key existed, so the later write deletes the earlier key — and the order key is
 * the only thing that can sign for that order, so the loss is permanent.
 *
 * Writing each key under its own storage key removes the race by construction:
 * two tabs saving *different* orders never touch the same entry, so neither can
 * erase the other. No lock, no retry, nothing to detect. `navigator.locks` would
 * also work but is absent in older Safari and in this project's test runtime, so
 * a lock-based fix could not be proven here.
 *
 * The old single-entry ring is still read, so a browser that saved keys before
 * this change keeps them.
 */
const keyEntry = (subject: string, quoteId: string) =>
  `${ringKey(subject)}:${quoteId}`;

export function saveKey(subject: string, key: OrderKey) {
  localStorage.setItem(keyEntry(subject, key.quoteId), JSON.stringify(key));
}

/**
 * The invite token, carried across a sign-in.
 *
 * The studio's email IS a magic link whose callback is the full invite path, so
 * the first hop needs no help. But that link is single-use and short-lived, and
 * when it is burned or expires the buyer lands on the invite URL signed out. The
 * shell then renders the sign-in form *instead of* the order route, and the form
 * builds its callback from `location.pathname` — and a pathname has no query
 * string, so the token would be dropped and the buyer could never reopen the
 * order. Every retry repeats the loss.
 *
 * Why `localStorage` and not `sessionStorage`: a magic link is normally clicked
 * from a mail client, which opens a **new tab**, and `sessionStorage` is
 * per-tab — the stash would be empty exactly where it is needed. Why not the
 * callback URL: D-01, that is what put the token in the mail provider's logs.
 *
 * What makes a persisted copy safe is that the token is not a bearer credential
 * on its own. `orders.invite` admits a non-member only when the signed-in
 * email equals the invited address (`convex/orders.ts`), and the token is
 * single-use and rotated on claim. A copy left in a shared browser is therefore
 * useless without the invited account, and is cleared as soon as it is spent.
 *
 * Keyed by quote id, so one order's token can never be offered to another.
 */
const inviteStash = (quoteId: string) => `milo:invite:${quoteId}`;

export const stashInvite = (quoteId: string, token: string) => {
  try {
    if (quoteId) localStorage.setItem(inviteStash(quoteId), token);
  } catch {
    // Storage disabled: the first hop, which the studio's email carries, still
    // works. Only the resend path degrades.
  }
};

/** The token stashed for *this* order, or null. Never another order's. */
export const stashedInvite = (quoteId: string): string | null => {
  try {
    return localStorage.getItem(inviteStash(quoteId)) || null;
  } catch {
    return null;
  }
};

export const clearInvite = (quoteId: string) => {
  try {
    localStorage.removeItem(inviteStash(quoteId));
  } catch {
    // Nothing to clear.
  }
};

async function derive(password: string, salt: Uint8Array) {
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
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seal an arbitrary payload into the backup envelope. */
export async function sealBackup(payload: unknown, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await derive(password, salt),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const file = {
    format: FORMAT,
    version: 1,
    kdf: { name: "PBKDF2-SHA256", iterations: ITERATIONS, salt: toHex(salt) },
    iv: toHex(iv),
    data: toHex(new Uint8Array(sealed)),
  };
  return JSON.stringify(file);
}

export async function backupBlob(subject: string, password: string) {
  const text = await sealBackup(readKeys(subject), password);
  return new Blob([text], { type: "application/json" });
}

export async function restoreBackup(
  subject: string,
  text: string,
  password: string,
) {
  const body = parse(fileSchema, text);
  if (!body) throw new Error(NOT_A_BACKUP);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromHex(body.iv) },
      await derive(password, fromHex(body.kdf.salt)),
      fromHex(body.data),
    );
  } catch {
    throw new Error("The password is not correct.");
  }
  const restored = parse(ringSchema, new TextDecoder().decode(plain));
  if (!restored) throw new Error(NOT_A_BACKUP);
  for (const key of Object.values(restored)) saveKey(subject, key);
  return Object.keys(restored).length;
}
