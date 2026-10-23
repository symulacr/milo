import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import {
  decideObservationBinding,
  MAX_FUTURE_SKEW_MS,
  MAX_OBSERVATION_AGE_MS,
  type ObservationBinding,
  type ObservedDeployment,
  validDeploymentObservation,
} from "../packages/backend/src/admission-policy";
import { deploymentObservationFields } from "./admissionValidators";

const recordDeploymentArgs = v.object(deploymentObservationFields);

const MISMATCH = "observation does not match the admitted order";

const RECORD_KEYS: readonly (keyof ObservedDeployment)[] = [
  "id",
  "quoteId",
  "quoteVersion",
  "constructorVersion",
  "constructorEncoding",
  "buyerCommitment",
  "merchantCommitment",
  "operatorCommitment",
  "observationVersion",
  "source",
  "network",
  "nonce",
  "address",
  "phase",
  "revision",
  "termsCommitment",
  "artifactFingerprint",
  "keySetFingerprint",
  "rolesFingerprint",
  "initialStateFingerprint",
  "genesisHash",
  "maintenancePolicy",
  "maintenanceReceiptFingerprint",
  "blockHash",
  "blockHeight",
  "stateFingerprint",
  "observedAt",
  "acceptanceDeadlineSeconds",
  "deliveryDeadlineSeconds",
  "reviewDeadlineSeconds",
  "resolutionDeadlineSeconds",
];

export type RecordDeploymentResult =
  | { kind: "recorded"; observationId: string }
  | { kind: "replay"; observationId: string };

function stale(reason: string): never {
  throw new Error(`stale deployment observation: ${reason}`);
}

function contradictory(reason: string): never {
  throw new Error(`contradictory deployment observation: ${reason}`);
}

export type StoredDeploymentRecord = ObservedDeployment;

export interface DeploymentObservationDb {
  byId(
    id: string,
  ):
    | StoredDeploymentRecord
    | undefined
    | Promise<StoredDeploymentRecord | undefined>;
  byAddress(
    address: string,
  ):
    | StoredDeploymentRecord
    | undefined
    | Promise<StoredDeploymentRecord | undefined>;
  insert(record: StoredDeploymentRecord): unknown | Promise<unknown>;
}

export function sameDeploymentRecord(
  a: StoredDeploymentRecord,
  b: StoredDeploymentRecord,
): boolean {
  for (const key of RECORD_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  if (a.entrypoints.length !== b.entrypoints.length) return false;
  for (let i = 0; i < a.entrypoints.length; i += 1) {
    if (a.entrypoints[i] !== b.entrypoints[i]) return false;
  }
  return true;
}

export async function applyRecordDeployment(
  db: DeploymentObservationDb,
  record: ObservedDeployment,
  now: number,
): Promise<RecordDeploymentResult> {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    contradictory("record is malformed");
  }
  if (!validDeploymentObservation(record)) {
    contradictory("record is malformed");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    contradictory("record is malformed");
  }
  if (record.observedAt - now > MAX_FUTURE_SKEW_MS) {
    contradictory("record is dated in the future");
  }
  if (now - record.observedAt > MAX_OBSERVATION_AGE_MS) {
    stale("record is older than the freshness window");
  }
  const existing = await db.byId(record.id);
  if (existing) {
    if (sameDeploymentRecord(existing, record as StoredDeploymentRecord)) {
      return { kind: "replay", observationId: record.id };
    }
    contradictory("record would rewrite the same id");
  }
  const claimant = await db.byAddress(record.address);
  if (claimant) {
    if (claimant.observedAt > record.observedAt) {
      stale("an equal or newer record already claims this address");
    }
    contradictory("address is already claimed by another deployment record");
  }
  await db.insert(record as StoredDeploymentRecord);
  return { kind: "recorded", observationId: record.id };
}

export interface ChainOrderRow {
  orderId: string;
  address: string;
  nonce: string;
  artifactFingerprint: string;
  phase: string;
  revision: number;
  deliveryManifest: string | null;
  terminal: boolean;
  merchantActive: boolean;
  observedAt: number | null;
}

