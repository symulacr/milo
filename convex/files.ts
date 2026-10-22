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

/**
 * Typed references to the sibling functions this module schedules or calls.
 * A bare string is not a registered function reference: it resolves to nothing
 * at runtime, so the scheduled work silently never runs. These names must stay
 * in step with the exports below.
 */
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

/** Action contexts have no `db`; they reach storage and delegate writes here. */
type ActionContext = {
  storage: {
    store: (bytes: Uint8Array) => Promise<string>;
    get: (
      id: string,
    ) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
  runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
};

type FileGrantRow = {
  _id: string;
  orderId: string;
  uploaderId: string;
  expiresAt: number;
  consumed: boolean;
  /** One-time ticket issued with the upload URL; consumed at attach. */
  uploadTicket?: string;
  storageId?: string;
  inspected?: {
    storageId: string;
    sha256: string;
    contentType: string;
    byteLength: number;
  };
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

/**
 * Public: issue a short-lived upload grant for an ACCEPTED merchant order.
 * The returned URL is write-only; storage identity is bound only at attachUpload.
 */
export async function requestUpload(
  ctx: AdmissionContext,
  input: { orderId: string },
) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const { order } = await requireMerchantOrder(ctx, input.orderId);
  if (order.phase !== "ACCEPTED")
    throw new Error("merchant delivery is not permitted in this phase");
  const now = Date.now();
  const outstanding = (
    (await ctx.db
      .query("fileGrants")
      .withIndex("by_order", (q) => q.eq("orderId", order.id))
      .collect()) as FileGrantRow[]
  ).filter(
    (grant) =>
      !grant.consumed &&
      !grant.storageId &&
      Number.isSafeInteger(grant.expiresAt) &&
      now < grant.expiresAt,
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
  // One-time provenance ticket: only this grant may later bind a storageId
  // from the URL path, and the ticket is destroyed on first attach.
  const uploadTicket = `ut_${String(grantId)}_${String(now)}_${String(Math.random()).slice(2, 10)}`;
  await ctx.db.patch(grantId as never, { uploadTicket } as never);
  return {
    grantId: String(grantId),
    expiresAt,
    uploadUrl,
    uploadTicket,
  };
}

/**
 * Public: bind a client-supplied storageId to an issued grant.
 * Rejects foreign/missing blobs and storage already claimed by another active
 * grant. URL→storageId provenance is closed by the one-time uploadTicket minted
 * with the upload URL (consumed on bind) and by storeAndAttachUpload (R-04),
 * which produces the storageId on the authorized action path itself.
 */
/**
 * The upload-grant authorization guard. Both upload entry points ran a byte-identical copy of
 * this 21-line check; a permission guard in two places is one that can drift, so it has one
 * definition and returns the grant the caller then consumes.
 */
async function requireUploadGrant(ctx: AdmissionContext, grantId: string) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const grant = (await ctx.db.get(grantId as never)) as FileGrantRow | null;
  if (!grant) throw new Error("upload grant is unavailable");
  const order = await loadOrder(ctx, grant.orderId);
  const membership = await requireMembership(ctx, order.scopeId);
  if (
    membership.role !== "merchant" ||
    membership.accountId !== order.merchantId ||
    membership.accountId !== grant.uploaderId
  )
    throw new Error("upload grant is unavailable");
  const now = Date.now();
  if (
    grant.consumed ||
    grant.storageId !== undefined ||
    !Number.isSafeInteger(grant.expiresAt) ||
    now >= grant.expiresAt
  )
    throw new Error("upload grant is unavailable");
  return grant;
}

export async function attachUpload(
  ctx: AdmissionContext,
  input: { grantId: string; storageId: string; uploadTicket: string },
) {
  const grant = await requireUploadGrant(ctx, input.grantId);
  // URL->storageId provenance: only the one-time ticket minted with this
  // grant's upload URL may bind a storageId. Foreign or missing tickets are
  // refused before any storage lookup.
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
  // Consume the ticket on bind so the URL path is one-shot.
  await ctx.db.patch(
    grant._id as never,
    {
      storageId: input.storageId,
      uploadTicket: undefined,
    } as never,
  );
  await ctx.scheduler.runAfter(0, inspectGrantRef, {
    grantId: String(grant._id),
    storageId: input.storageId,
  });
  return { grantId: String(grant._id), storageId: input.storageId };
}

/**
 * R-04 action-based upload: the action itself calls storage.store and binds
 * the resulting storageId to the grant in the same authorized path. There is
 * no client-supplied storageId, so upload-URL->storageId provenance is closed.
 */
export async function storeAndAttachUpload(
  ctx: ActionContext,
  input: { grantId: string; bytes: Uint8Array },
) {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0)
    throw new Error("upload bytes are required");
  // Produce the storage identity on the authorized path only.
  const storageId = await ctx.storage.store(input.bytes);
  // The grant guard, the patch and the inspect schedule are one mutation: an
  // action has no db handle, and a partial bind would strand the upload.
  await ctx.runMutation(bindUploadRef, {
    grantId: input.grantId,
    storageId,
  });
  return { grantId: input.grantId, storageId };
}

