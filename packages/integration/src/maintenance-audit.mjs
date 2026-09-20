import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { requireCompletedLockedBootstrap } from "./bootstrap.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { intentExpiry, maintenanceTx } from "./tx.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const maintenanceCases = Object.freeze([
  "insert-verifier",
  "replace-verifier",
  "remove-verifier",
  "restore-authority",
]);

export function retainedKeyProposal({
  kind,
  address,
  state,
  plan,
  signingKey,
  networkId,
  ttl,
  counterDelta = 0n,
}) {
  assert.equal(networkId, "undeployed");
  requireCompletedLockedBootstrap(state, plan);
  assert.equal(L.signatureVerifyingKey(signingKey), plan.signer);
  assert(maintenanceCases.includes(kind), "Unknown maintenance probe");
  assert([-1n, 0n, 1n].includes(counterDelta));
  const counter = state.maintenanceAuthority.counter;
  const updates = {
    "insert-verifier": () => [
      new L.VerifierKeyInsert(
        "maintenanceCanary",
        new L.ContractOperationVersionedVerifierKey(
          "v3",
          plan.keys.get("accept"),
        ),
      ),
    ],
    "replace-verifier": () => [
      new L.VerifierKeyRemove("reserve", new L.ContractOperationVersion("v3")),
      new L.VerifierKeyInsert(
        "reserve",
        new L.ContractOperationVersionedVerifierKey(
          "v3",
          plan.keys.get("accept"),
        ),
      ),
    ],
    "remove-verifier": () => [
      new L.VerifierKeyRemove("reserve", new L.ContractOperationVersion("v3")),
    ],
    "restore-authority": () => [
      new L.ReplaceAuthority(
        new L.ContractMaintenanceAuthority(
          [plan.signer],
          1,
          counter + counterDelta + 1n,
        ),
      ),
    ],
  }[kind]();
  let update = new L.MaintenanceUpdate(
    address,
    updates,
    counter + counterDelta,
  );
  const signature = L.signData(signingKey, update.dataToSign);
  assert(L.verifySignature(plan.signer, update.dataToSign, signature));
  update = update.addSignature(0n, signature);
  return maintenanceTx(networkId, update, ttl);
}

