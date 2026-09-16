import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { publicReceipt } from "./config.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";

const operations = ["deploy", "install", "lock"];
const checkedIdentifiers = (identifiers) => {
  assert(
    Array.isArray(identifiers) &&
      identifiers.length > 0 &&
      identifiers.length <= 256,
  );
  assert(
    identifiers.every(
      (id) => typeof id === "string" && /^[0-9a-f]{66}$/.test(id),
    ),
  );
  assert.equal(new Set(identifiers).size, identifiers.length);
  return identifiers;
};
export function verifyRecoveryReceipt(
  data,
  { identifiers, address, operation },
) {
  const receipt = publicReceipt(data);
  checkedIdentifiers(identifiers);
  checkedIdentifiers(data.identifiers);
  checkedIdentifiers(data.tx.identifiers());
  assert.match(receipt.txHash, /^[0-9a-f]{64}$/);
  assert.match(receipt.blockHash, /^[0-9a-f]{64}$/);
  assert(Number.isSafeInteger(receipt.blockHeight) && receipt.blockHeight >= 0);
  assert.equal(data.tx.transactionHash(), receipt.txHash);
  assert(identifiers.includes(receipt.txId));
  // Ledger merges may add fee-only intents; every originally fenced ID must survive.
  assert(identifiers.every((id) => data.identifiers.includes(id)));
  assert.deepEqual(
    [...data.tx.identifiers()].sort(),
    [...data.identifiers].sort(),
  );
  const actions = [...data.tx.intents.values()].flatMap(
    (intent) => intent.actions,
  );
  assert.equal(
    actions.length,
    1,
    "Unexpected contract actions in recovered transaction",
  );
  const action = actions[0];
  assert.equal(action.address, address);
  if (operation === "deploy") assert(action instanceof L.ContractDeploy);
  else {
    assert(operations.includes(operation));
    assert(action instanceof L.MaintenanceUpdate);
    assert.equal(action.counter, operation === "install" ? 0n : 1n);
  }
  return receipt;
}

