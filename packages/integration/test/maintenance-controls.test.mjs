import assert from "node:assert/strict";
import test from "node:test";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "../src/artifacts.mjs";
import { prepareBootstrap } from "../src/bootstrap.mjs";
import {
  controlUpdate,
  runMaintenanceControls,
} from "../src/maintenance-controls.mjs";
import { artifacts, freshOrder } from "../src/order.mjs";

const verifierKeys = await new NodeZkConfigProvider(artifacts).getVerifierKeys(
  proofCircuits,
);
const fixture = () => {
  const signingKey = L.sampleSigningKey();
  const plan = prepareBootstrap({
    configuration: freshOrder().configuration,
    coinPublicKey: "00".repeat(32),
    verifierKeys,
    signingKey,
    lockCounter: 3n,
  });
  const address = new L.ContractDeploy(plan.initial).address;
  const state = L.ContractState.deserialize(plan.initial.serialize());
  for (const [name, key] of verifierKeys) {
    const op = new L.ContractOperation();
    op.verifierKey = key;
    state.setOperation(name, op);
  }
  state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
    [plan.signer],
    1,
    1n,
  );
  return { plan, signingKey, address, state, networkId: "undeployed" };
};

test("MID-T01 positive control executes ordered insertion/rotation/restoration/removal/authority updates", () => {
  const f = fixture();
  const update = controlUpdate({ ...f, counter: 1n, positive: true });
  assert.equal(update.updates.length, 7);
  assert.deepEqual(
    update.updates.map((u) => u.constructor.name),
    [
      "VerifierKeyInsert",
      "VerifierKeyRemove",
      "VerifierKeyInsert",
      "VerifierKeyRemove",
      "VerifierKeyInsert",
      "VerifierKeyRemove",
      "ReplaceAuthority",
    ],
  );
  assert.equal(update.updates[0].operation, "maintenanceCanary");
  assert.equal(update.updates[5].operation, "maintenanceCanary");
  assert.deepEqual(update.updates[6].authority.committee, [f.plan.signer]);
  assert.equal(update.updates[6].authority.counter, 2n);
  const [[index, signature]] = update.signatures;
  assert.equal(index, 0n);
  assert(L.verifySignature(f.plan.signer, update.dataToSign, signature));
  assert.throws(() =>
    controlUpdate({
      ...f,
      signingKey: L.sampleSigningKey(),
      counter: 1n,
      positive: true,
    }),
  );
});

test("MID-T01 control orchestration replays the identical signed update with fresh fee processing and refuses wrong causes", async () => {
  for (const wrongCode of [false, true]) {
    const f = fixture();
    let height = 10;
    let submits = 0;
    const updates = [];
    const events = [];
    const run = runMaintenanceControls({
      ...f,
      step: () => {},
      emit: (event, data) => events.push({ event, ...data }),
      context: () => ({ boundary: "midnightProvider.submitTx" }),
      snapshot: async () => ({
        state: f.state,
        blockHeight: ++height,
        blockHash: `block-${height}`,
      }),
      observe: async () => f.state,
      submit: async (tx) => {
        submits++;
        const update = [...tx.intents.values()][0].actions[0];
        updates.push(update);
        if (submits === 3) {
          f.state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
            [f.plan.signer],
            1,
            2n,
          );
          return { status: "SucceedEntirely", blockHash: "confirmed" };
        }
        throw Object.assign(new Error("private-error-canary"), {
          name: "RpcError",
          code: 1010,
          data: `Custom error: ${wrongCode ? 134 : 108}`,
        });
      },
    });
    if (wrongCode) {
      await assert.rejects(run, /ReplayCounterMismatch/);
      assert.equal(submits, 1);
    } else {
      const result = await run;
      assert.equal(submits, 4);
      assert.deepEqual(
        updates.map((u) => u.counter),
        [0n, 2n, 1n, 1n],
      );
      assert.deepEqual(updates[2].dataToSign, updates[3].dataToSign);
      assert.deepEqual(updates[2].signatures, updates[3].signatures);
      assert.equal(result.evidence.counterControlsVerified, 3);
      assert.equal(result.evidence.immutableOrderAdmission, false);
      assert.equal(result.state.maintenanceAuthority.counter, 2n);
    }
    assert(!JSON.stringify(events).includes("private-error-canary"));
  }
});
