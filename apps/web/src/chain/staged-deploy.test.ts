import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ChainError } from "./errors";
import {
  INITIAL_VERIFIER_CIRCUITS,
  ORDER_CIRCUITS,
  type OrderCircuitName,
} from "./order";
import {
  assertAllCircuitsInstalled,
  assertVerifierKeySet,
  assertVerifierKeysMatch,
  installedCircuitsOf,
  missingCircuitsOf,
  nextMaintenanceCounter,
  runStagedDeploy,
  STAGED_DEPLOY_STEPS,
  type StagedDeployLedger,
  type StagedDeployProgress,
  type StagedDeployRecord,
  type VerifierKeySet,
} from "./staged-deploy";

const generated = new URL(
  "../../../../packages/contract/generated/keys/",
  import.meta.url,
);

const keyFor = (circuit: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`${circuit}.verifier`, generated)));

/** The circuits the second transaction installs: everything the first did not.
 * Derived here because no production code needs the list — the deploy reads the
 * missing set from observed chain state. */
const REMAINING_VERIFIER_CIRCUITS = ORDER_CIRCUITS.filter(
  (name) => !INITIAL_VERIFIER_CIRCUITS.includes(name),
);

const keys: VerifierKeySet = new Map(
  ORDER_CIRCUITS.map((circuit) => [circuit, keyFor(circuit)]),
);

const signingKey = Ledger.sampleSigningKey();
const verifyingKey = Ledger.signatureVerifyingKey(signingKey);

const stateWith = (
  circuits: readonly string[],
  counter = 0n,
  locked = false,
) => {
  const state = new Ledger.ContractState();
  state.maintenanceAuthority = new Ledger.ContractMaintenanceAuthority(
    locked ? [] : [verifyingKey],
    1,
    counter,
  );
  for (const circuit of circuits) {
    const operation = new Ledger.ContractOperation();
    operation.verifierKey = keys.get(circuit as never) as Uint8Array;
    state.setOperation(circuit, operation);
  }
  return state;
};

type Recorder = {
  readonly ledger: StagedDeployLedger;
  readonly deploys: { circuits: readonly string[] }[];
  readonly updates: {
    counter: bigint;
    circuits: readonly string[];
    lock: boolean;
  }[];
  readonly records: StagedDeployRecord[];
};

function recorder(
  options: {
    readonly initial?: readonly string[];
    readonly afterUpdate?: readonly string[];
    readonly failUpdate?: boolean;
    readonly initiallyLocked?: boolean;
    readonly afterLock?: boolean;
    readonly observeNull?: number;
  } = {},
): Recorder {
  const deploys: { circuits: readonly string[] }[] = [];
  const updates: {
    counter: bigint;
    circuits: readonly string[];
    lock: boolean;
  }[] = [];
  const records: StagedDeployRecord[] = [];
  let installed = [...(options.initial ?? INITIAL_VERIFIER_CIRCUITS)];
  let counter = options.initial ? 1n : 0n;
  let locked = options.initiallyLocked ?? false;
  let observes = 0;
  const ledger: StagedDeployLedger = {
    async deploy({ circuits }) {
      deploys.push({ circuits });
      installed = [...circuits];
      return { address: "ab".repeat(32), txId: "tx-deploy" };
    },
    async maintenance({ counter: at, circuits, lock: alsoLock }) {
      if (options.failUpdate) throw new Error("wallet rejected the update");
      updates.push({ counter: at, circuits, lock: alsoLock });
      installed = [...(options.afterUpdate ?? ORDER_CIRCUITS)];
      if (alsoLock) locked = options.afterLock ?? true;
      counter = at + 1n;
      return { txId: "tx-update" };
    },
    async observe() {
      observes += 1;
      if (options.observeNull && observes <= options.observeNull) return null;
      return { state: stateWith(installed, counter, locked) };
    },
  };
  return { ledger, deploys, updates, records };
}

const run = (
  rec: Recorder,
  overrides: Partial<Parameters<typeof runStagedDeploy>[0]> = {},
) =>
  runStagedDeploy({
    ledger: rec.ledger,
    keys,
    signingKey,
    configuration: "{}",
    resume: null,
    record: (record) => rec.records.push(record),
    wait: async () => {},
    observeRetryMs: 0,
    ...overrides,
  });

