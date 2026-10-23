import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { bytesToHex, HEX64, hexToBytes } from "./encoding.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const ENCODER = new TextEncoder();
const id = z.string().trim().min(1).max(256);
const digest = z.string().regex(HEX64);
const mime = z.enum(["image/png", "image/jpeg", "image/webp"]);
const size = z.number().int().positive().max(MAX_BYTES);
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
type Claimed = z.infer<typeof file>;

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
  revision: number;
  phase: "ACCEPTED" | "SUBMITTED" | "DISPUTED" | "TERMINAL";
}
export interface UploadGrant {
  id: string;
  orderId: string;
  uploaderId: string;
  expiresAt: number;
  consumed: boolean;
  storageId: string;
  inspected: {
    storageId: string;
    sha256: string;
    contentType: string;
    byteLength: number;
  };
}
export interface FrozenDeliveryFile extends Claimed {
  storageId: string;
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
  getUploadGrant(id: string): UploadGrant | undefined;
  getFrozenDelivery(orderId: string): FrozenDelivery | undefined;
  storageAttached(storageId: string): boolean;
  membershipActive(accountId: string, orderId: string): boolean;
  confirmedDeliveryMatches(delivery: FrozenDelivery): boolean;
  insertDeliveryAndConsumeGrants(delivery: FrozenDelivery): void;
}
export interface AtomicDeliveryRepository {
  transact<T>(operation: (tx: DeliveryTransaction) => T): T;
}

const validId = (v: unknown) => id.safeParse(v).success;
const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

function authorized(tx: DeliveryTransaction, orderId: string) {
  const account = tx.authenticatedAccount();
  const order = tx.getOrder(orderId);
  if (
    !account ||
    !validId(account.id) ||
    account.enabled !== true ||
    account.invited !== true ||
    !order ||
    order.id !== orderId ||
    !tx.membershipActive(account.id, orderId) ||
    order.profile !== "image-pack-v1" ||
    order.outputCount !== 3 ||
    !int(order.revision)
  )
    throw new Error("authorized order membership is required");
  return { account, order };
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
    if (!int(now)) throw new Error("invalid server clock");
    const files = request.files.map((claimed): FrozenDeliveryFile => {
      const grant = tx.getUploadGrant(claimed.grantId);
      if (
        !grant ||
        grant.id !== claimed.grantId ||
        grant.orderId !== order.id ||
        grant.uploaderId !== account.id ||
        grant.consumed ||
        !Number.isSafeInteger(grant.expiresAt) ||
        now >= grant.expiresAt ||
        !validId(grant.storageId) ||
        tx.storageAttached(grant.storageId)
      )
        throw new Error("upload grant is unavailable");
      const seen = grant.inspected;
      if (
        !seen ||
        seen.storageId !== grant.storageId ||
        seen.sha256 !== claimed.sha256 ||
        seen.contentType !== claimed.contentType ||
        seen.byteLength !== claimed.byteLength
      )
        throw new Error("stored bytes do not match the proposed manifest");
      return { ...claimed, storageId: grant.storageId };
    });
    if (
      new Set(files.map((e) => e.grantId)).size !== 3 ||
      new Set(files.map((e) => e.storageId)).size !== 3
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
      !int(delivery.revision) ||
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
    if (!selected) throw new Error("delivery is unavailable");
    const { storageId, ...claimed } = selected;
    file.parse(claimed);
    id.parse(storageId);
    return { ...selected };
  });
}

export const GRANT_TTL_MS = 5 * 60 * 1000;
export const GRANT_GRACE_MS = 60 * 60 * 1000;

export interface InspectedBytes {
  sha256: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
}

const PNG_MAGIC = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_MAGIC = Uint8Array.from([0xff, 0xd8, 0xff]);
const RIFF_MAGIC = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_MAGIC = Uint8Array.from([0x57, 0x45, 0x42, 0x50]);

function startsWith(bytes: Uint8Array, magic: Uint8Array): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

const MAGIC: [Uint8Array, InspectedBytes["contentType"]][] = [
  [PNG_MAGIC, "image/png"],
  [JPEG_MAGIC, "image/jpeg"],
];

export function inspectBytes(bytes: Uint8Array): InspectedBytes {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    throw new Error("empty file bytes");
  if (bytes.byteLength > MAX_BYTES)
    throw new Error("file exceeds the 5 MiB delivery ceiling");
  const webp =
    startsWith(bytes, RIFF_MAGIC) &&
    bytes.length >= 12 &&
    startsWith(bytes.subarray(8, 12), WEBP_MAGIC);
  const contentType =
    MAGIC.find(([magic]) => startsWith(bytes, magic))?.[1] ??
    (webp ? "image/webp" : undefined);
  if (!contentType) throw new Error("unsupported file signature");
  return {
    sha256: bytesToHex(sha256(bytes)),
    contentType,
    byteLength: bytes.byteLength,
  };
}

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
  return bytesToHex(sha256(ENCODER.encode(joined)));
}

export function deliveryCommitmentBytes32(manifest: string): Uint8Array {
  if (typeof manifest !== "string" || !HEX64.test(manifest))
    throw new Error("delivery commitment must be 64-char lowercase hex");
  return hexToBytes(manifest);
}
export function submitDeliveryArgs(
  expectedRevision: bigint | number,
  files: readonly { sha256: string }[],
): { expectedRevision: bigint; commitment: Uint8Array } {
  const revision = BigInt(expectedRevision);
  if (revision < 0n)
    throw new Error("submitDelivery revision must be a non-negative Uint<64>");
  const commitment = deliveryCommitmentBytes32(deliveryCommitment(files));
  return { expectedRevision: revision, commitment };
}

export function verifyRetrievedBytes(
  descriptor: {
    sha256: string;
    contentType: InspectedBytes["contentType"];
    byteLength: number;
  },
  bytes: Uint8Array,
): typeof descriptor {
  const actual = inspectBytes(bytes);
  const same =
    actual.sha256 === descriptor.sha256 &&
    actual.contentType === descriptor.contentType &&
    actual.byteLength === descriptor.byteLength;
  if (!same)
    throw new Error("retrieved bytes do not match the frozen descriptor");
  return { ...descriptor };
}
