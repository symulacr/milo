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

export const readKeys = (subject: string): KeyRing =>
  parse(ringSchema, localStorage.getItem(ringKey(subject)) ?? "{}") ?? {};

export const keyFor = (subject: string, quoteId: string) =>
  readKeys(subject)[quoteId] ?? null;

export function saveKey(subject: string, key: OrderKey) {
  localStorage.setItem(
    ringKey(subject),
    JSON.stringify({ ...readKeys(subject), [key.quoteId]: key }),
  );
}

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
