import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import {
  type AtomicDeliveryRepository,
  authorizeDeliveryRead,
  type DeliveryTransaction,
  deliveryCommitment,
  freezeDelivery,
  GRANT_GRACE_MS,
  GRANT_TTL_MS,
  inspectBytes,
  type UploadGrant,
  verifyRetrievedBytes,
} from "../packages/backend/src/delivery-policy";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import type { AdmissionContext } from "./admissionContext";
import { requireMembership } from "./auth/identity";

export { GRANT_GRACE_MS, GRANT_TTL_MS };

const inspectGrantRef = makeFunctionReference<"action">(
  "files:inspectGrantAction",
);
const markInspectedRef = makeFunctionReference<"mutation">(
  "files:markInspectedMutation",
);
const bindUploadRef = makeFunctionReference<"mutation">(
  "files:bindUploadMutation",
);
const resolveReadRef = makeFunctionReference<"mutation">(
  "files:resolveReadMutation",
);

type ActionContext = {
  storage: {
    store: (bytes: Uint8Array) => Promise<string>;
    get: (
      id: string,
    ) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
  runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
};

type ContentType = "image/png" | "image/jpeg" | "image/webp";
type Inspected = {
  storageId: string;
  sha256: string;
  contentType: string;
  byteLength: number;
};
type ProposedFile = {
  grantId: string;
  sha256: string;
  contentType: string;
  byteLength: number;
};
type FileGrantRow = {
  _id: string;
  orderId: string;
  uploaderId: string;
  expiresAt: number;
  consumed: boolean;
  uploadTicket?: string;
  storageId?: string;
  inspected?: Inspected;
};
type OrderRow = {
  id: string;
  buyerId: string;
  merchantId: string;
  disputeOperatorId?: string;
  scopeId: string;
  profile: "image-pack-v1";
  outputCount: 3;
  phase: "ACCEPTED" | "SUBMITTED" | "DISPUTED" | "TERMINAL";
  revision: number;
};
type DeliveryRow = {
  orderId: string;
  merchantId: string;
  revision: number;
  files: Array<ProposedFile & { storageId: string }>;
};

const grantRow = (ctx: AdmissionContext, id: string) =>
  ctx.db.get(id as never) as Promise<FileGrantRow | null>;

const grantsForOrder = (ctx: AdmissionContext, orderId: string) =>
  ctx.db
    .query("fileGrants")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect() as Promise<FileGrantRow[]>;

const allGrants = (ctx: AdmissionContext) =>
  ctx.db.query("fileGrants").fullTableScan().collect() as Promise<
    FileGrantRow[]
  >;

const deliveryForOrder = (ctx: AdmissionContext, orderId: string) =>
  ctx.db
    .query("deliveries")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .unique() as Promise<DeliveryRow | null>;

async function loadOrder(ctx: AdmissionContext, orderId: string) {
  const order = (await ctx.db
    .query("orders")
    .withIndex("by_order", (q) => q.eq("id", orderId))
    .unique()) as OrderRow | null;
  if (!order) throw new Error("authorized order membership is required");
  return order;
}

async function requireMerchantOrder(ctx: AdmissionContext, orderId: string) {
  const order = await loadOrder(ctx, orderId);
  const membership = await requireMembership(ctx, order.scopeId);
  if (
    membership.role !== "merchant" ||
    membership.accountId !== order.merchantId
  )
    throw new Error("merchant delivery is not permitted in this phase");
  return { order, membership };
}

const orderFor = (order: OrderRow) => ({
  id: order.id,
  buyerId: order.buyerId,
  merchantId: order.merchantId,
  disputeOperatorId: order.disputeOperatorId,
  profile: order.profile,
  outputCount: order.outputCount,
  phase: order.phase,
  revision: order.revision,
});

const deliveryFor = (row: DeliveryRow) => ({
  orderId: row.orderId,
  merchantId: row.merchantId,
  revision: row.revision,
  files: row.files.map((entry) => ({
    ...entry,
    contentType: entry.contentType as ContentType,
  })),
});

function repositoryFor(
  accountId: string,
  order: OrderRow,
  rest: Omit<
    DeliveryTransaction,
    "authenticatedAccount" | "getOrder" | "membershipActive"
  >,
): AtomicDeliveryRepository {
  return {
    transact: (operation) =>
      operation({
        authenticatedAccount: () => ({
          id: accountId,
          enabled: true,
          invited: true,
        }),
        getOrder: (id) => (id === order.id ? orderFor(order) : undefined),
        membershipActive: () => true,
        ...rest,
      }),
  };
}

const liveGrant = (grant: FileGrantRow, now: number) =>
  !grant.consumed &&
  !grant.storageId &&
  Number.isSafeInteger(grant.expiresAt) &&
  now < grant.expiresAt;

export async function requestUpload(
  ctx: AdmissionContext,
  input: { orderId: string },
) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const { order } = await requireMerchantOrder(ctx, input.orderId);
  if (order.phase !== "ACCEPTED")
    throw new Error("merchant delivery is not permitted in this phase");
  const now = Date.now();
  const outstanding = (await grantsForOrder(ctx, order.id)).filter((grant) =>
    liveGrant(grant, now),
  );
  if (outstanding.length >= 3)
    throw new Error("per-user outstanding upload limit reached");
  const expiresAt = now + GRANT_TTL_MS;
  const grantId = await ctx.db.insert("fileGrants", {
    orderId: order.id,
    uploaderId: order.merchantId,
    expiresAt,
    consumed: false,
    storageId: undefined,
    inspected: undefined,
  });
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadTicket = `ut_${String(grantId)}_${String(now)}_${String(Math.random()).slice(2, 10)}`;
  await ctx.db.patch(grantId as never, { uploadTicket } as never);
  return { grantId: String(grantId), expiresAt, uploadUrl, uploadTicket };
}

