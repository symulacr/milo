import assert from "node:assert/strict";
import {
  ContractState as CompactState,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "./artifacts.mjs";
import { publicReceipt } from "./config.mjs";
import { generated, witnesses } from "./order.mjs";
import { deployTx, intentExpiry, maintenanceTx } from "./tx.mjs";

// Generated readers require Compact's WASM identity, not ledger-v8's.
const ledgerOf = (state) =>
  generated.ledger(CompactState.deserialize(state.serialize()).data);

const operationNames = (state) =>
  state
    .operations()
    .map((name) =>
      typeof name === "string"
        ? name
        : new TextDecoder("utf-8", { fatal: true }).decode(name),
    )
    .sort();

export function prepareBootstrap({
  configuration,
  coinPublicKey,
  verifierKeys,
  signingKey,
  lockCounter = 2n,
}) {
  assert([2n, 3n].includes(lockCounter), "Unsupported bootstrap sequence");
  assert.deepEqual(verifierKeys.map(([name]) => name).sort(), proofCircuits);
  for (const [, key] of verifierKeys)
    assert(key instanceof Uint8Array && key.length > 0);
  const context = createConstructorContext({}, coinPublicKey);
  const result = new generated.Contract(witnesses).initialState(
    context,
    configuration,
  );
  assert.deepEqual(
    result.currentZswapLocalState,
    context.initialZswapLocalState,
    "Staged bootstrap does not support constructor coin effects",
  );
  const original = L.ContractState.deserialize(
    result.currentContractState.serialize(),
  );
  assert.equal(original.balance.size, 0);
  const expectedLedger = ledgerOf(original);
  assert.equal(expectedLedger.phase, generated.Phase.DEPLOYED);
  assert.equal(expectedLedger.revision, 0n);
  const keys = new Map(
    verifierKeys.map(([name, key]) => [name, new Uint8Array(key)]),
  );
  const initialNames = proofCircuits
    .filter((name) => name !== "reserve")
    .slice(0, 7);
  const remainingNames = proofCircuits.filter(
    (name) => !initialNames.includes(name),
  );
  const signer = L.signatureVerifyingKey(signingKey);
  const initial = new L.ContractState();
  initial.data = original.data;
  initial.balance = new Map();
  initial.maintenanceAuthority = new L.ContractMaintenanceAuthority(
    [signer],
    1,
    0n,
  );
  for (const name of initialNames) {
    const operation = new L.ContractOperation();
    operation.verifierKey = keys.get(name);
    initial.setOperation(name, operation);
  }
  const plan = {
    initial,
    expectedLedger,
    keys,
    initialNames,
    remainingNames,
    signer,
    lockCounter,
  };
  inspectBootstrap(initial, plan, initialNames, 0n, false);
  return plan;
}

export function inspectBootstrap(state, plan, installedNames, counter, locked) {
  assert(state, "Missing observed bootstrap state");
  assert.deepEqual(
    ledgerOf(state),
    plan.expectedLedger,
    "Bootstrap ledger drift",
  );
  assert.equal(plan.expectedLedger.phase, generated.Phase.DEPLOYED);
  assert.equal(plan.expectedLedger.revision, 0n);
  assert.equal(state.balance.size, 0, "Unexpected bootstrap balances");
  assert.deepEqual(
    operationNames(state),
    [...installedNames].sort(),
    "Bootstrap entrypoint drift",
  );
  for (const name of installedNames) {
    assert(plan.keys.has(name), "Unknown bootstrap key");
    assert.deepEqual(
      state.operation(name).verifierKey,
      plan.keys.get(name),
      "Bootstrap verifier drift",
    );
  }
  const authority = state.maintenanceAuthority;
  assert.equal(authority.threshold, 1, "Unexpected maintenance threshold");
  assert.equal(authority.counter, counter, "Unexpected maintenance counter");
  assert.deepEqual(
    authority.committee,
    locked ? [] : [plan.signer],
    "Unexpected maintenance committee",
  );
}

export function requireCompletedLockedBootstrap(state, plan) {
  inspectBootstrap(state, plan, proofCircuits, plan.lockCounter, true);
}

export function bootstrapMaintenance({
  address,
  state,
  plan,
  signingKey,
  networkId,
  ttl,
  lock,
}) {
  assert.equal(networkId, "undeployed");
  assert.equal(
    L.signatureVerifyingKey(signingKey),
    plan.signer,
    "Wrong maintenance signer",
  );
  const counter = lock ? plan.lockCounter - 1n : 0n;
  inspectBootstrap(
    state,
    plan,
    lock ? proofCircuits : plan.initialNames,
    counter,
    false,
  );
  const updates = lock
    ? [
        new L.ReplaceAuthority(
          new L.ContractMaintenanceAuthority([], 1, counter + 1n),
        ),
      ]
    : plan.remainingNames.map(
        (name) =>
          new L.VerifierKeyInsert(
            name,
            new L.ContractOperationVersionedVerifierKey(
              "v3",
              plan.keys.get(name),
            ),
          ),
      );
  let update = new L.MaintenanceUpdate(address, updates, counter);
  update = update.addSignature(0n, L.signData(signingKey, update.dataToSign));
  return maintenanceTx(networkId, update, ttl);
}

export async function runStagedBootstrap({
  configuration,
  coinPublicKey,
  verifierKeys,
  networkId,
  submit,
  observe,
  emit,
  step,
  auditMaintenance,
  auditControls,
}) {
  assert.equal(networkId, "undeployed");
  const started = Date.now();
  const signingKey = L.sampleSigningKey();
  const plan = prepareBootstrap({
    configuration,
    coinPublicKey,
    verifierKeys,
    signingKey,
    lockCounter: auditControls ? 3n : 2n,
  });
  const deployment = new L.ContractDeploy(plan.initial);
  const address = deployment.address;
  emit("staged-bootstrap-planned", {
    address,
    initialOperationCount: 7,
    finalOperationCount: 14,
    reservationEntrypointInitiallyAvailable: false,
    immutableOrderAdmission: false,
  });
  const ttl = intentExpiry;
  const sendAndObserve = async (name, unprovenTx) => {
    step(name);
    const receipt = publicReceipt(await submit(unprovenTx));
    const state = await observe(address, receipt.blockHash);
    emit("staged-bootstrap-transaction-finalized", {
      stage: name,
      address,
      ...receipt,
    });
    return state;
  };
  let state = await sendAndObserve(
    "MID-T01-staged-deploy",
    deployTx(networkId, deployment, ttl()),
  );
  inspectBootstrap(state, plan, plan.initialNames, 0n, false);
  assert.throws(() => requireCompletedLockedBootstrap(state, plan));
  emit("staged-bootstrap-inspected", {
    operationCount: 7,
    counter: "0",
    locked: false,
    completionGuardRejects: true,
  });

  state = await sendAndObserve(
    "MID-T01-staged-install",
    bootstrapMaintenance({
      address,
      state,
      plan,
      signingKey,
      networkId,
      ttl: ttl(),
      lock: false,
    }),
  );
  inspectBootstrap(state, plan, proofCircuits, 1n, false);
  assert.throws(() => requireCompletedLockedBootstrap(state, plan));
  emit("staged-bootstrap-inspected", {
    operationCount: 14,
    counter: "1",
    locked: false,
    completionGuardRejects: true,
  });

  let maintenanceControls;
  let replayUpdate;
  if (auditControls) {
    const result = await auditControls({
      address,
      state,
      plan,
      signingKey,
      networkId,
    });
    state = result.state;
    maintenanceControls = result.evidence;
    replayUpdate = result.replayUpdate;
    inspectBootstrap(state, plan, proofCircuits, 2n, false);
  }
  state = await sendAndObserve(
    "MID-T01-staged-lock",
    bootstrapMaintenance({
      address,
      state,
      plan,
      signingKey,
      networkId,
      ttl: ttl(),
      lock: true,
    }),
  );
  requireCompletedLockedBootstrap(state, plan);
  const elapsedMs = Date.now() - started;
  let maintenanceAudit;
  if (auditMaintenance) {
    maintenanceAudit = await auditMaintenance({
      address,
      state,
      plan,
      signingKey,
      networkId,
      replayUpdate,
    });
  }
  return {
    address,
    elapsedMs,
    submissionCount: 3,
    operationCount: 14,
    phase: "DEPLOYED",
    revision: "0",
    counter: plan.lockCounter.toString(),
    maintenanceLockObserved: true,
    immutableOrderAdmission: false,
    adversarialMaintenanceRejectionVerified:
      maintenanceAudit?.authorityRejectionVerified === true,
    ...(maintenanceAudit ? { maintenanceAudit } : {}),
    ...(maintenanceControls ? { maintenanceControls } : {}),
    canonicalQuoteBinding: false,
    reservationExecuted: false,
    r1Complete: false,
  };
}
