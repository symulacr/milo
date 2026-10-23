import {
  type DataModelFromSchemaDefinition,
  type GenericQueryCtx,
  internalMutationGeneric,
  makeFunctionReference,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import {
  MAX_OBSERVATION_AGE_MS,
  type ObservationBinding,
} from "../packages/backend/src/admission-policy";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import { isQuoteBuyer } from "./auth/identity";
import {
  applyChainObservation,
  type ChainObservationDb,
  type ChainObservationResult,
  type ChainOrderRow,
} from "./observationIngest";
import { projectDeliveryPhase } from "./orderProjection";
import type schema from "./schema";

const openSettlementRef = makeFunctionReference<"mutation">(
  "settlement:openFromObservation",
);

type OrderReadContext = GenericQueryCtx<
  DataModelFromSchemaDefinition<typeof schema>
>;

export const recordObservationArgs = v.object({
  orderId: v.string(),
  address: v.string(),
  nonce: v.string(),
  artifactFingerprint: v.string(),
  phase: v.string(),
  revision: v.number(),
  deliveryManifest: v.optional(v.union(v.string(), v.null())),
});

const observationBinding = v.union(
  v.object({
    kind: v.literal("bind"),
    phase: v.string(),
    revision: v.number(),
    orderId: v.string(),
  }),
  v.object({ kind: v.literal("stale"), reason: v.string() }),
  v.object({ kind: v.literal("contradictory"), reason: v.string() }),
  v.object({ kind: v.literal("address-claimed"), reason: v.string() }),
);

export const orderPhase = v.union(
  v.literal("DEPLOYED"),
  v.literal("RESERVED"),
  v.literal("ACCEPTED"),
  v.literal("SUBMITTED"),
  v.literal("DISPUTED"),
  v.literal("APPROVED"),
  v.literal("CANCELLED"),
);

export const chainOrderRecord = v.object({
  orderId: v.string(),
  network: v.literal("preprod"),
  address: v.string(),
  phase: orderPhase,
  revision: v.number(),
  deliveryManifest: v.union(v.string(), v.null()),
  observedAt: v.union(v.number(), v.null()),
  fresh: v.union(v.boolean(), v.null()),
  fileCount: v.number(),
});

type ChainOrderPhase =
  | "DEPLOYED"
  | "RESERVED"
  | "ACCEPTED"
  | "SUBMITTED"
  | "DISPUTED"
  | "APPROVED"
  | "CANCELLED";

type ChainOrderDocument = Omit<ChainOrderRow, "phase"> & {
  _id: string;
  quoteId: string;
  network: "preprod";
  phase: ChainOrderPhase;
};

function toChainOrderRow(doc: ChainOrderDocument): ChainOrderRow {
  return {
    orderId: doc.orderId,
    address: doc.address,
    nonce: doc.nonce,
    artifactFingerprint: doc.artifactFingerprint,
    phase: doc.phase,
    revision: doc.revision,
    deliveryManifest: doc.deliveryManifest ?? null,
    terminal: doc.terminal,
    merchantActive: doc.merchantActive,
    observedAt: doc.observedAt ?? null,
  };
}

type ChainDbCtx = {
  db: {
    query: (table: string) => {
      withIndex: (
        name: string,
        q: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => { unique: () => Promise<unknown> };
    };
    patch: (...args: unknown[]) => Promise<unknown>;
    insert: (table: string, fields: Record<string, unknown>) => unknown;
  };
};

function findChainOrder(
  ctx: ChainDbCtx,
  index: "by_order" | "by_address",
  field: "orderId" | "address",
  value: string,
): Promise<ChainOrderDocument | null> {
  return ctx.db
    .query("chainOrders")
    .withIndex(index, (q) => q.eq(field, value))
    .unique() as Promise<ChainOrderDocument | null>;
}

function chainDb(ctx: ChainDbCtx): ChainObservationDb {
  return {
    async orderById(orderId) {
      const doc = await findChainOrder(ctx, "by_order", "orderId", orderId);
      return doc ? toChainOrderRow(doc) : undefined;
    },
    async addressOwner(address) {
      const doc = await findChainOrder(ctx, "by_address", "address", address);
      return doc ? { orderId: doc.orderId } : undefined;
    },
    async patchOrder(orderId, patch) {
      const doc = await findChainOrder(ctx, "by_order", "orderId", orderId);
      if (!doc) throw new Error("chain order disappeared mid-observation");
      await ctx.db.patch(doc._id, patch);
    },
    async insertObservation(record) {
      await ctx.db.insert("chainObservations", record);
    },
  };
}

export const recordObservation = internalMutationGeneric({
  args: recordObservationArgs,
  returns: observationBinding,
  handler: async (ctx, args): Promise<ChainObservationResult> => {
    const result = await applyChainObservation(
      chainDb(ctx as unknown as ChainDbCtx),
      {
        orderId: args.orderId,
        address: args.address,
        nonce: args.nonce,
        artifactFingerprint: args.artifactFingerprint,
        phase: args.phase,
        revision: args.revision,
        ...(args.deliveryManifest !== undefined
          ? { deliveryManifest: args.deliveryManifest }
          : {}),
      },
      Date.now(),
    );
    if (result.kind === "bind") {
      await projectDeliveryPhase(ctx, args.orderId, args.phase, args.revision);
      if (args.phase === "APPROVED" || args.phase === "CANCELLED")
        await ctx.scheduler.runAfter(0, openSettlementRef, {
          orderId: args.orderId,
        });
    }
    return result as ChainObservationResult;
  },
});

export const read = queryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(chainOrderRecord, v.null()),
  handler: async (ctx: OrderReadContext, args) => {
    const quoteId = args.quoteId.trim();
    if (!quoteId) return null;
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const quote = ((await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", quoteId))
      .unique()) ??
      (await ctx.db
        .query("approvedQuotes")
        .withIndex("by_quote", (q) => q.eq("id", quoteId))
        .unique())) as {
      scopeId: string;
      buyerAccountId: string;
    } | null;
    if (!quote) return null;
    const doc = (await ctx.db
      .query("chainOrders")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .unique()) as ChainOrderDocument | null;
    if (!doc) return null;
    const membership = (await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q.eq("privySubject", subject).eq("scopeId", quote.scopeId),
      )
      .unique()) as {
      role: "buyer" | "merchant" | "operator";
      accountId: string;
      status: "active" | "revoked";
    } | null;
    const isBuyer = isQuoteBuyer(membership, quote.buyerAccountId);
    const isMerchant =
      membership?.status === "active" && membership.role === "merchant";
    if (!isBuyer && !isMerchant) return null;
    const observedAt = doc.observedAt ?? null;
    const fresh =
      observedAt === null
        ? null
        : Date.now() - observedAt <= MAX_OBSERVATION_AGE_MS;
    const [deliveries, grants] = await Promise.all([
      ctx.db
        .query("deliveries")
        .withIndex("by_order", (q) => q.eq("orderId", doc.orderId))
        .collect(),
      ctx.db
        .query("fileGrants")
        .withIndex("by_order", (q) => q.eq("orderId", doc.orderId))
        .collect(),
    ]);
    const lastDelivery = deliveries[deliveries.length - 1] as
      | { files?: unknown[] }
      | undefined;
    const fileCount: number = lastDelivery?.files
      ? lastDelivery.files.length
      : grants.filter((g: { storageId?: string }) => !!g.storageId).length;
    return {
      orderId: doc.orderId,
      network: "preprod" as const,
      address: doc.address,
      phase: doc.phase as ChainOrderDocument["phase"],
      revision: doc.revision,
      deliveryManifest: doc.deliveryManifest ?? null,
      observedAt,
      fresh,
      fileCount,
    };
  },
});

export const orders = {
  recordObservation,
  read,
};

export type { ChainObservationResult, ObservationBinding };