async function requireUploadGrant(ctx: AdmissionContext, grantId: string) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const grant = await grantRow(ctx, grantId);
  if (!grant) throw new Error("upload grant is unavailable");
  const order = await loadOrder(ctx, grant.orderId);
  const membership = await requireMembership(ctx, order.scopeId);
  const owner =
    membership.role === "merchant" &&
    membership.accountId === order.merchantId &&
    membership.accountId === grant.uploaderId;
  if (!owner || !liveGrant(grant, Date.now()))
    throw new Error("upload grant is unavailable");
  return grant;
}

async function bindGrant(
  ctx: AdmissionContext,
  grant: FileGrantRow,
  storageId: string,
) {
  await ctx.db.patch(
    grant._id as never,
    {
      storageId,
      uploadTicket: undefined,
    } as never,
  );
  await ctx.scheduler.runAfter(0, inspectGrantRef, {
    grantId: String(grant._id),
    storageId,
  });
  return { grantId: String(grant._id), storageId };
}

export async function attachUpload(
  ctx: AdmissionContext,
  input: { grantId: string; storageId: string; uploadTicket: string },
) {
  const grant = await requireUploadGrant(ctx, input.grantId);
  if (
    typeof input.uploadTicket !== "string" ||
    input.uploadTicket.length === 0 ||
    grant.uploadTicket !== input.uploadTicket
  )
    throw new Error("upload URL provenance ticket is not valid for this grant");
  const metadata = await ctx.storage.getMetadata(input.storageId);
  if (!metadata) throw new Error("storage object is required before bind");
  const claimed = (await ctx.db
    .query("fileGrants")
    .withIndex("by_storage", (q) => q.eq("storageId", input.storageId))
    .collect()) as FileGrantRow[];
  for (const other of claimed) {
    if (other._id !== grant._id && !other.consumed)
      throw new Error("storage object is already claimed by another grant");
  }
  return bindGrant(ctx, grant, input.storageId);
}

export async function storeAndAttachUpload(
  ctx: ActionContext,
  input: { grantId: string; bytes: Uint8Array },
) {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0)
    throw new Error("upload bytes are required");
  const storageId = await ctx.storage.store(input.bytes);
  await ctx.runMutation(bindUploadRef, { grantId: input.grantId, storageId });
  return { grantId: input.grantId, storageId };
}

export async function bindUpload(
  ctx: AdmissionContext,
  input: { grantId: string; storageId: string },
) {
  const grant = await requireUploadGrant(ctx, input.grantId);
  return bindGrant(ctx, grant, input.storageId);
}