describe("the combined update is smaller than two separate transactions", () => {
  const update = (updates: Ledger.SingleUpdate[]) =>
    new Ledger.MaintenanceUpdate("ab".repeat(32) as never, updates, 0n);
  const inserts = REMAINING_VERIFIER_CIRCUITS.map(
    (circuit) =>
      new Ledger.VerifierKeyInsert(
        circuit,
        new Ledger.ContractOperationVersionedVerifierKey(
          "v3",
          keys.get(circuit) as Uint8Array,
        ),
      ),
  );
  const lock = new Ledger.ReplaceAuthority(
    new Ledger.ContractMaintenanceAuthority([], 1, 1n),
  );
  const txBytes = (maintenance: Ledger.MaintenanceUpdate) =>
    Ledger.Transaction.fromParts(
      "preprod",
      undefined,
      undefined,
      Ledger.Intent.new(new Date(Date.now() + 600_000)).addMaintenanceUpdate(
        maintenance,
      ),
    ).serialize().length;

  test("applying the combined update installs every key and locks the authority", () => {
    const combined = update([...inserts, lock]);
    expect(combined.updates.at(-1)).toBeInstanceOf(Ledger.ReplaceAuthority);
    expect(txBytes(combined)).toBeLessThan(
      txBytes(update(inserts)) + txBytes(update([lock])),
    );
    const state = stateWith(INITIAL_VERIFIER_CIRCUITS);
    let authority = new Ledger.ContractMaintenanceAuthority(
      state.maintenanceAuthority.committee,
      state.maintenanceAuthority.threshold,
      state.maintenanceAuthority.counter + 1n,
    );
    for (const entry of combined.updates) {
      if (entry instanceof Ledger.ReplaceAuthority) {
        authority = entry.authority;
        continue;
      }
      if (!(entry instanceof Ledger.VerifierKeyInsert)) continue;
      const operation = new Ledger.ContractOperation();
      operation.verifierKey = Buffer.concat([
        Buffer.from("midnight:verifier-key[v6]:"),
        Buffer.from(entry.vk.rawVk),
      ]);
      state.setOperation(entry.operation, operation);
    }
    state.maintenanceAuthority = authority;
    expect(() => assertAllCircuitsInstalled(state, keys)).not.toThrow();
    expect(state.maintenanceAuthority.committee).toEqual([]);
    expect(state.maintenanceAuthority.counter).toBe(1n);
  });
});

describe("the verifier batch plan matches the proven Preprod split", () => {
  test("the first batch is seven circuits and excludes reserve", () => {
    expect([...INITIAL_VERIFIER_CIRCUITS]).toEqual([
      "accept",
      "approve",
      "cancelReserved",
      "decline",
      "disputeBuyer",
      "disputeMerchant",
      "escalateUnreviewed",
    ]);
    expect(INITIAL_VERIFIER_CIRCUITS).not.toContain("reserve");
    expect(INITIAL_VERIFIER_CIRCUITS).toHaveLength(7);
  });

  test("the remaining batch is the other seven circuits", () => {
    expect([...REMAINING_VERIFIER_CIRCUITS]).toEqual([
      "expireBootstrap",
      "expireDispute",
      "expireReserved",
      "expireUndelivered",
      "reserve",
      "resolve",
      "submitDelivery",
    ]);
    expect(REMAINING_VERIFIER_CIRCUITS).toHaveLength(7);
  });

  test("the two batches partition all fourteen circuits in contract order", () => {
    expect([
      ...INITIAL_VERIFIER_CIRCUITS,
      ...REMAINING_VERIFIER_CIRCUITS,
    ]).toEqual([...ORDER_CIRCUITS]);
  });
});

describe("assertVerifierKeySet", () => {
  test("accepts a complete set", () => {
    expect(assertVerifierKeySet(keys)).toBe(keys);
  });

  test("refuses a set missing a circuit", () => {
    const partial = new Map(keys);
    partial.delete("reserve");
    expect(() => assertVerifierKeySet(partial)).toThrow(ChainError);
  });

  test("refuses an empty key", () => {
    const empty = new Map(keys);
    empty.set("reserve", new Uint8Array(0));
    expect(() => assertVerifierKeySet(empty)).toThrow(/missing from \/zk/);
  });
});

describe("installed and missing circuit projection", () => {
  test("reports installed circuits in contract order", () => {
    expect(
      installedCircuitsOf(["reserve", "accept", "unknown-circuit"]),
    ).toEqual(["accept", "reserve"]);
  });

  test("reports the circuits still missing", () => {
    const missing = missingCircuitsOf([...INITIAL_VERIFIER_CIRCUITS]);
    expect(missing).toEqual([...REMAINING_VERIFIER_CIRCUITS]);
  });

  test("reports nothing missing when all fourteen are installed", () => {
    expect(missingCircuitsOf([...ORDER_CIRCUITS])).toEqual([]);
  });
});