/**
 * Internal: bind an action-produced storageId to its grant and schedule the
 * byte inspection. Runs as a mutation so the guard, the patch and the
 * scheduling commit together.
 */
export async function bindUpload(
  ctx: AdmissionContext,
  input: { grantId: string; storageId: string },
) {
  const grant = await requireUploadGrant(ctx, input.grantId);
  await ctx.db.patch(
    grant._id as never,
    {
      storageId: input.storageId,
      uploadTicket: undefined,
    } as never,
  );
  await ctx.scheduler.runAfter(0, inspectGrantRef, {
    grantId: String(grant._id),
    storageId: input.storageId,
  });
  return { grantId: String(grant._id), storageId: input.storageId };
}

/** Internal: stamp witnessed bytes onto an attached unconsumed grant. */
export async function markInspected(
  ctx: AdmissionContext,
  input: {
    grantId: string;
    inspected: {
      storageId: string;
      sha256: string;
      contentType: string;
      byteLength: number;
    };
  },
) {
  const grant = (await ctx.db.get(
    input.grantId as never,
  )) as FileGrantRow | null;
  if (!grant) throw new Error("upload grant is unavailable");
  if (grant.consumed) throw new Error("upload grant is unavailable");
  if (grant.inspected) throw new Error("grant is already inspected");
  if (grant.storageId !== input.inspected.storageId)
    throw new Error("storageId that no longer matches the grant is refused");
  await ctx.db.patch(grant._id as never, {
    inspected: {
      storageId: input.inspected.storageId,
      sha256: input.inspected.sha256,
      contentType: input.inspected.contentType,
      byteLength: input.inspected.byteLength,
    },
  });
  return String(grant._id);
}

/** Internal action: witness stored bytes and stamp the grant. */
export async function inspectGrant(
  ctx: ActionContext,
  input: { grantId: string; storageId: string },
) {
  const blob = await ctx.storage.get(input.storageId);
  if (!blob) throw new Error("storage object is required");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const inspected = inspectBytes(bytes);
  // The grant guard and the stamp are a mutation; the action only witnesses bytes.
  await ctx.runMutation(markInspectedRef, {
    grantId: input.grantId,
    inspected: { storageId: input.storageId, ...inspected },
  });
  return inspected;
}

/**
 * Public freeze: pure freezeDelivery + digest-bound deliveryCommitment stored
 * on the immutable deliveries manifest. Never randomBytes.
 */
