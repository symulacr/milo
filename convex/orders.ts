/**
 * Chain-backed order projection writer and reader.
 *
 * `orders:recordObservation` is the A1 chain ingest half behind the
 * `observationIngest → chainObservations → orders` path. The bind/patch body
 * is `applyChainObservation` (fixture-free, fail-closed). This module only
 * wires that body to Convex storage and exposes the read-model projection
 * the console is allowed to show.
 *
 * Labels: local Convex RUNTIME evidence is not a hosted-provider row.
 */

import { internalMutationGeneric, queryGeneric } from "convex/server";
import { type Infer, v } from "convex/values";
import {
  MAX_OBSERVATION_AGE_MS,
  type ObservationBinding,
} from "../packages/backend/src/admission-policy";
import {
  applyChainObservation,
  type ChainObservationDb,
  type ChainObservationResult,
  type ChainOrderRow,
} from "./observationIngest";

export const recordObservationArgs = v.object({
  orderId: v.string(),
  address: v.string(),
  nonce: v.string(),
  artifactFingerprint: v.string(),
  phase: v.string(),
  revision: v.number(),
  deliveryManifest: v.optional(v.union(v.string(), v.null())),
});
export type RecordObservationInput = Infer<typeof recordObservationArgs>;

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

type ChainObservationDocument = {
  _id: string;
  orderId: string;
  phase: string;
  revision: number;
  observedAt: number;
  kind: string;
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

function chainDb(ctx: ChainDbCtx): ChainObservationDb {
  return {
    async orderById(orderId) {
      const doc = (await ctx.db
        .query("chainOrders")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .unique()) as ChainOrderDocument | null;
      return doc ? toChainOrderRow(doc) : undefined;
    },
    async addressOwner(address) {
      const doc = (await ctx.db
        .query("chainOrders")
        .withIndex("by_address", (q) => q.eq("address", address))
        .unique()) as ChainOrderDocument | null;
      return doc ? { orderId: doc.orderId } : undefined;
    },
    async patchOrder(orderId, patch) {
      const doc = (await ctx.db
        .query("chainOrders")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .unique()) as ChainOrderDocument | null;
      if (!doc) throw new Error("chain order disappeared mid-observation");
      await ctx.db.patch(doc._id, patch);
    },
    async insertObservation(record) {
      await ctx.db.insert("chainObservations", record);
    },
  };
}

/**
 * Durable chain-observation writer. Throws only on programmer error after
 * `applyChainObservation` already failed closed; the verdict is returned.
 */
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
    return result as ChainObservationResult;
  },
});

/**
 * Read-model projection for the console. A phase is present only when a
 * backing `chainOrders` row exists; missing quote or missing order is null.
 */
export const read = queryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(chainOrderRecord, v.null()),
  handler: async (ctx, args) => {
    const quoteId = args.quoteId.trim();
    if (!quoteId) return null;
    const doc = (await ctx.db
      .query("chainOrders")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .unique()) as ChainOrderDocument | null;
    if (!doc) return null;
    const observedAt = doc.observedAt ?? null;
    const fresh =
      observedAt === null
        ? null
        : Date.now() - observedAt <= MAX_OBSERVATION_AGE_MS;
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_order", (q) => q.eq("orderId", doc.orderId))
      .collect();
    const grants = await ctx.db
      .query("fileGrants")
      .withIndex("by_order", (q) => q.eq("orderId", doc.orderId))
      .collect();
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