describe("confirmation gates", () => {
  test("accepts a state carrying all fourteen matching keys", () => {
    expect(() =>
      assertAllCircuitsInstalled(stateWith(ORDER_CIRCUITS), keys),
    ).not.toThrow();
  });

  test("refuses a state with seven of fourteen circuits", () => {
    expect(() =>
      assertAllCircuitsInstalled(stateWith(INITIAL_VERIFIER_CIRCUITS), keys),
    ).toThrow(/7 of 14 circuits are still missing/);
  });

  test("refuses a verifier key that differs from the compiled artifact", () => {
    const state = stateWith(ORDER_CIRCUITS);
    const operation = new Ledger.ContractOperation();
    operation.verifierKey = keyFor("accept");
    state.setOperation("reserve", operation);
    expect(() => assertAllCircuitsInstalled(state, keys)).toThrow(
      /does not match the compiled artifact/,
    );
  });

  test("refuses a circuit the contract does not expose", () => {
    const state = stateWith(ORDER_CIRCUITS);
    expect(() =>
      assertVerifierKeysMatch(state, keys, ["reserve", "notACircuit" as never]),
    ).toThrow(/does not expose/);
  });

  test("reads the maintenance counter that authorises the update", () => {
    expect(nextMaintenanceCounter(stateWith([], 3n))).toBe(3n);
  });

  test("refuses a state with no maintenance counter", () => {
    expect(() => nextMaintenanceCounter({} as never)).toThrow(ChainError);
  });

  test("refuses a negative maintenance counter", () => {
    expect(() =>
      nextMaintenanceCounter({
        maintenanceAuthority: { counter: -1n },
      } as never),
    ).toThrow(/no maintenance counter/);
  });
});

const resumeWith = (
  installedCircuits: readonly OrderCircuitName[],
): StagedDeployRecord => ({
  contractAddress: "ab".repeat(32),
  signingKey,
  configuration: "{}",
  deployedTxId: "tx-deploy",
  installedCircuits: [...installedCircuits],
  updatedAt: new Date().toISOString(),
});

