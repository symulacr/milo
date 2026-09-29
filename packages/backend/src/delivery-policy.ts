import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const mime = z.enum(["image/png", "image/jpeg", "image/webp"]);
const size = z
  .number()
  .int()
  .positive()
  .max(5 * 1024 * 1024);
const file = z.strictObject({
  grantId: id,
  sha256: digest,
  contentType: mime,
  byteLength: size,
});
const submission = z.strictObject({
  orderId: id,
  files: z.array(file).length(3),
});
const readRequest = z.strictObject({
  orderId: id,
  fileIndex: z.number().int().min(0).max(2),
});

export interface DeliveryAccount {
  id: string;
  enabled: boolean;
  invited: boolean;
}
export interface DeliveryOrder {
  id: string;
  buyerId: string;
  merchantId: string;
  disputeOperatorId?: string;
  profile: "image-pack-v1";
  outputCount: 3;
  phase: "ACCEPTED" | "SUBMITTED" | "DISPUTED" | "TERMINAL";
  revision: number;
}
export interface UploadGrant {
  id: string;
  orderId: string;
  uploaderId: string;
  expiresAt: number;
  consumed: boolean;
  storageId: string;
  // Written only by the internal action that inspects actual stored bytes.
  inspected: {
    storageId: string;
    sha256: string;
    contentType: string;
    byteLength: number;
  };
}
export interface FrozenDeliveryFile {
  grantId: string;
  storageId: string;
  sha256: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
}
export interface FrozenDelivery {
  orderId: string;
  merchantId: string;
  revision: number;
  files: readonly FrozenDeliveryFile[];
}
export interface DeliveryTransaction {
  authenticatedAccount(): DeliveryAccount | undefined;
  serverNow(): number;
  getOrder(id: string): DeliveryOrder | undefined;
  membershipActive(accountId: string, orderId: string): boolean;
  getUploadGrant(id: string): UploadGrant | undefined;
  getFrozenDelivery(orderId: string): FrozenDelivery | undefined;
  confirmedDeliveryMatches(delivery: FrozenDelivery): boolean;
  storageAttached(storageId: string): boolean;
  insertDeliveryAndConsumeGrants(delivery: FrozenDelivery): void;
}
/** All reads and grant consumption must share one Convex mutation. */
export interface AtomicDeliveryRepository {
  transact<T>(operation: (tx: DeliveryTransaction) => T): T;
}

export function freezeDelivery(
  repository: AtomicDeliveryRepository,
  input: unknown,
): FrozenDelivery {
  const request = submission.parse(input);
  return repository.transact((tx) => {
    const { account, order } = authorized(tx, request.orderId);
    if (account.id !== order.merchantId || order.phase !== "ACCEPTED")
      throw new Error("merchant delivery is not permitted in this phase");
    if (tx.getFrozenDelivery(order.id))
      throw new Error("delivery is immutable once frozen");
    const now = tx.serverNow();
    if (!Number.isSafeInteger(now) || now < 0)
      throw new Error("invalid server clock");
    const files = request.files.map((claimed: z.infer<typeof file>): FrozenDeliveryFile => {
      const grant = tx.getUploadGrant(claimed.grantId);
      if (
        !grant ||
        grant.id !== claimed.grantId ||
        grant.orderId !== order.id ||
        grant.uploaderId !== account.id ||
        grant.consumed ||
        !Number.isSafeInteger(grant.expiresAt) ||
        now >= grant.expiresAt ||
        !id.safeParse(grant.storageId).success ||
        tx.storageAttached(grant.storageId)
      )
        throw new Error("upload grant is unavailable");
      const actual = grant.inspected;
      if (
        !actual ||
        actual.storageId !== grant.storageId ||
        actual.sha256 !== claimed.sha256 ||
        actual.contentType !== claimed.contentType ||
        actual.byteLength !== claimed.byteLength
      )
        throw new Error("stored bytes do not match the proposed manifest");
      return { ...claimed, storageId: grant.storageId };
    });
    if (
      new Set(files.map((entry: FrozenDeliveryFile) => entry.grantId)).size !== 3 ||
      new Set(files.map((entry: FrozenDeliveryFile) => entry.storageId)).size !== 3
    )
      throw new Error(
        "delivery files require distinct grants and storage objects",
      );
    const delivery = {
      orderId: order.id,
      merchantId: account.id,
      revision: order.revision,
      files,
    };
    tx.insertDeliveryAndConsumeGrants(structuredClone(delivery));
    return delivery;
  });
}

