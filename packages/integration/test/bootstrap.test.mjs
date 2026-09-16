import assert from "node:assert/strict";
import test from "node:test";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "../src/artifacts.mjs";
import {
  bootstrapMaintenance,
  inspectBootstrap,
  prepareBootstrap,
  requireCompletedLockedBootstrap,
  runStagedBootstrap,
} from "../src/bootstrap.mjs";
import { artifacts, freshOrder, generated } from "../src/order.mjs";

const verifierKeys = await new NodeZkConfigProvider(artifacts).getVerifierKeys(
  proofCircuits,
);
const make = () => {
  const signingKey = L.sampleSigningKey();
  const configuration = freshOrder().configuration;
  const plan = prepareBootstrap({
    configuration,
    coinPublicKey: "00".repeat(32),
    verifierKeys,
    signingKey,
  });
  return { signingKey, configuration, plan };
};
const stateFor = (
  plan,
  names = proofCircuits,
  counter = 1n,
  locked = false,
) => {
  const state = new L.ContractState();
  state.data = plan.initial.data;
  state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
    locked ? [] : [plan.signer],
    1,
    counter,
  );
  for (const name of names) {
    const op = new L.ContractOperation();
    op.verifierKey = plan.keys.get(name);
    state.setOperation(name, op);
  }
  return state;
};
const actionOf = (tx) => {
  assert.equal(tx.intents.size, 1);
  const actions = [...tx.intents.values()][0].actions;
  assert.equal(actions.length, 1);
  return actions[0];
};

test("MID-T01 staged preparation preserves original ledger and all final keys, withholding reserve initially", () => {
  const { plan } = make();
  assert.equal(plan.keys.size, 14);
  assert.equal(plan.initialNames.length, 7);
  assert.equal(plan.remainingNames.length, 7);
  assert(!plan.initialNames.includes("reserve"));
  assert(plan.remainingNames.includes("reserve"));
  assert.deepEqual(
    [...plan.initialNames, ...plan.remainingNames].sort(),
    proofCircuits,
  );
  inspectBootstrap(plan.initial, plan, plan.initialNames, 0n, false);
  assert.throws(() => requireCompletedLockedBootstrap(plan.initial, plan));
  assert.throws(() => requireCompletedLockedBootstrap(stateFor(plan), plan));
  requireCompletedLockedBootstrap(
    stateFor(plan, proofCircuits, 2n, true),
    plan,
  );
  assert.equal(
    generated.ledger(CompactState.deserialize(plan.initial.serialize()).data)
      .phase,
    generated.Phase.DEPLOYED,
  );
  assert.equal(
    generated.ledger(CompactState.deserialize(plan.initial.serialize()).data)
      .revision,
    0n,
  );
});

test("MID-T01 bootstrap rejects missing/extra/wrong keys, ledger substitution and false locks", () => {
  const { plan, signingKey, configuration } = make();
  const args = { configuration, signingKey, coinPublicKey: "00".repeat(32) };
  assert.throws(() =>
    prepareBootstrap({ ...args, verifierKeys: verifierKeys.slice(1) }),
  );
  assert.throws(() =>
    prepareBootstrap({
      ...args,
      verifierKeys: [...verifierKeys, verifierKeys[0]],
    }),
  );
  const bad = stateFor(plan, proofCircuits.slice(1), 2n, true);
  assert.throws(() => requireCompletedLockedBootstrap(bad, plan));
  const extra = stateFor(plan, proofCircuits, 2n, true);
  extra.setOperation("shadow", extra.operation("accept"));
  assert.throws(() => requireCompletedLockedBootstrap(extra, plan));
  const wrong = stateFor(plan, proofCircuits, 2n, true);
  wrong.setOperation("reserve", wrong.operation("accept"));
  assert.throws(() => requireCompletedLockedBootstrap(wrong, plan));
  const substituted = stateFor(plan, proofCircuits, 2n, true);
  substituted.data = make().plan.initial.data;
  assert.throws(() => requireCompletedLockedBootstrap(substituted, plan));
  const funded = stateFor(plan, proofCircuits, 2n, true);
  funded.balance = new Map([[L.unshieldedToken(), 1n]]);
  assert.throws(() => requireCompletedLockedBootstrap(funded, plan));
  for (const authority of [
    new L.ContractMaintenanceAuthority([], 0, 2n),
    new L.ContractMaintenanceAuthority([plan.signer], 1, 2n),
    new L.ContractMaintenanceAuthority([], 1, 1n),
  ]) {
    const state = stateFor(plan, proofCircuits, 2n, true);
    state.maintenanceAuthority = authority;
    assert.throws(() => requireCompletedLockedBootstrap(state, plan));
  }
});

