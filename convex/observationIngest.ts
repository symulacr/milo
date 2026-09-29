/**
 * RECONSTRUCTED (P8-W1-C) — durable deployment-observation writer.
 *
 * `observationIngest:recordDeployment` writes `deploymentObservations` and
 * never invents a row. Verdicts mirror the shared bind/stale/contradictory/
 * address-claimed vocabulary:
 *
 * - recorded  — inserted
 * - replay    — exact content match on the same id (idempotent, no second row)
 * - stale     — older than the freshness window, or older than a record that
 *               already claims the same address
 * - contradictory — malformed, future-dated, same id with different content,
 *               or address claimed by another id
 *
 * Validation reuses `validDeploymentObservation` from admission-policy. The
 * chain bind-verdict kernel `decideObservationBinding` lives there too; this
 * module holds the DB-facing `applyChainObservation` body used by
 * `orders:recordObservation`.
 *
 * Labels: local Convex RUNTIME evidence is not a hosted-provider row.
 */

import { internalMutationGeneric } from "convex/server";
import { type Infer, v } from "convex/values";
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
export type RecordDeploymentInput = Infer<typeof recordDeploymentArgs>;

export type RecordDeploymentResult =
  | { kind: "recorded"; observationId: string }
  | { kind: "replay"; observationId: string };

/** Throws `stale deployment observation: …`. */
function stale(reason: string): never {
  throw new Error(`stale deployment observation: ${reason}`);
}

/** Throws `contradictory deployment observation: …`. */
function contradictory(reason: string): never {
  throw new Error(`contradictory deployment observation: ${reason}`);
}

export interface StoredDeploymentRecord {
  id: string;
  quoteId: string;
  quoteVersion: number;
  constructorVersion: 1;
  constructorEncoding: string;
  buyerCommitment: string;
  merchantCommitment: string;
  operatorCommitment: string;
  observationVersion: 2;
  source: "chain-observer";
  network: string;
  nonce: string;
  address: string;
  phase: "DEPLOYED";
  revision: 0;
  termsCommitment: string;
  artifactFingerprint: string;
  keySetFingerprint: string;
  rolesFingerprint: string;
  initialStateFingerprint: string;
  genesisHash: string;
  entrypoints: readonly string[];
  maintenancePolicy: "locked";
  maintenanceReceiptFingerprint: string;
  blockHash: string;
  blockHeight: number;
  stateFingerprint: string;
  observedAt: number;
  acceptanceDeadlineSeconds: number;
  deliveryDeadlineSeconds: number;
  reviewDeadlineSeconds: number;
  resolutionDeadlineSeconds: number;
}

export interface DeploymentObservationDb {
  byId(id: string): StoredDeploymentRecord | undefined | Promise<StoredDeploymentRecord | undefined>;
  byAddress(
    address: string,
  ): StoredDeploymentRecord | undefined | Promise<StoredDeploymentRecord | undefined>;
  insert(record: StoredDeploymentRecord): unknown | Promise<unknown>;
}

/**
 * Field-by-field equality. `entrypoints` order is significant — a permutation
 * is not a replay. A single defaulted/changed field never masquerades as one.
 */
export function sameDeploymentRecord(
  a: StoredDeploymentRecord,
  b: StoredDeploymentRecord,
): boolean {
  const keys: (keyof StoredDeploymentRecord)[] = [
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
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  if (a.entrypoints.length !== b.entrypoints.length) return false;
  for (let i = 0; i < a.entrypoints.length; i += 1) {
    if (a.entrypoints[i] !== b.entrypoints[i]) return false;
  }
  return true;
}

/**
 * Durable writer body. Fixture-free: talks to the injected observation store.
 * Throws on stale / contradictory; never inserts on those paths.
 */
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
    // Equal observedAt is contradictory, not stale. An older claimant also
    // rejects: the address is already spoken for by another observation id.
    contradictory("address is already claimed by another deployment record");
  }
  await db.insert(record as StoredDeploymentRecord);
  return { kind: "recorded", observationId: record.id };
}

/**
 * Chain observation body behind `orders:recordObservation`. Applies the
 * shared bind-verdict kernel and patches the order only on `kind === "bind"`.
 */
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
  patchOrder(orderId: string, patch: Partial<ChainOrderRow>): unknown | Promise<unknown>;
  insertObservation(record: Record<string, unknown>): unknown | Promise<unknown>;
}

export type ChainObservationResult =
  | Extract<ObservationBinding, { kind: "bind" }> & { orderId: string }
  | Extract<ObservationBinding, { kind: "stale" | "contradictory" | "address-claimed" }>;

const TERMINAL_PHASES = new Set(["APPROVED", "CANCELLED"]);

/**
 * Fixture-free chain writer body. Unknown orders, nonce mismatches, terminal
 * orders, and phase/commitment mismatches fail closed before any write.
 */
export async function applyChainObservation(
  db: ChainObservationDb,
  observed: {
    orderId: string;
    address: string;
    nonce: string;
    artifactFingerprint: string;
    phase: string;
    revision: number;
    deliveryManifest?: string | null;
  },
  now: number,
): Promise<ChainObservationResult> {
  if (
    !observed ||
    typeof observed !== "object" ||
    typeof observed.orderId !== "string" ||
    observed.orderId.length === 0
  ) {
    return {
      kind: "contradictory",
      reason: "observation does not match the admitted order",
    };
  }
  const order = await db.orderById(observed.orderId);
  if (!order) {
    return {
      kind: "contradictory",
      reason: "observation does not match the admitted order",
    };
  }
  if (order.terminal) {
    return {
      kind: "contradictory",
      reason: "a terminal order cannot advance",
    };
  }
  if (order.nonce !== observed.nonce) {
    return {
      kind: "contradictory",
      reason: "observation does not match the admitted order",
    };
  }
  if (observed.phase === "ACCEPTED" && !order.merchantActive) {
    return {
      kind: "contradictory",
      reason: "ACCEPTED requires an active merchant membership",
    };
  }
  if (
    observed.deliveryManifest !== undefined &&
    observed.deliveryManifest !== null &&
    observed.phase !== "SUBMITTED"
  ) {
    return {
      kind: "contradictory",
      reason: "a delivery commitment must match the observed phase",
    };
  }
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

/**
 * Production handler. Args are exactly `deploymentObservationFields` — no
 * second field list. Internal: only operator/CLI ingest may call it.
 */
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
