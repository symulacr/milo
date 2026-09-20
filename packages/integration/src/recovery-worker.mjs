import assert from "node:assert/strict";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits, validateArtifacts } from "./artifacts.mjs";
import {
  bootstrapMaintenance,
  inspectBootstrap,
  prepareBootstrap,
  requireCompletedLockedBootstrap,
} from "./bootstrap.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { artifacts, freshOrder, generated } from "./order.mjs";
import { openBootstrapRecoveryStore } from "./recovery-store.mjs";
import { deployTx, intentExpiry } from "./tx.mjs";

let serial = 0;
const requests = new Map();
let store;
let record;
let activeStep;
const send = (message) => process.send(message);
const call = (method, fields) =>
  new Promise((resolve, reject) => {
    const id = ++serial;
    requests.set(id, { resolve, reject });
    send({ type: "call", id, method, ...fields });
  });
process.on("disconnect", () => process.exit(1));
process.on("message", (message) => {
  if (message.type === "reply") {
    const pending = requests.get(message.id);
    if (!pending) return;
    requests.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else
      pending.reject(
        new Error("Parent operation failed; pending state retained"),
      );
  } else if (message.type === "pending") {
    Promise.resolve()
      .then(async () => {
        assert(activeStep && activeStep.phase === "prepared");
        activeStep.phase = "pending";
        activeStep.identifiers = message.identifiers;
        await store.checkpoint(record);
        send({ type: "pending-ack", id: message.id });
      })
      .catch((error) => {
        send({ type: "failed", diagnostic: errorDiagnostics(error) });
        process.exit(1);
      });
  } else if (message.type === "start") {
    run(message)
      .then((result) => {
        send({ type: "done", result });
        process.disconnect();
      })
      .catch((error) => {
        send({ type: "failed", diagnostic: errorDiagnostics(error) });
        process.exit(1);
      });
  }
});

async function run({ resume, binding, directory, key, coinPublicKey }) {
  assert.equal(binding.network, "undeployed");
  assert.equal(
    (await validateArtifacts()).artifactSetSha256,
    binding.artifactSet,
  );
  store = await openBootstrapRecoveryStore({ ...binding, directory, key });
  const verifierKeys = await new NodeZkConfigProvider(
    artifacts,
  ).getVerifierKeys(proofCircuits);
  const existing = await store.read();
  if (resume) {
    assert(existing, "Missing recovery context");
    record = existing;
    assert.equal(record.coinPublicKey, coinPublicKey);
  } else {
    assert.equal(existing, null, "An existing order cannot be redeployed");
    const order = freshOrder();
    const signingKey = L.sampleSigningKey();
    const plan = prepareBootstrap({
      ...order,
      coinPublicKey,
      verifierKeys,
      signingKey,
    });
    const deployment = new L.ContractDeploy(plan.initial);
    const prepared = deployTx("undeployed", deployment);
    record = {
      ...order,
      signingKey,
      coinPublicKey,
      address: deployment.address,
      preparedDeployment: prepared.serialize(),
      steps: ["deploy", "install", "lock"].map((name) => ({
        name,
        phase: "prepared",
        identifiers: [],
        txId: null,
        txHash: null,
        blockHash: null,
        blockHeight: null,
      })),
    };
    await store.checkpoint(record);
  }
  const { configuration, privateState } = record;
  assert.equal(privateState.actor, "buyer");
  assert.deepEqual(
    generated.pureCircuits.hashTerms(
      configuration.network,
      configuration.orderNonce,
      privateState.terms,
    ),
    configuration.termsCommitment,
  );
  assert.deepEqual(
    generated.pureCircuits.hashCapability(
      configuration.network,
      configuration.orderNonce,
      generated.Role.BUYER,
      privateState.secret,
    ),
    configuration.buyerCommitment,
  );
  assert(privateState.limit >= privateState.terms.total);
  const plan = prepareBootstrap({
    configuration,
    coinPublicKey: record.coinPublicKey,
    verifierKeys,
    signingKey: record.signingKey,
  });
  const prepared = L.Transaction.deserialize(
    "signature",
    "pre-proof",
    "pre-binding",
    record.preparedDeployment,
  );
  const actions = [...prepared.intents.values()].flatMap(
    (intent) => intent.actions,
  );
  assert.equal(actions.length, 1);
  assert(actions[0] instanceof L.ContractDeploy);
  assert.equal(actions[0].address, record.address);
  inspectBootstrap(actions[0].initialState, plan, plan.initialNames, 0n, false);
  let state;
  let reconciled = 0;
  if (resume && record.steps[0].phase === "prepared")
    throw new Error("Prepared deployment requires manual reconciliation");
  for (const step of record.steps) {
    activeStep = step;
    let receipt;
    if (step.phase === "confirmed") {
      receipt = { blockHash: step.blockHash };
    } else if (step.phase === "pending") {
      receipt = await call("reconcile", {
        operation: step.name,
        address: record.address,
        identifiers: step.identifiers,
      });
      reconciled++;
    } else {
      if (step.name !== "deploy") {
        state = L.ContractState.deserialize(
          await call("observeCurrent", { address: record.address }),
        );
        inspectBootstrap(
          state,
          plan,
          step.name === "install" ? plan.initialNames : proofCircuits,
          step.name === "install" ? 0n : 1n,
          false,
        );
      }
      const tx =
        step.name === "deploy"
          ? prepared
          : bootstrapMaintenance({
              address: record.address,
              state,
              plan,
              signingKey: record.signingKey,
              networkId: "undeployed",
              ttl: intentExpiry(),
              lock: step.name === "lock",
            });
      receipt = await call("submit", {
        operation: step.name,
        address: record.address,
        bytes: tx.serialize(),
      });
    }
    const bytes = await call("observe", {
      address: record.address,
      blockHash: receipt.blockHash,
    });
    state = L.ContractState.deserialize(bytes);
    if (step.name === "lock") requireCompletedLockedBootstrap(state, plan);
    else {
      inspectBootstrap(
        state,
        plan,
        step.name === "deploy" ? plan.initialNames : proofCircuits,
        step.name === "deploy" ? 0n : 1n,
        false,
      );
      assert.throws(() => requireCompletedLockedBootstrap(state, plan));
    }
    if (step.phase !== "confirmed") {
      assert(step.identifiers.includes(receipt.txId));
      Object.assign(step, {
        phase: "confirmed",
        txId: receipt.txId,
        txHash: receipt.txHash,
        blockHash: receipt.blockHash,
        blockHeight: String(receipt.blockHeight),
      });
      await store.checkpoint(record);
    }
    await call("inspected", {
      operation: step.name,
      address: record.address,
      blockHash: receipt.blockHash,
    });
  }
  state = L.ContractState.deserialize(
    await call("observeCurrent", { address: record.address }),
  );
  requireCompletedLockedBootstrap(state, plan);
  return {
    address: record.address,
    actorCommitmentsRestored: true,
    reconciledPendingTransactions: reconciled,
    phase: "DEPLOYED",
    revision: "0",
    operationCount: 14,
    counter: "2",
    immutableOrderAdmission: false,
    reservationExecuted: false,
    r1Complete: false,
  };
}