/** Internal byte-transport descriptor, never a browser response or bearer URL. */
export function authorizeDeliveryRead(
  repository: AtomicDeliveryRepository,
  input: unknown,
): FrozenDeliveryFile {
  const request = readRequest.parse(input);
  return repository.transact((tx) => {
    const { account, order } = authorized(tx, request.orderId);
    if (
      account.id !== order.buyerId &&
      account.id !== order.merchantId &&
      !(order.phase === "DISPUTED" && account.id === order.disputeOperatorId)
    )
      throw new Error("delivery access is not permitted");
    const delivery = tx.getFrozenDelivery(order.id);
    if (
      !delivery ||
      delivery.orderId !== order.id ||
      delivery.merchantId !== order.merchantId ||
      !Number.isSafeInteger(delivery.revision) ||
      delivery.revision < 0 ||
      delivery.revision > order.revision ||
      delivery.files.length !== 3
    )
      throw new Error("delivery is unavailable");
    if (
      account.id !== order.merchantId &&
      !tx.confirmedDeliveryMatches(delivery)
    )
      throw new Error(
        "delivery is not bound to the confirmed chain submission",
      );
    const selected = delivery.files[request.fileIndex];
    file.parse({
      grantId: selected.grantId,
      sha256: selected.sha256,
      contentType: selected.contentType,
      byteLength: selected.byteLength,
    });
    id.parse(selected.storageId);
    return { ...selected };
  });
}

function authorized(tx: DeliveryTransaction, orderId: string) {
  const account = tx.authenticatedAccount();
  const order = tx.getOrder(orderId);
  if (
    !account ||
    !id.safeParse(account.id).success ||
    account.enabled !== true ||
    account.invited !== true ||
    !order ||
    order.id !== orderId ||
    !tx.membershipActive(account.id, orderId) ||
    order.profile !== "image-pack-v1" ||
    order.outputCount !== 3 ||
    !Number.isSafeInteger(order.revision) ||
    order.revision < 0
  )
    throw new Error("authorized order membership is required");
  return { account, order };
}

/** Short-lived upload grant window; grace covers orphaned-blob cleanup only. */
export const GRANT_TTL_MS = 5 * 60 * 1000;
export const GRANT_GRACE_MS = 60 * 60 * 1000;

export interface InspectedBytes {
  sha256: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
}

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Uint8Array.from([0xff, 0xd8, 0xff]);
const RIFF_MAGIC = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_MAGIC = Uint8Array.from([0x57, 0x45, 0x42, 0x50]);

function startsWith(bytes: Uint8Array, magic: Uint8Array): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/**
 * Witnessed-byte inspection: magic-byte PNG/JPEG/WebP, ≤5 MiB, SHA-256 of raw
 * bytes. Never trusts a client-declared MIME or digest.
 */
export function inspectBytes(bytes: Uint8Array): InspectedBytes {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    throw new Error("empty file bytes");
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("file exceeds the 5 MiB delivery ceiling");
  let contentType: InspectedBytes["contentType"];
  if (startsWith(bytes, PNG_MAGIC)) contentType = "image/png";
  else if (startsWith(bytes, JPEG_MAGIC)) contentType = "image/jpeg";
  else if (
    startsWith(bytes, RIFF_MAGIC) &&
    bytes.length >= 12 &&
    startsWith(bytes.subarray(8, 12), WEBP_MAGIC)
  )
    contentType = "image/webp";
  else throw new Error("unsupported file signature");
  return {
    sha256: bytesToHex(sha256(bytes)),
    contentType,
    byteLength: bytes.byteLength,
  };
}

/**
 * Digest-bound delivery commitment.
 *
 * deliveryCommitment(files) = SHA-256( hex(f0.sha256) || hex(f1.sha256) || hex(f2.sha256) )
 *
 * Each `f.sha256` is the lowercase 64-hex SHA-256 of that file's raw bytes (as
 * produced by inspectBytes). The join is plain string concatenation of the three
 * hex digests (192 ASCII chars), then one SHA-256 over those bytes. Flat
 * merkle-style commitment: order-sensitive, exactly 3 leaves, reproducible from
 * the frozen manifest alone. Output is 64-char lowercase hex.
 *
 * Never use randomBytes for a delivery commitment.
 */
export function deliveryCommitment(
  files: readonly { sha256: string }[],
): string {
  if (!Array.isArray(files) || files.length !== 3)
    throw new Error("delivery commitment requires exactly three file digests");
  const joined = files
    .map((entry) => {
      const parsed = digest.safeParse(entry?.sha256);
      if (!parsed.success) throw new Error("invalid file digest");
      return parsed.data;
    })
    .join("");
  return bytesToHex(sha256(new TextEncoder().encode(joined)));
}

/** Per-serve re-check of retrieved bytes against the frozen inspected descriptor. */
export function verifyRetrievedBytes(
  descriptor: {
    sha256: string;
    contentType: InspectedBytes["contentType"];
    byteLength: number;
  },
  bytes: Uint8Array,
): typeof descriptor {
  const actual = inspectBytes(bytes);
  if (
    actual.sha256 !== descriptor.sha256 ||
    actual.contentType !== descriptor.contentType ||
    actual.byteLength !== descriptor.byteLength
  )
    throw new Error("retrieved bytes do not match the frozen descriptor");
  return { ...descriptor };
}