export async function runProcessRecovery({
  home,
  genesisHash,
  artifactSetSha256,
  coinPublicKey,
  submit,
  reconcile,
  observe,
  snapshot,
  emit,
  step,
  timeoutMs = 180_000,
}) {
  const directory = await mkdtemp(join(home, "actor-recovery-"));
  const key = randomBytes(32);
  const binding = {
    network: "undeployed",
    genesis: genesisHash,
    artifactSet: artifactSetSha256,
    actorId: `buyer-${randomUUID()}`,
    orderId: randomUUID(),
  };
  const sent = new Map();
  let plannedAddress;
  let interrupted = false;
  const runWorker = (resume) =>
    new Promise((resolve, reject) => {
      const worker = fork(
        new URL("./recovery-worker.mjs", import.meta.url),
        [],
        {
          serialization: "advanced",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      const fences = new Map();
      let fenceSerial = 0;
      let settled = false;
      let rpcBusy = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          worker.kill("SIGKILL");
          reject(error);
        } else resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish(new Error("Recovery worker deadline; outcome may be unknown")),
        timeoutMs,
      );
      worker.on("error", () => finish(new Error("Recovery worker failed")));
      worker.on("exit", (code, signal) => {
        if (!resume && interrupted && signal === "SIGKILL")
          finish(null, { interrupted: true });
        else if (!settled)
          finish(
            new Error(
              `Recovery worker exited without a verified result (${code})`,
            ),
          );
        for (const fence of fences.values())
          fence.reject(
            new Error("Recovery worker exited before durable acknowledgement"),
          );
      });
      worker.on("message", (message) => {
        if (message.type === "pending-ack") {
          const fence = fences.get(message.id);
          if (!fence)
            return finish(new Error("Unknown durable acknowledgement"));
          fences.delete(message.id);
          fence.resolve();
          return;
        }
        if (message.type === "failed") {
          emit("recovery-worker-failed", message.diagnostic);
          return finish(
            new Error("Actor recovery failed; private details withheld"),
          );
        }
        if (message.type === "done") {
          if (!resume)
            return finish(new Error("Expected interruption did not occur"));
          return finish(null, message.result);
        }
        if (message.type !== "call" || rpcBusy)
          return finish(new Error("Unexpected concurrent recovery request"));
        rpcBusy = true;
        Promise.resolve()
          .then(async () => {
            const { id, method, address, operation } = message;
            assert.match(address, /^[0-9a-f]{64}$/);
            plannedAddress ??= address;
            assert.equal(
              address,
              plannedAddress,
              "Recovery changed the contract address",
            );
            let value;
            if (method === "submit") {
              assert(operations.includes(operation));
              assert.equal(
                sent.get(operation) ?? 0,
                0,
                "Duplicate deployment or step submission refused",
              );
              assert(
                message.bytes instanceof Uint8Array &&
                  message.bytes.length <= 1_048_576,
              );
              step(`MID-T01-recovery-${operation}`);
              const tx = L.Transaction.deserialize(
                "signature",
                "pre-proof",
                "pre-binding",
                message.bytes,
              );
              let identifiers;
              const data = await submit(tx, async (finalized) => {
                assert.equal(
                  identifiers,
                  undefined,
                  "Repeated submission fence",
                );
                identifiers = finalized.identifiers();
                const ack = ++fenceSerial;
                await new Promise((resolve, reject) => {
                  fences.set(ack, { resolve, reject });
                  worker.send({ type: "pending", id: ack, identifiers });
                });
                sent.set(operation, 1);
                emit("recovery-pending-durable", {
                  operation,
                  address,
                  identifiers,
                });
              });
              value = verifyRecoveryReceipt(data, {
                identifiers,
                address,
                operation,
              });
              if (!resume && operation === "deploy") {
                interrupted = true;
                emit("recovery-actor-interrupted", {
                  operation,
                  address,
                  acknowledgementDelivered: false,
                  reservationExecuted: false,
                });
                worker.kill("SIGKILL");
                return;
              }
            } else if (method === "reconcile") {
              assert(resume && operations.includes(operation));
              step(`MID-T01-recovery-reconcile-${operation}`);
              const data = await reconcile(message.identifiers);
              value = verifyRecoveryReceipt(data, {
                identifiers: message.identifiers,
                address,
                operation,
              });
              emit("recovery-pending-reconciled", {
                operation,
                address,
                ...value,
                source: "fresh-indexer-query",
              });
            } else if (method === "observe") {
              const state = await observe(address, message.blockHash);
              assert(state);
              value = state.serialize();
            } else if (method === "observeCurrent") {
              value = (await snapshot(address)).state.serialize();
            } else if (method === "inspected") {
              assert(operations.includes(operation));
              emit("recovery-step-inspected", {
                operation,
                address,
                blockHash: message.blockHash,
              });
              value = true;
            } else throw new Error("Unsupported recovery operation");
            if (worker.connected)
              worker.send({ type: "reply", id, ok: true, value });
          })
          .catch((error) => {
            emit("recovery-broker-failed", errorDiagnostics(error));
            finish(new Error("Recovery broker failed; no retry permitted"));
          })
          .finally(() => {
            rpcBusy = false;
          });
      });
      worker.send({
        type: "start",
        resume,
        binding,
        directory,
        key,
        coinPublicKey,
      });
    });
  try {
    assert.equal((await runWorker(false)).interrupted, true);
    const result = await runWorker(true);
    assert.equal(result.address, plannedAddress);
    assert.equal(result.reconciledPendingTransactions, 1);
    assert.equal(result.actorCommitmentsRestored, true);
    assert.equal(result.immutableOrderAdmission, false);
    assert.equal(result.reservationExecuted, false);
    assert.deepEqual([...sent.keys()].sort(), [...operations].sort());
    return {
      ...result,
      actualActorProcessRestart: true,
      walletBrokerRestarted: false,
      submissionCount: 3,
      duplicateSubmissionCount: 0,
      interruptedAcknowledgement: "deploy",
    };
  } finally {
    key.fill(0);
  }
}