export async function markInspected(
  ctx: AdmissionContext,
  input: { grantId: string; inspected: Inspected },
) {
  const grant = await grantRow(ctx, input.grantId);
  if (!grant || grant.consumed) throw new Error("upload grant is unavailable");
  if (grant.inspected) throw new Error("grant is already inspected");
  if (grant.storageId !== input.inspected.storageId)
    throw new Error("storageId that no longer matches the grant is refused");
  await ctx.db.patch(grant._id as never, { inspected: input.inspected });
  return String(grant._id);
}

export async function inspectGrant(
  ctx: ActionContext,
  input: { grantId: string; storageId: string },
) {
  const blob = await ctx.storage.get(input.storageId);
  if (!blob) throw new Error("storage object is required");
  const inspected = inspectBytes(new Uint8Array(await blob.arrayBuffer()));
  await ctx.runMutation(markInspectedRef, {
    grantId: input.grantId,
    inspected: { storageId: input.storageId, ...inspected },
  });
  return inspected;
}

const grantFor = (grant: FileGrantRow): UploadGrant => ({
  id: String(grant._id),
  orderId: grant.orderId,
  uploaderId: grant.uploaderId,
  expiresAt: grant.expiresAt,
  consumed: grant.consumed,
  storageId: grant.storageId ?? "",
  inspected: grant.inspected as UploadGrant["inspected"],
});

export async function freeze(
  ctx: AdmissionContext,
  input: { orderId: string; files: ProposedFile[] },
) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const { order, membership } = await requireMerchantOrder(ctx, input.orderId);
  const now = Date.now();
  const existing = await deliveryForOrder(ctx, order.id);
  const attached = new Set<string>();
  for (const row of await allGrants(ctx)) {
    if (row.storageId && row.consumed) attached.add(row.storageId);
  }
  const grants = new Map(
    (await grantsForOrder(ctx, order.id)).map((grant) => [grant._id, grant]),
  );
  const repository = repositoryFor(membership.accountId, order, {
    serverNow: () => now,
    getUploadGrant: (id) => {
      const grant = grants.get(id);
      return grant ? grantFor(grant) : undefined;
    },
    getFrozenDelivery: () => (existing ? deliveryFor(existing) : undefined),
    confirmedDeliveryMatches: () => true,
    storageAttached: (storageId) => attached.has(storageId),
    insertDeliveryAndConsumeGrants: () => {},
  });
  const frozen = freezeDelivery(repository, {
    orderId: order.id,
    files: input.files.map((entry) => ({
      ...entry,
      contentType: entry.contentType as ContentType,
    })),
  });
  const manifest = deliveryCommitment(frozen.files);
  const deliveryId = await ctx.db.insert("deliveries", {
    orderId: frozen.orderId,
    merchantId: frozen.merchantId,
    revision: frozen.revision,
    files: frozen.files.map((entry) => ({ ...entry })),
    manifest,
  });
  for (const entry of frozen.files) {
    const grant = grants.get(entry.grantId);
    if (grant) await ctx.db.patch(grant._id as never, { consumed: true });
    attached.add(entry.storageId);
  }
  return { deliveryId: String(deliveryId), manifest };
}

export async function resolveRead(
  ctx: AdmissionContext,
  input: { orderId: string; fileIndex: number },
) {
  const order = await loadOrder(ctx, input.orderId);
  const membership = await requireMembership(ctx, order.scopeId);
  const chain = await ctx.db
    .query("chainOrders")
    .withIndex("by_order", (q) => q.eq("orderId", order.id))
    .unique();
  const confirmed =
    chain?.deliveryManifest !== undefined &&
    chain.deliveryManifest !== null &&
    chain.deliveryManifest.length > 0;
  const existing = await deliveryForOrder(ctx, order.id);
  const repository = repositoryFor(membership.accountId, order, {
    serverNow: () => Date.now(),
    getUploadGrant: () => undefined,
    getFrozenDelivery: () => (existing ? deliveryFor(existing) : undefined),
    confirmedDeliveryMatches: () => confirmed,
    storageAttached: () => true,
    insertDeliveryAndConsumeGrants: () => {
      throw new Error("read path is immutable");
    },
  });
  return authorizeDeliveryRead(repository, {
    orderId: input.orderId,
    fileIndex: input.fileIndex,
  });
}