export async function freeze(
  ctx: AdmissionContext,
  input: {
    orderId: string;
    files: Array<{
      grantId: string;
      sha256: string;
      contentType: string;
      byteLength: number;
    }>;
  },
) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const { order, membership } = await requireMerchantOrder(ctx, input.orderId);
  const accountId = membership.accountId;
  const now = Date.now();
  const existing = (await ctx.db
    .query("deliveries")
    .withIndex("by_order", (q) => q.eq("orderId", order.id))
    .unique()) as {
    orderId: string;
    merchantId: string;
    revision: number;
    files: Array<{
      grantId: string;
      storageId: string;
      sha256: string;
      contentType: string;
      byteLength: number;
    }>;
  } | null;
  const attached = new Set<string>();
  for (const row of (await ctx.db
    .query("fileGrants")
    .fullTableScan()
    .collect()) as FileGrantRow[]) {
    if (row.storageId && row.consumed) attached.add(row.storageId);
  }
  const grants = new Map(
    (
      (await ctx.db
        .query("fileGrants")
        .withIndex("by_order", (q) => q.eq("orderId", order.id))
        .collect()) as FileGrantRow[]
    ).map((grant) => [grant._id, grant]),
  );
  const repository: AtomicDeliveryRepository = {
    transact: (operation) =>
      operation({
        authenticatedAccount: () => ({
          id: accountId,
          enabled: true,
          invited: true,
        }),
        serverNow: () => now,
        getOrder: (id) =>
          id === order.id
            ? {
                id: order.id,
                buyerId: order.buyerId,
                merchantId: order.merchantId,
                disputeOperatorId: order.disputeOperatorId,
                profile: order.profile,
                outputCount: order.outputCount,
                phase: order.phase,
                revision: order.revision,
              }
            : undefined,
        membershipActive: () => true,
        getUploadGrant: (id): UploadGrant | undefined => {
          const grant = grants.get(id);
          if (!grant) return undefined;
          return {
            id: String(grant._id),
            orderId: grant.orderId,
            uploaderId: grant.uploaderId,
            expiresAt: grant.expiresAt,
            consumed: grant.consumed,
            storageId: grant.storageId ?? "",
            inspected: grant.inspected as UploadGrant["inspected"],
          };
        },
        getFrozenDelivery: () =>
          existing
            ? {
                orderId: existing.orderId,
                merchantId: existing.merchantId,
                revision: existing.revision,
                files: existing.files.map((entry) => ({
                  ...entry,
                  contentType: entry.contentType as
                    | "image/png"
                    | "image/jpeg"
                    | "image/webp",
                })),
              }
            : undefined,
        confirmedDeliveryMatches: () => true,
        storageAttached: (storageId) => attached.has(storageId),
        insertDeliveryAndConsumeGrants: () => {
          // Writes are applied after the pure freeze returns.
        },
      }),
  };
  const frozen = freezeDelivery(repository, {
    orderId: order.id,
    files: input.files.map((entry) => ({
      grantId: entry.grantId,
      sha256: entry.sha256,
      contentType: entry.contentType as
        | "image/png"
        | "image/jpeg"
        | "image/webp",
      byteLength: entry.byteLength,
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

/**
 * Internal: authorize a read and return a byte-transport descriptor (never a URL).
 *
 * The account is the authenticated membership's, and the chain confirmation is
 * read from the order's own `chainOrders` row. Neither is a caller argument: a
 * caller-supplied account could name any participant, and a caller-supplied
 * confirmation flag would bypass the chain binding entirely.
 */
export async function resolveRead(
  ctx: AdmissionContext,
  input: { orderId: string; fileIndex: number },
) {
  const order = await loadOrder(ctx, input.orderId);
  const membership = await requireMembership(ctx, order.scopeId);
  const accountId = membership.accountId;
  const chain = await ctx.db
    .query("chainOrders")
    .withIndex("by_order", (q) => q.eq("orderId", order.id))
    .unique();
  const confirmed =
    chain?.deliveryManifest !== undefined &&
    chain.deliveryManifest !== null &&
    chain.deliveryManifest.length > 0;
  const existing = (await ctx.db
    .query("deliveries")
    .withIndex("by_order", (q) => q.eq("orderId", order.id))
    .unique()) as {
    orderId: string;
    merchantId: string;
    revision: number;
    files: Array<{
      grantId: string;
      storageId: string;
      sha256: string;
      contentType: "image/png" | "image/jpeg" | "image/webp";
      byteLength: number;
    }>;
  } | null;
  const repository: AtomicDeliveryRepository = {
    transact: (operation) =>
      operation({
        authenticatedAccount: () => ({
          id: accountId,
          enabled: true,
          invited: true,
        }),
        serverNow: () => Date.now(),
        getOrder: (id) =>
          id === order.id
            ? {
                id: order.id,
                buyerId: order.buyerId,
                merchantId: order.merchantId,
                disputeOperatorId: order.disputeOperatorId,
                profile: order.profile,
                outputCount: order.outputCount,
                phase: order.phase,
                revision: order.revision,
              }
            : undefined,
        membershipActive: () => true,
        getUploadGrant: () => undefined,
        getFrozenDelivery: () =>
          existing
            ? {
                orderId: existing.orderId,
                merchantId: existing.merchantId,
                revision: existing.revision,
                files: existing.files,
              }
            : undefined,
        confirmedDeliveryMatches: () => confirmed,
        storageAttached: () => true,
        insertDeliveryAndConsumeGrants: () => {
          throw new Error("read path is immutable");
        },
      }),
  };
  return authorizeDeliveryRead(repository, {
    orderId: input.orderId,
    fileIndex: input.fileIndex,
  });
}

/**
 * Public: re-authorize the caller and stream one delivered file.
 *
 * Identity comes from the verified session, never from an argument: a caller
 * that could name its own account could read any order's delivery. The
 * mutation resolves the descriptor under that identity, and the action only
 * transports the bytes it names.
 */
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
  })) as {
    grantId: string;
    storageId: string;
    sha256: string;
    contentType: "image/png" | "image/jpeg" | "image/webp";
    byteLength: number;
  };
  const blob = await ctx.storage.get(descriptor.storageId);
  if (!blob) throw new Error("delivery is unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  verifyRetrievedBytes(descriptor, bytes);
  return bytes;
}

/** Internal: drop expired unconsumed grants after TTL + grace. */
export async function sweepGrants(ctx: AdmissionContext) {
  const cutoff = Date.now() - GRANT_TTL_MS - GRANT_GRACE_MS;
  const expired = (await ctx.db
    .query("fileGrants")
    .fullTableScan()
    .collect()) as FileGrantRow[];
  let removed = 0;
  for (const grant of expired) {
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
  returns: v.object({ grantId: v.string(), storageId: v.string() }),
  handler: attachUpload as never,
});

export const storeAndAttachUploadAction = internalActionGeneric({
  args: { grantId: v.string(), bytes: v.bytes() },
  returns: v.object({ grantId: v.string(), storageId: v.string() }),
  handler: storeAndAttachUpload as never,
});

export const freezeMutation = mutationGeneric({
  args: {
    orderId: v.string(),
    files: v.array(
      v.object({
        grantId: v.string(),
        sha256: v.string(),
        contentType: v.string(),
        byteLength: v.number(),
      }),
    ),
  },
  returns: v.object({ deliveryId: v.string(), manifest: v.string() }),
  handler: freeze as never,
});

export const markInspectedMutation = internalMutationGeneric({
  args: {
    grantId: v.string(),
    inspected: v.object({
      storageId: v.string(),
      sha256: v.string(),
      contentType: v.string(),
      byteLength: v.number(),
    }),
  },
  returns: v.string(),
  handler: markInspected as never,
});

export const inspectGrantAction = internalActionGeneric({
  args: { grantId: v.string(), storageId: v.string() },
  returns: v.object({
    sha256: v.string(),
    contentType: v.string(),
    byteLength: v.number(),
  }),
  handler: inspectGrant as never,
});

export const resolveReadMutation = internalMutationGeneric({
  args: {
    orderId: v.string(),
    fileIndex: v.number(),
  },
  returns: v.object({
    grantId: v.string(),
    storageId: v.string(),
    sha256: v.string(),
    contentType: v.string(),
    byteLength: v.number(),
  }),
  handler: resolveRead as never,
});

export const bindUploadMutation = internalMutationGeneric({
  args: { grantId: v.string(), storageId: v.string() },
  returns: v.object({ grantId: v.string(), storageId: v.string() }),
  handler: bindUpload as never,
});

export const serveFileAction = actionGeneric({
  args: {
    orderId: v.string(),
    fileIndex: v.number(),
  },
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