test("MID-T01 signed insertion/lock builders bind exact keys, address, counter and signer", () => {
  const { plan, signingKey } = make();
  const address = new L.ContractDeploy(plan.initial).address;
  const args = {
    address,
    plan,
    signingKey,
    networkId: "undeployed",
    ttl: new Date(Date.now() + 600_000),
  };
  const insertion = actionOf(
    bootstrapMaintenance({ ...args, state: plan.initial, lock: false }),
  );
  assert(insertion instanceof L.MaintenanceUpdate);
  assert.equal(insertion.address, address);
  assert.equal(insertion.counter, 0n);
  assert.equal(insertion.updates.length, 7);
  assert.deepEqual(
    insertion.updates.map((u) => u.operation).sort(),
    [...plan.remainingNames].sort(),
  );
  for (const update of insertion.updates) {
    assert(update instanceof L.VerifierKeyInsert);
    assert.equal(update.vk.version, "v3");
    assert.deepEqual(
      update.vk.rawVk,
      new L.ContractOperationVersionedVerifierKey(
        "v3",
        plan.keys.get(update.operation),
      ).rawVk,
    );
  }
  const [[index, signature]] = insertion.signatures;
  assert.equal(index, 0n);
  assert(L.verifySignature(plan.signer, insertion.dataToSign, signature));
  assert(
    !L.verifySignature(
      L.signatureVerifyingKey(L.sampleSigningKey()),
      insertion.dataToSign,
      signature,
    ),
  );
  const replay = new L.MaintenanceUpdate(address, insertion.updates, 1n);
  assert(!L.verifySignature(plan.signer, replay.dataToSign, signature));
  const locked = actionOf(
    bootstrapMaintenance({ ...args, state: stateFor(plan), lock: true }),
  );
  assert.equal(locked.counter, 1n);
  assert.equal(locked.updates.length, 1);
  assert(locked.updates[0] instanceof L.ReplaceAuthority);
  assert.deepEqual(locked.updates[0].authority.committee, []);
  assert.equal(locked.updates[0].authority.threshold, 1);
  assert.equal(locked.updates[0].authority.counter, 2n);
  assert.throws(() =>
    bootstrapMaintenance({ ...args, state: plan.initial, lock: true }),
  );
  assert.throws(() =>
    bootstrapMaintenance({ ...args, state: stateFor(plan), lock: false }),
  );
  assert.throws(() =>
    bootstrapMaintenance({
      ...args,
      state: plan.initial,
      lock: false,
      signingKey: L.sampleSigningKey(),
    }),
  );
  assert.throws(() =>
    bootstrapMaintenance({
      ...args,
      state: stateFor(plan, proofCircuits, 2n, true),
      lock: true,
    }),
  );
});

async function transportFixture({
  failSend,
  failObserve,
  tamperInstall = false,
} = {}) {
  let state;
  let address;
  let sends = 0;
  const actions = [];
  const events = [];
  const run = runStagedBootstrap({
    configuration: freshOrder().configuration,
    coinPublicKey: "00".repeat(32),
    verifierKeys,
    networkId: "undeployed",
    step: () => {},
    emit: (event, fields) => events.push({ event, ...fields }),
    submit: async (tx) => {
      sends++;
      if (sends === failSend) throw new Error("outcome unknown");
      const action = actionOf(tx);
      actions.push(action);
      // Transport fixture only: real ledger application is verified by the native run.
      if (action instanceof L.ContractDeploy) {
        assert.equal(sends, 1);
        address = action.address;
        state = L.ContractState.deserialize(action.initialState.serialize());
      } else {
        assert(action instanceof L.MaintenanceUpdate);
        assert.equal(action.address, address);
        for (const update of action.updates) {
          if (update instanceof L.VerifierKeyInsert) {
            const op = new L.ContractOperation();
            const artifact = verifierKeys.find(
              ([name]) => name === update.operation,
            )[1];
            // The versioned getter omits the serialization header; installed keys retain it.
            assert.deepEqual(
              update.vk.rawVk,
              new L.ContractOperationVersionedVerifierKey("v3", artifact).rawVk,
            );
            op.verifierKey = artifact;
            state.setOperation(update.operation, op);
          } else {
            assert(update instanceof L.ReplaceAuthority);
            state.maintenanceAuthority = update.authority;
          }
        }
        if (sends === 2) {
          state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
            state.maintenanceAuthority.committee,
            1,
            1n,
          );
          if (tamperInstall)
            state.setOperation("shadow", state.operation("accept"));
        }
      }
      return {
        status: "SucceedEntirely",
        txId: `test-${sends}`,
        txHash: "fixture",
        blockHash: `block-${sends}`,
        blockHeight: sends,
      };
    },
    observe: async (observedAddress, blockHash) => {
      assert.equal(observedAddress, address);
      assert.equal(blockHash, `block-${sends}`);
      if (sends === failObserve) return undefined;
      return state;
    },
  });
  return { run, sends: () => sends, actions, events };
}

test("MID-T01 staged orchestration observes every step, uses one address and never invokes reservation", async () => {
  const fixture = await transportFixture();
  const result = await fixture.run;
  assert.equal(fixture.sends(), 3);
  assert.equal(result.operationCount, 14);
  assert.equal(result.phase, "DEPLOYED");
  assert.equal(result.reservationExecuted, false);
  assert.equal(result.immutableOrderAdmission, false);
  assert.equal(result.adversarialMaintenanceRejectionVerified, false);
  assert.equal(result.r1Complete, false);
  assert.equal(
    fixture.events.filter((e) => e.completionGuardRejects).length,
    2,
  );
});

test("MID-T01 interruption/unknown/tampering stops staged bootstrap without retry or premature lock", async () => {
  for (const failed of [1, 2, 3]) {
    for (const option of ["failSend", "failObserve"]) {
      const fixture = await transportFixture({ [option]: failed });
      await assert.rejects(fixture.run);
      assert.equal(fixture.sends(), failed);
    }
  }
  const tampered = await transportFixture({ tamperInstall: true });
  await assert.rejects(tampered.run);
  assert.equal(tampered.sends(), 2);
});