export async function observeFinalizedContract({
  rpc,
  indexer,
  observe,
  address,
  afterHeight = -1,
  deadline,
  request = fetch,
  wait = delay,
  now = Date.now,
}) {
  let blockHash;
  let blockHeight;
  while (now() < deadline) {
    blockHash = await rpc("chain_getFinalizedHead", []);
    assert.match(blockHash, /^0x[0-9a-f]{64}$/);
    const header = await rpc("chain_getHeader", [blockHash]);
    assert.match(header.number, /^0x[0-9a-f]+$/);
    blockHeight = Number(BigInt(header.number));
    assert(Number.isSafeInteger(blockHeight));
    if (blockHeight > afterHeight) break;
    await wait(250);
  }
  assert(blockHeight > afterHeight, "No later finalized block before deadline");
  while (now() < deadline) {
    const response = await request(indexer, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query { block(offset: {height: ${blockHeight}}) { height hash } }`,
      }),
    });
    assert(response.ok);
    const indexed = await response.json();
    assert.equal(indexed.errors, undefined);
    if (indexed.data?.block) {
      assert.equal(indexed.data.block.height, blockHeight);
      assert.equal(
        indexed.data.block.hash.replace(/^0x/, ""),
        blockHash.slice(2),
      );
      // Indexer contractAction offsets select actions, not arbitrary as-of state.
      const encoded = await rpc("midnight_contractState", [address, blockHash]);
      assert(typeof encoded === "string" && encoded.length <= 2_097_152);
      assert.match(encoded, /^(?:[0-9a-f]{2})+$/);
      const state = L.ContractState.deserialize(Buffer.from(encoded, "hex"));
      const indexedState = await observe(address);
      assert(indexedState, "Missing latest indexed contract state");
      assert.deepEqual(
        state.serialize(),
        indexedState.serialize(),
        "Node/indexer contract state mismatch",
      );
      return { state, blockHash, blockHeight };
    }
    await wait(250);
  }
  throw new Error("Indexed observation deadline exceeded");
}

/**
 * The single construction point for audit-case transactions. The replay case
 * wraps the signed update itself; nesting a Transaction where an update
 * belongs produced a silently-invalid transaction (intents undefined), so
 * this helper is the shape gate's test subject.
 */
export function auditCaseTx({
  kind,
  replayUpdate,
  address,
  state,
  plan,
  signingKey,
  networkId,
}) {
  return kind === "locked-signed-update-replay"
    ? maintenanceTx(networkId, replayUpdate)
    : retainedKeyProposal({
        kind: kind.startsWith("locked-") ? "restore-authority" : kind,
        counterDelta:
          kind === "locked-stale-counter"
            ? -1n
            : kind === "locked-future-counter"
              ? 1n
              : 0n,
        address,
        state,
        plan,
        signingKey,
        networkId,
        ttl: intentExpiry(),
      });
}

export async function runRetainedKeyAudit({
  address,
  state,
  plan,
  signingKey,
  networkId,
  submit,
  snapshot,
  context,
  emit,
  step,
  replayUpdate,
}) {
  requireCompletedLockedBootstrap(state, plan);
  const expectedStateHash = hash(state.serialize());
  const started = Date.now();
  const results = [];
  const cases = [
    ...maintenanceCases,
    ...(replayUpdate
      ? [
          "locked-stale-counter",
          "locked-future-counter",
          "locked-signed-update-replay",
        ]
      : []),
  ];
  for (const kind of cases) {
    step(`MID-T01-attack-${kind}`);
    const before = await snapshot(address);
    requireCompletedLockedBootstrap(before.state, plan);
    assert.equal(hash(before.state.serialize()), expectedStateHash);
    const tx = auditCaseTx({
      kind,
      replayUpdate,
      address,
      state: before.state,
      plan,
      signingKey,
      networkId,
    });
    emit("maintenance-proposal-constructed", {
      kind,
      address,
      counter: state.maintenanceAuthority.counter.toString(),
      signedCounter: [...tx.intents.values()][0].actions[0].counter.toString(),
      signedUpdateSha256: hash(
        [...tx.intents.values()][0].actions[0].dataToSign,
      ),
      retainedSignerVerified: true,
      stateSha256: expectedStateHash,
    });
    let diagnostic;
    let failureBoundary;
    try {
      await submit(tx);
    } catch (error) {
      diagnostic = errorDiagnostics(error);
      failureBoundary = context().boundary;
    }
    if (!diagnostic) {
      emit("maintenance-audit-unexpected-submission-success", {
        kind,
        authorityRejectionVerified: false,
      });
      throw new Error("Locked maintenance was not rejected");
    }
    emit("maintenance-attempt-failed", {
      kind,
      boundary: failureBoundary,
      ...diagnostic,
      authorityRejectionVerified: false,
    });
    if (
      failureBoundary !== "midnightProvider.submitTx" ||
      diagnostic.rpcCodes?.length !== 1 ||
      diagnostic.rpcCodes[0] !== 1010 ||
      !diagnostic.errorNames.includes("RpcError")
    ) {
      throw new Error(
        "Maintenance audit stopped at inconclusive pre-submit or unknown outcome",
      );
    }
    const after = await snapshot(address, before.blockHeight);
    assert(after.blockHeight > before.blockHeight);
    assert.notEqual(after.blockHash, before.blockHash);
    requireCompletedLockedBootstrap(after.state, plan);
    assert.equal(hash(after.state.serialize()), expectedStateHash);
    // node-1.0.0 ledger/types: Malformed(KeyNotInCommittee) -> Custom(134).
    const authorityRejected =
      diagnostic.runtimeCustomCodes?.length === 1 &&
      diagnostic.runtimeCustomCodes[0] === 134;
    const result = {
      kind,
      beforeBlockHash: before.blockHash,
      afterBlockHash: after.blockHash,
      beforeBlockHeight: before.blockHeight,
      afterBlockHeight: after.blockHeight,
      stateSha256: expectedStateHash,
      unchanged: true,
      ...diagnostic,
      authorityRejectionVerified: authorityRejected,
      conclusion: authorityRejected
        ? "KeyNotInCommittee"
        : "node-rejected-cause-unresolved",
    };
    emit("maintenance-node-rejection-observed", result);
    if (!authorityRejected)
      throw new Error(
        "Authority-specific node rejection evidence is not yet established",
      );
    results.push(result);
  }
  return {
    elapsedMs: Date.now() - started,
    retainedKeyCasesVerified: results.length,
    nodeRejectedSubmissions: results.length,
    requiredCases: cases.length,
    authorityRejectionVerified: true,
    replayCounterControlsVerified: Boolean(replayUpdate),
    postLockCounterCasesVerified: replayUpdate ? 3 : 0,
    immutableOrderAdmission: false,
    reservationExecuted: false,
  };
}
