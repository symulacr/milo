/**
 * RECONSTRUCTED (P8-W1-C) — tests for the durable observation writer and the
 * chain bind-verdict body. Fixture-free: explicit DB doubles, no convex-local
 * fixtures.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_FUTURE_SKEW_MS,
  MAX_OBSERVATION_AGE_MS,
  type ObservedDeployment,
  REQUIRED_ENTRYPOINTS,
} from "../packages/backend/src/admission-policy";
import { publicConstructorFingerprints } from "../packages/backend/src/public-constructor.mjs";
import {
  applyChainObservation,
  applyRecordDeployment,
  type ChainOrderRow,
  type DeploymentObservationDb,
  type StoredDeploymentRecord,
  sameDeploymentRecord,
} from "./observationIngest";

const hash = "a".repeat(64);
const NOW = 1_790_624_092_002;

function buildRecord(overrides: Partial<ObservedDeployment> = {}): ObservedDeployment {
  const base = {
    constructorVersion: 1 as const,
    constructorEncoding: "milo:compact-configuration:v1" as const,
    buyerCommitment: "1".repeat(64),
    merchantCommitment: "2".repeat(64),
    operatorCommitment: "3".repeat(64),
    id: "obs-bind-63f87489-e9b2-4996-9d84-66a4f1ded2d6",
    quoteId: "quote-b1d25e44-4b20-4ca5-8124-73bdad214163",
    quoteVersion: 1,
    observationVersion: 2 as const,
    source: "chain-observer" as const,
    network: "preprod",
    nonce: "4".repeat(64),
    address: "b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586",
    phase: "DEPLOYED" as const,
    revision: 0 as const,
    termsCommitment: hash,
    artifactFingerprint: hash,
    keySetFingerprint: hash,
    genesisHash: hash,
    entrypoints: [...REQUIRED_ENTRYPOINTS],
    maintenancePolicy: "locked" as const,
    maintenanceReceiptFingerprint: hash,
    blockHash: hash,
    blockHeight: 2_636_672,
    stateFingerprint: hash,
    observedAt: NOW,
    acceptanceDeadlineSeconds: 151,
    deliveryDeadlineSeconds: 152,
    reviewDeadlineSeconds: 153,
    resolutionDeadlineSeconds: 154,
    ...publicConstructorFingerprints({
      network: "preprod",
      nonce: "4".repeat(64),
      termsCommitment: hash,
      acceptanceDeadlineSeconds: 151,
      deliveryDeadlineSeconds: 152,
      reviewDeadlineSeconds: 153,
      resolutionDeadlineSeconds: 154,
      buyerCommitment: "1".repeat(64),
      merchantCommitment: "2".repeat(64),
      operatorCommitment: "3".repeat(64),
      constructorVersion: 1,
      constructorEncoding: "milo:compact-configuration:v1",
    }),
  };
  return { ...base, ...overrides };
}

function memoryDb() {
  const rows: StoredDeploymentRecord[] = [];
  const inserts: StoredDeploymentRecord[] = [];
  const db: DeploymentObservationDb = {
    byId: (id) => rows.find((row) => row.id === id),
    byAddress: (address) => rows.find((row) => row.address === address),
    insert: (record) => {
      rows.push(record);
      inserts.push(record);
      return record;
    },
  };
  return { db, rows, inserts };
}

describe("observationIngest:recordDeployment (production writer)", () => {
  test("fixture-free happy path stores a DEPLOYED/rev-0 record", async () => {
    const { db, rows, inserts } = memoryDb();
    const record = buildRecord();
    const result = await applyRecordDeployment(db, record, NOW);
    expect(result).toEqual({
      kind: "recorded",
      observationId: record.id,
    });
    expect(rows).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(rows[0].phase).toBe("DEPLOYED");
    expect(rows[0].revision).toBe(0);
  });

  test("exact replay is idempotent and never inserts a second row", async () => {
    const { db, rows, inserts } = memoryDb();
    const record = buildRecord();
    await applyRecordDeployment(db, record, NOW);
    const replay = await applyRecordDeployment(db, record, NOW);
    expect(replay).toEqual({ kind: "replay", observationId: record.id });
    expect(rows).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });

  test("rejects a stale observation older than the freshness window", async () => {
    const { db, inserts } = memoryDb();
    const record = buildRecord({ observedAt: NOW - MAX_OBSERVATION_AGE_MS - 1 });
    await expect(applyRecordDeployment(db, record, NOW)).rejects.toThrow(
      "stale deployment observation: record is older than the freshness window",
    );
    expect(inserts).toHaveLength(0);
  });

  test("rejects a contradictory record that would rewrite the same id", async () => {
    const { db, inserts } = memoryDb();
    const record = buildRecord();
    await applyRecordDeployment(db, record, NOW);
    await expect(
      applyRecordDeployment(db, { ...record, blockHeight: 99 }, NOW),
    ).rejects.toThrow(
      "contradictory deployment observation: record would rewrite the same id",
    );
    expect(inserts).toHaveLength(1);
  });

  test("rejects a contradictory address claim by a second observation id", async () => {
    const { db, inserts } = memoryDb();
    const record = buildRecord();
    await applyRecordDeployment(db, record, NOW);
    // Newer (or equal) second id on the same address is contradictory, not stale.
    await expect(
      applyRecordDeployment(
        db,
        buildRecord({
          id: "obs-claim-a5fb8dae-2d30-4f99-a3b0-9fc3e0ea4b1f",
          observedAt: NOW,
        }),
        NOW,
      ),
    ).rejects.toThrow(
      "contradictory deployment observation: address is already claimed by another deployment record",
    );
    expect(inserts).toHaveLength(1);
  });

  test("rejects an older record for an address that already holds a newer one", async () => {
    const { db, inserts } = memoryDb();
    const record = buildRecord({ observedAt: NOW });
    await applyRecordDeployment(db, record, NOW);
    await expect(
      applyRecordDeployment(
        db,
        buildRecord({
          id: "obs-older-claim-84bf7d12-8b60-4818-ad8c-6f2eba6f670e",
          observedAt: NOW - 1_000,
        }),
        NOW,
      ),
    ).rejects.toThrow(
      "stale deployment observation: an equal or newer record already claims this address",
    );
    expect(inserts).toHaveLength(1);
  });

  test("rejects a malformed record before any write", async () => {
    const { db, inserts } = memoryDb();
    await expect(
      applyRecordDeployment(db, { ...buildRecord(), entrypoints: [] }, NOW),
    ).rejects.toThrow("contradictory deployment observation: record is malformed");
    await expect(
      applyRecordDeployment(db, null as unknown as ObservedDeployment, NOW),
    ).rejects.toThrow("contradictory deployment observation: record is malformed");
    expect(inserts).toHaveLength(0);
  });

  test("rejects a record dated in the future", async () => {
    const { db, inserts } = memoryDb();
    await expect(
      applyRecordDeployment(
        db,
        buildRecord({ observedAt: NOW + MAX_FUTURE_SKEW_MS + 1 }),
        NOW,
      ),
    ).rejects.toThrow(
      "contradictory deployment observation: record is dated in the future",
    );
    expect(inserts).toHaveLength(0);
  });
});

describe("observationIngest freshness boundaries (Wave C edge cases)", () => {
  test("exactly at MAX_OBSERVATION_AGE_MS is still fresh; one ms past is stale", async () => {
    const atBoundary = memoryDb();
    await expect(
      applyRecordDeployment(
        atBoundary.db,
        buildRecord({ observedAt: NOW - MAX_OBSERVATION_AGE_MS }),
        NOW,
      ),
    ).resolves.toMatchObject({ kind: "recorded" });

    const past = memoryDb();
    await expect(
      applyRecordDeployment(
        past.db,
        buildRecord({ observedAt: NOW - MAX_OBSERVATION_AGE_MS - 1 }),
        NOW,
      ),
    ).rejects.toThrow("stale deployment observation");
  });

  test("exactly at MAX_FUTURE_SKEW_MS is accepted; one ms past is contradictory", async () => {
    const atBoundary = memoryDb();
    await expect(
      applyRecordDeployment(
        atBoundary.db,
        buildRecord({ observedAt: NOW + MAX_FUTURE_SKEW_MS }),
        NOW,
      ),
    ).resolves.toMatchObject({ kind: "recorded" });

    const past = memoryDb();
    await expect(
      applyRecordDeployment(
        past.db,
        buildRecord({ observedAt: NOW + MAX_FUTURE_SKEW_MS + 1 }),
        NOW,
      ),
    ).rejects.toThrow("contradictory deployment observation");
  });

  test("an equal observedAt address claim is contradictory, not stale", async () => {
    const { db } = memoryDb();
    await applyRecordDeployment(db, buildRecord(), NOW);
    await expect(
      applyRecordDeployment(
        db,
        buildRecord({ id: "obs-equal-claim-84bf7d12-8b60-4818-ad8c-6f2eba6f670e" }),
        NOW,
      ),
    ).rejects.toThrow(
      "contradictory deployment observation: address is already claimed by another deployment record",
    );
  });
});

describe("sameDeploymentRecord is field-by-field (Wave C edge cases)", () => {
  test("entrypoints order is significant; a permutation is not a replay", () => {
    const a = buildRecord() as unknown as StoredDeploymentRecord;
    const permuted = [
      a.entrypoints[1],
      a.entrypoints[0],
      ...a.entrypoints.slice(2),
    ];
    expect(
      sameDeploymentRecord(a, { ...a, entrypoints: permuted }),
    ).toBe(false);
  });

  test("a single defaulted/changed field never masquerades as a replay", () => {
    const a = buildRecord() as unknown as StoredDeploymentRecord;
    expect(sameDeploymentRecord(a, { ...a, blockHeight: a.blockHeight + 1 })).toBe(
      false,
    );
    expect(sameDeploymentRecord(a, { ...a, quoteVersion: 2 })).toBe(false);
    expect(sameDeploymentRecord(a, a)).toBe(true);
  });
});

function chainDb(order: ChainOrderRow | null, owner?: { orderId: string }) {
  const patches: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  return {
    patches,
    observations,
    db: {
      orderById: () => order ?? undefined,
      addressOwner: () => owner,
      patchOrder: (orderId: string, patch: Record<string, unknown>) => {
        patches.push({ orderId, ...patch });
      },
      insertObservation: (record: Record<string, unknown>) => {
        observations.push(record);
      },
    },
  };
}

const chainOrder: ChainOrderRow = {
  orderId: "order_1",
  address: "1".repeat(64),
  nonce: "4".repeat(64),
  artifactFingerprint: hash,
  phase: "DEPLOYED",
  revision: 0,
  deliveryManifest: null,
  terminal: false,
  merchantActive: true,
  observedAt: NOW - 1_000,
};

describe("applyChainObservation (recordObservation body, fixture-free)", () => {
  test("happy path records a forward observation and patches the order", async () => {
    const { db, patches, observations } = chainDb(chainOrder);
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toEqual({
      kind: "bind",
      phase: "RESERVED",
      revision: 1,
      orderId: "order_1",
    });
    expect(patches).toHaveLength(1);
    expect(observations).toHaveLength(1);
  });

  test("rejects a stale observation behind the recorded revision", async () => {
    const { db, patches } = chainDb({ ...chainOrder, revision: 2, phase: "ACCEPTED" });
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "stale" });
    expect(patches).toHaveLength(0);
  });

  test("rejects a contradictory observation of the admitted artifact", async () => {
    const { db, patches } = chainDb(chainOrder);
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: "b".repeat(64),
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "contradictory",
      reason: "observation does not reproduce the admitted artifact fingerprint",
    });
    expect(patches).toHaveLength(0);
  });

  test("rejects an observation that does not match the admitted order", async () => {
    const { db } = chainDb(null);
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_missing",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "contradictory" });
  });

  test("exact transaction replay is idempotent", async () => {
    const forward = {
      orderId: "order_1",
      address: chainOrder.address,
      nonce: chainOrder.nonce,
      artifactFingerprint: hash,
      phase: "RESERVED",
      revision: 1,
    };
    const first = chainDb(chainOrder);
    await applyChainObservation(first.db, forward, NOW);
    const second = chainDb({ ...chainOrder, phase: "RESERVED", revision: 1 });
    const replay = await applyChainObservation(second.db, forward, NOW);
    expect(replay).toMatchObject({ kind: "bind", phase: "RESERVED", revision: 1 });
    expect(second.patches).toHaveLength(1);
  });

  test("an unknown order id is rejected before any write", async () => {
    const { db, patches, observations } = chainDb(null);
    await applyChainObservation(
      db,
      {
        orderId: "",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(patches).toHaveLength(0);
    expect(observations).toHaveLength(0);
  });

  test("a nonce mismatch is rejected as not the admitted order", async () => {
    const { db, patches } = chainDb(chainOrder);
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: "9".repeat(64),
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "contradictory" });
    expect(patches).toHaveLength(0);
  });

  test("two orders sharing an address fail closed at the unique reverse lookup", async () => {
    const { db, patches } = chainDb(chainOrder, { orderId: "order_other" });
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "address-claimed",
      reason: "the observed address is already bound to a different order",
    });
    expect(patches).toHaveLength(0);
  });

  test("a terminal order cannot advance", async () => {
    const { db, patches } = chainDb({ ...chainOrder, terminal: true });
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "contradictory" });
    expect(patches).toHaveLength(0);
  });

  test("a delivery commitment must match the observed phase", async () => {
    const { db, patches } = chainDb(chainOrder);
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "RESERVED",
        revision: 1,
        deliveryManifest: "manifest-digest",
      },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "contradictory",
      reason: "a delivery commitment must match the observed phase",
    });
    expect(patches).toHaveLength(0);
  });

  test("ACCEPTED requires an active merchant membership", async () => {
    const { db, patches } = chainDb({ ...chainOrder, merchantActive: false });
    const result = await applyChainObservation(
      db,
      {
        orderId: "order_1",
        address: chainOrder.address,
        nonce: chainOrder.nonce,
        artifactFingerprint: hash,
        phase: "ACCEPTED",
        revision: 1,
      },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "contradictory",
      reason: "ACCEPTED requires an active merchant membership",
    });
    expect(patches).toHaveLength(0);
  });
});