describe("runStagedDeploy", () => {
  test("deploys seven keys, then installs seven and locks in one update", async () => {
    const rec = recorder();
    const result = await run(rec);

    expect(rec.deploys).toHaveLength(1);
    expect(rec.deploys[0].circuits).toEqual([...INITIAL_VERIFIER_CIRCUITS]);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].circuits).toEqual([...REMAINING_VERIFIER_CIRCUITS]);
    expect(rec.updates[0].counter).toBe(0n);
    expect(rec.updates[0].lock).toBe(true);
    expect(result.contractAddress).toBe("ab".repeat(32));
    expect(result.txId).toBe("tx-update");
    expect(result.installedCircuits).toEqual([...ORDER_CIRCUITS]);
  });

  test("emits progress for the deploy, the combined update and the confirmation", async () => {
    const rec = recorder();
    const progress: StagedDeployProgress[] = [];
    await run(rec, { onProgress: (step) => progress.push(step) });

    expect(progress.map((step) => step.stage)).toEqual([
      "deploy",
      "deploy",
      "verifiers",
      "verifiers",
      "confirm",
    ]);
    expect(progress.at(-1)).toEqual({ stage: "confirm", done: 14, total: 14 });
    expect(progress[0].total).toBe(STAGED_DEPLOY_STEPS.total);
  });

  test("records the deploy so a reload can resume", async () => {
    const rec = recorder();
    await run(rec);
    expect(rec.records).toHaveLength(2);
    expect(rec.records[0]).toMatchObject({
      contractAddress: "ab".repeat(32),
      deployedTxId: "tx-deploy",
      installedCircuits: [...INITIAL_VERIFIER_CIRCUITS],
    });
    expect(rec.records[1].installedCircuits).toEqual([...ORDER_CIRCUITS]);
  });

  // C-08: a record that claims completion before the indexer confirms makes
  // readDeployStatus report "complete" and skip the resume that would repair it.
  test("never records completion for an update the chain did not accept", async () => {
    const rec = recorder({ afterUpdate: INITIAL_VERIFIER_CIRCUITS });
    await expect(
      run(rec, { observeAttempts: 2, observeRetryMs: 0 }),
    ).rejects.toThrow(/still reports 7 circuits missing/);
    // The update was submitted but never landed, so no record may claim all 14.
    for (const record of rec.records)
      expect(record.installedCircuits.length).toBeLessThan(
        ORDER_CIRCUITS.length,
      );
  });

  // C-16: a resumed run must re-record what the chain actually reports, or the
  // persisted progress keeps showing the pre-resume state forever.
  test("a resumed run records the chain's own circuit list before the update", async () => {
    const rec = recorder({ initial: INITIAL_VERIFIER_CIRCUITS });
    await run(rec, { resume: resumeWith(INITIAL_VERIFIER_CIRCUITS) });
    // The first record of a resumed run is the repair point: it must exist.
    expect(rec.records.length).toBeGreaterThanOrEqual(2);
    expect(rec.records[0].installedCircuits).toEqual([
      ...INITIAL_VERIFIER_CIRCUITS,
    ]);
    expect(rec.records.at(-1)?.installedCircuits).toEqual([...ORDER_CIRCUITS]);
  });

  test("resumes a partial deploy without redeploying", async () => {
    const rec = recorder({ initial: INITIAL_VERIFIER_CIRCUITS });
    const result = await run(rec, {
      resume: resumeWith(INITIAL_VERIFIER_CIRCUITS),
    });

    expect(rec.deploys).toEqual([]);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].circuits).toEqual([...REMAINING_VERIFIER_CIRCUITS]);
    expect(rec.updates[0].lock).toBe(true);
    expect(result.contractAddress).toBe("ab".repeat(32));
  });

  test("locks a complete but unlocked deploy with a lock-only update", async () => {
    const rec = recorder({ initial: ORDER_CIRCUITS });
    const result = await run(rec, { resume: resumeWith(ORDER_CIRCUITS) });

    expect(rec.deploys).toEqual([]);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].circuits).toEqual([]);
    expect(rec.updates[0].lock).toBe(true);
    expect(result.installedCircuits).toEqual([...ORDER_CIRCUITS]);
  });

  test("resumes a complete and locked deploy without any transaction", async () => {
    const rec = recorder({
      initial: ORDER_CIRCUITS,
      afterUpdate: ORDER_CIRCUITS,
      initiallyLocked: true,
    });
    const result = await run(rec, { resume: resumeWith(ORDER_CIRCUITS) });

    expect(rec.deploys).toEqual([]);
    expect(rec.updates).toEqual([]);
    expect(result.installedCircuits).toEqual([...ORDER_CIRCUITS]);
  });

  test("refuses to report success when the lock never lands", async () => {
    const rec = recorder({ afterLock: false });
    await expect(
      run(rec, { observeAttempts: 2, observeRetryMs: 0 }),
    ).rejects.toThrow(/still reports an active maintenance committee/);
  });

  test("refuses to report success when the insert never lands", async () => {
    const rec = recorder({ afterUpdate: INITIAL_VERIFIER_CIRCUITS });
    await expect(
      run(rec, { observeAttempts: 2, observeRetryMs: 0 }),
    ).rejects.toThrow(/still reports 7 circuits missing/);
  });

  test("refuses to report success when the final state is short a circuit", async () => {
    const partial = ORDER_CIRCUITS.slice(0, 13);
    const rec = recorder({ afterUpdate: partial });
    await expect(run(rec)).rejects.toBeInstanceOf(ChainError);
  });

  test("surfaces a wallet rejection of the maintenance update", async () => {
    const rec = recorder({ failUpdate: true });
    await expect(run(rec)).rejects.toThrow(/wallet rejected the update/);
  });

  test("retries the observation while the indexer catches up", async () => {
    const rec = recorder({ observeNull: 2 });
    const result = await run(rec, { observeAttempts: 5, observeRetryMs: 0 });
    expect(result.installedCircuits).toEqual([...ORDER_CIRCUITS]);
  });

  test("gives up when the indexer never serves the contract", async () => {
    const rec = recorder({ observeNull: 99 });
    await expect(
      run(rec, { observeAttempts: 2, observeRetryMs: 0 }),
    ).rejects.toThrow(/No contract state was observed/);
  });

  test("resumes with the signing key recorded by the interrupted run", async () => {
    const rec = recorder({ initial: INITIAL_VERIFIER_CIRCUITS });
    const recordedSigningKey = "bb".repeat(32);
    const seen: string[] = [];
    const ledger: StagedDeployLedger = {
      ...rec.ledger,
      async maintenance(input) {
        seen.push(input.signingKey as string);
        return rec.ledger.maintenance(input);
      },
    };
    await runStagedDeploy({
      ledger,
      keys,
      signingKey: recordedSigningKey as never,
      configuration: "{}",
      resume: {
        ...resumeWith(INITIAL_VERIFIER_CIRCUITS),
        signingKey: recordedSigningKey as never,
      },
      record: () => {},
      wait: async () => {},
      observeRetryMs: 0,
    });
    expect(seen).toEqual([recordedSigningKey]);
  });
});
