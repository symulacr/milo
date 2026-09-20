import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "./artifacts.mjs";
import { inspectBootstrap } from "./bootstrap.mjs";
import { publicReceipt } from "./config.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { maintenanceTx } from "./tx.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function controlUpdate({
  address,
  plan,
  signingKey,
  counter,
  positive,
}) {
  assert.equal(L.signatureVerifyingKey(signingKey), plan.signer);
  assert([0n, 1n, 2n].includes(counter));
  const insert = (name, source) =>
    new L.VerifierKeyInsert(
      name,
      new L.ContractOperationVersionedVerifierKey("v3", plan.keys.get(source)),
    );
  const remove = (name) =>
    new L.VerifierKeyRemove(name, new L.ContractOperationVersion("v3"));
  const authority = new L.ReplaceAuthority(
    new L.ContractMaintenanceAuthority([plan.signer], 1, counter + 1n),
  );
  const updates = positive
    ? [
        insert("maintenanceCanary", "accept"),
        remove("reserve"),
        insert("reserve", "accept"),
        remove("reserve"),
        insert("reserve", "reserve"),
        remove("maintenanceCanary"),
        authority,
      ]
    : [authority];
  let update = new L.MaintenanceUpdate(address, updates, counter);
  const signature = L.signData(signingKey, update.dataToSign);
  assert(L.verifySignature(plan.signer, update.dataToSign, signature));
  update = update.addSignature(0n, signature);
  return update;
}

export async function runMaintenanceControls({
  address,
  state,
  plan,
  signingKey,
  networkId,
  submit,
  observe,
  snapshot,
  context,
  inspectFailure,
  emit,
  step,
}) {
  assert.equal(networkId, "undeployed");
  assert.equal(plan.lockCounter, 3n);
  inspectBootstrap(state, plan, proofCircuits, 1n, false);
  const reject = async (kind, update, expectedCounter) => {
    step(`MID-T01-control-${kind}`);
    const before = await snapshot(address);
    inspectBootstrap(before.state, plan, proofCircuits, expectedCounter, false);
    const stateSha256 = hash(before.state.serialize());
    emit("maintenance-control-proposal", {
      kind,
      address,
      observedCounter: expectedCounter.toString(),
      signedCounter: update.counter.toString(),
      signedUpdateSha256: hash(update.dataToSign),
    });
    let failure;
    let boundary;
    let finalized;
    try {
      finalized = await submit(maintenanceTx(networkId, update));
    } catch (error) {
      failure = errorDiagnostics(error);
      boundary = context().boundary;
    }
    let rejection;
    if (finalized) {
      assert(
        ["FailEntirely", "FailFallible"].includes(finalized.status),
        "Counter control unexpectedly succeeded",
      );
    } else {
      assert(failure, "Missing control outcome");
      emit("maintenance-control-failed", {
        kind,
        boundary,
        ...failure,
        counterRejectionVerified: false,
      });
      assert(
        boundary === "midnightProvider.submitTx" &&
          failure.errorNames.includes("RpcError") &&
          failure.rpcCodes?.length === 1 &&
          failure.rpcCodes[0] === 1010,
        "Inconclusive control or unknown submission outcome",
      );
      assert.deepEqual(
        failure.runtimeCustomCodes,
        [108],
        "Expected exact ReplayCounterMismatch",
      );
      rejection = {
        rejectionBoundary: "rpc",
        runtimeCustomCodes: [108],
        conclusion: "ReplayCounterMismatch",
      };
    }
    const after = await snapshot(
      address,
      Math.max(before.blockHeight, (finalized?.blockHeight ?? 0) - 1),
    );
    assert(after.blockHeight > before.blockHeight);
    assert.notEqual(after.blockHash, before.blockHash);
    inspectBootstrap(after.state, plan, proofCircuits, expectedCounter, false);
    assert.equal(hash(after.state.serialize()), stateSha256);
    if (finalized) {
      rejection = await inspectFailure(finalized);
      assert.equal(rejection.conclusion, "ReplayCounterMismatch");
      emit("maintenance-control-finalized-failure", {
        kind,
        status: finalized.status,
        txId: finalized.txId,
        txHash: finalized.txHash,
        ...rejection,
      });
    }
    emit("maintenance-counter-rejection-observed", {
      kind,
      address,
      signedUpdateSha256: hash(update.dataToSign),
      signedCounter: update.counter.toString(),
      observedCounter: expectedCounter.toString(),
      beforeBlockHash: before.blockHash,
      afterBlockHash: after.blockHash,
      beforeBlockHeight: before.blockHeight,
      afterBlockHeight: after.blockHeight,
      stateSha256,
      unchanged: true,
      ...rejection,
    });
  };
  const inputs = { address, plan, signingKey };
  await reject(
    "stale-counter",
    controlUpdate({ ...inputs, counter: 0n, positive: false }),
    1n,
  );
  await reject(
    "future-counter",
    controlUpdate({ ...inputs, counter: 2n, positive: false }),
    1n,
  );
  const positive = controlUpdate({ ...inputs, counter: 1n, positive: true });
  step("MID-T01-control-positive-batch");
  const receipt = publicReceipt(
    await submit(maintenanceTx(networkId, positive)),
  );
  const result = await observe(address, receipt.blockHash);
  inspectBootstrap(result, plan, proofCircuits, 2n, false);
  emit("maintenance-positive-control-finalized", {
    address,
    ...receipt,
    updateCount: 7,
    operationsRestored: true,
    counter: "2",
    signedUpdateSha256: hash(positive.dataToSign),
    immutableOrderAdmission: false,
  });
  // Rebalance the identical signed maintenance payload; do not reuse spent fee inputs.
  await reject("signed-update-replay", positive, 2n);
  return {
    state: result,
    replayUpdate: positive,
    evidence: {
      positiveBatchFinalized: true,
      updateCount: 7,
      counterControlsVerified: 3,
      signedMaintenanceReplayVerified: true,
      immutableOrderAdmission: false,
      reservationExecuted: false,
    },
  };
}