export interface ChainObservationDb {
  orderById(
    orderId: string,
  ): ChainOrderRow | undefined | Promise<ChainOrderRow | undefined>;
  addressOwner(
    address: string,
  ): { orderId: string } | undefined | Promise<{ orderId: string } | undefined>;
  patchOrder(
    orderId: string,
    patch: Partial<ChainOrderRow>,
  ): unknown | Promise<unknown>;
  insertObservation(
    record: Record<string, unknown>,
  ): unknown | Promise<unknown>;
}

export type ChainObservationResult =
  | (Extract<ObservationBinding, { kind: "bind" }> & { orderId: string })
  | Extract<
      ObservationBinding,
      { kind: "stale" | "contradictory" | "address-claimed" }
    >;

type ChainObservedInput = {
  orderId: string;
  address: string;
  nonce: string;
  artifactFingerprint: string;
  phase: string;
  revision: number;
  deliveryManifest?: string | null;
};

const mismatch = (): ChainObservationResult => ({
  kind: "contradictory",
  reason: MISMATCH,
});

export async function applyChainObservation(
  db: ChainObservationDb,
  observed: ChainObservedInput,
  now: number,
): Promise<ChainObservationResult> {
  if (
    !observed ||
    typeof observed !== "object" ||
    typeof observed.orderId !== "string" ||
    observed.orderId.length === 0
  ) {
    return mismatch();
  }
  const order = await db.orderById(observed.orderId);
  if (!order) return mismatch();
  if (order.terminal)
    return { kind: "contradictory", reason: "a terminal order cannot advance" };
  if (order.nonce !== observed.nonce) return mismatch();
  if (observed.phase === "ACCEPTED" && !order.merchantActive)
    return {
      kind: "contradictory",
      reason: "ACCEPTED requires an active merchant membership",
    };
  if (
    observed.deliveryManifest !== undefined &&
    observed.deliveryManifest !== null &&
    observed.phase !== "SUBMITTED"
  )
    return {
      kind: "contradictory",
      reason: "a delivery commitment must match the observed phase",
    };
  const addressOwner = await db.addressOwner(observed.address);
  const verdict = decideObservationBinding(
    {
      orderId: order.orderId,
      address: order.address,
      nonce: order.nonce,
      artifactFingerprint: order.artifactFingerprint,
      phase: order.phase,
      revision: order.revision,
    },
    {
      orderId: observed.orderId,
      address: observed.address,
      nonce: observed.nonce,
      artifactFingerprint: observed.artifactFingerprint,
      phase: observed.phase,
      revision: observed.revision,
    },
    addressOwner,
  );
  if (verdict.kind !== "bind") return verdict;
  await db.patchOrder(observed.orderId, {
    phase: observed.phase,
    revision: observed.revision,
    deliveryManifest: observed.deliveryManifest ?? order.deliveryManifest,
    observedAt: now,
  });
  await db.insertObservation({
    orderId: observed.orderId,
    phase: observed.phase,
    revision: observed.revision,
    observedAt: now,
    kind: "bind",
  });
  return { ...verdict, orderId: observed.orderId };
}

export const recordDeployment = internalMutationGeneric({
  args: recordDeploymentArgs,
  returns: v.union(
    v.object({ kind: v.literal("recorded"), observationId: v.string() }),
    v.object({ kind: v.literal("replay"), observationId: v.string() }),
  ),
  handler: async (ctx, record) => {
    const db: DeploymentObservationDb = {
      async byId(id) {
        return (
          (await ctx.db
            .query("deploymentObservations")
            .withIndex("by_observation", (q) => q.eq("id", id))
            .unique()) ?? undefined
        );
      },
      async byAddress(address) {
        return (
          (await ctx.db
            .query("deploymentObservations")
            .withIndex("by_address", (q) => q.eq("address", address))
            .unique()) ?? undefined
        );
      },
      async insert(row) {
        await ctx.db.insert("deploymentObservations", row);
      },
    };
    return applyRecordDeployment(db, record, Date.now());
  },
});

export const observationIngest = {
  recordDeployment,
};