export async function serveFile(
  ctx: ActionContext & {
    auth: {
      getUserIdentity: () => Promise<{
        subject?: string;
        issuer?: string;
      } | null>;
    };
  },
  input: { orderId: string; fileIndex: number },
) {
  const descriptor = (await ctx.runMutation(resolveReadRef, {
    orderId: input.orderId,
    fileIndex: input.fileIndex,
  })) as Inspected & { grantId: string };
  const blob = await ctx.storage.get(descriptor.storageId);
  if (!blob) throw new Error("delivery is unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  verifyRetrievedBytes(
    { ...descriptor, contentType: descriptor.contentType as ContentType },
    bytes,
  );
  return bytes;
}

export async function sweepGrants(ctx: AdmissionContext) {
  const cutoff = Date.now() - GRANT_TTL_MS - GRANT_GRACE_MS;
  let removed = 0;
  for (const grant of await allGrants(ctx)) {
    if (
      !grant.consumed &&
      Number.isSafeInteger(grant.expiresAt) &&
      grant.expiresAt < cutoff
    ) {
      await ctx.db.delete(grant._id as never);
      removed += 1;
    }
  }
  return { removed };
}

const digestFields = {
  sha256: v.string(),
  contentType: v.string(),
  byteLength: v.number(),
};
const inspectedV = v.object({ storageId: v.string(), ...digestFields });
const proposedV = v.object({ grantId: v.string(), ...digestFields });
const boundV = v.object({ grantId: v.string(), storageId: v.string() });
const inspectedReturn = v.object(digestFields);

export const requestUploadMutation = mutationGeneric({
  args: { orderId: v.string() },
  returns: v.object({
    grantId: v.string(),
    expiresAt: v.number(),
    uploadUrl: v.string(),
    uploadTicket: v.string(),
  }),
  handler: requestUpload as never,
});

export const attachUploadMutation = mutationGeneric({
  args: {
    grantId: v.string(),
    storageId: v.string(),
    uploadTicket: v.string(),
  },
  returns: boundV,
  handler: attachUpload as never,
});

export const storeAndAttachUploadAction = internalActionGeneric({
  args: { grantId: v.string(), bytes: v.bytes() },
  returns: boundV,
  handler: storeAndAttachUpload as never,
});

export const freezeMutation = mutationGeneric({
  args: { orderId: v.string(), files: v.array(proposedV) },
  returns: v.object({ deliveryId: v.string(), manifest: v.string() }),
  handler: freeze as never,
});

export const markInspectedMutation = internalMutationGeneric({
  args: { grantId: v.string(), inspected: inspectedV },
  returns: v.string(),
  handler: markInspected as never,
});

export const inspectGrantAction = internalActionGeneric({
  args: { grantId: v.string(), storageId: v.string() },
  returns: inspectedReturn,
  handler: inspectGrant as never,
});

export const resolveReadMutation = internalMutationGeneric({
  args: { orderId: v.string(), fileIndex: v.number() },
  returns: v.object({ grantId: v.string(), ...digestFields }),
  handler: resolveRead as never,
});

export const bindUploadMutation = internalMutationGeneric({
  args: { grantId: v.string(), storageId: v.string() },
  returns: boundV,
  handler: bindUpload as never,
});

export const serveFileAction = actionGeneric({
  args: { orderId: v.string(), fileIndex: v.number() },
  returns: v.bytes(),
  handler: serveFile as never,
});

export const sweepGrantsMutation = internalMutationGeneric({
  args: {},
  returns: v.object({ removed: v.number() }),
  handler: sweepGrants as never,
});

export default {
  requestUpload: requestUploadMutation,
  attachUpload: attachUploadMutation,
  storeAndAttach: storeAndAttachUploadAction,
  freeze: freezeMutation,
  inspect: inspectGrantAction,
  bindUpload: bindUploadMutation,
  grantForInspection: markInspectedMutation,
  markInspected: markInspectedMutation,
  resolveRead: resolveReadMutation,
  serveFile: serveFileAction,
  sweepGrants: sweepGrantsMutation,
};
