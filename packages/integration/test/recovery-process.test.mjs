import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits, validateArtifacts } from "../src/artifacts.mjs";
import { artifacts } from "../src/order.mjs";
import {
  runProcessRecovery,
  verifyRecoveryReceipt,
} from "../src/recovery-process.mjs";

test("MID-T01 actor worker fixture: actual process loss restores encrypted state, reconciles IDs and never redeploys", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "milo-worker-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  let state;
  let last;
  let submits = 0;
  let reconciles = 0;
  const events = [];
  const keys = new Map(
    await new NodeZkConfigProvider(artifacts).getVerifierKeys(proofCircuits),
  );
  const result = await runProcessRecovery({
    home,
    genesisHash: `0x${"01".repeat(32)}`,
    artifactSetSha256: (await validateArtifacts()).artifactSetSha256,
    coinPublicKey: "00".repeat(32),
    timeoutMs: 60_000,
    step: () => {},
    emit: (event, data) => events.push({ event, ...data }),
    observe: async () => state,
    snapshot: async () => ({ state }),
    reconcile: async (identifiers) => {
      reconciles++;
      assert.deepEqual(identifiers, last.identifiers);
      return last;
    },
    submit: async (tx, fence) => {
      const identifiers = [`00${randomBytes(32).toString("hex")}`];
      await fence({ identifiers: () => identifiers });
      submits++;
      const action = [...tx.intents.values()][0].actions[0];
      if (submits === 1) state = action.initialState;
      else if (submits === 2) {
        for (const update of action.updates) {
          const operation = new L.ContractOperation();
          const artifact = keys.get(update.operation);
          assert.deepEqual(
            update.vk.rawVk,
            new L.ContractOperationVersionedVerifierKey("v3", artifact).rawVk,
          );
          operation.verifierKey = artifact;
          state.setOperation(update.operation, operation);
        }
        const authority = state.maintenanceAuthority;
        state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
          authority.committee,
          1,
          1n,
        );
      } else
        state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
          [],
          1,
          2n,
        );
      last = {
        status: "SucceedEntirely",
        txId: identifiers[0],
        identifiers,
        txHash: "ab".repeat(32),
        blockHash: "cd".repeat(32),
        blockHeight: 20 + submits,
        tx: {
          intents: tx.intents,
          identifiers: () => identifiers,
          transactionHash: () => "ab".repeat(32),
        },
      };
      return last;
    },
  }).catch((error) => {
    assert.fail(
      `${error.name}: ${JSON.stringify(events.filter((item) => item.event.endsWith("failed")))}`,
    );
  });
  assert.equal(result.actualActorProcessRestart, true);
  assert.equal(submits, 3);
  assert.equal(reconciles, 1);
  assert.equal(result.actorCommitmentsRestored, true);
  assert.equal(result.immutableOrderAdmission, false);
  assert.equal(result.walletBrokerRestarted, false);
  const interrupted = events.findIndex(
    (event) => event.event === "recovery-actor-interrupted",
  );
  const reconciled = events.findIndex(
    (event) => event.event === "recovery-pending-reconciled",
  );
  assert(interrupted >= 0 && reconciled > interrupted);
  assert(!JSON.stringify(events).includes("signingKey"));
  assert(!JSON.stringify(events).includes("preparedDeployment"));
});

test("MID-T01 recovery receipt guard rejects unrelated IDs, addresses, operations and partial success", () => {
  const deploy = new L.ContractDeploy(new L.ContractState());
  const id = `00${"ab".repeat(32)}`;
  const tx = L.Transaction.fromParts(
    "undeployed",
    undefined,
    undefined,
    L.Intent.new(new Date()).addDeploy(deploy),
  );
  const data = {
    status: "SucceedEntirely",
    txId: id,
    identifiers: [id],
    txHash: "ab".repeat(32),
    blockHash: "cd".repeat(32),
    blockHeight: 1,
    tx: {
      intents: tx.intents,
      identifiers: () => [id],
      transactionHash: () => "ab".repeat(32),
    },
  };
  const expected = {
    identifiers: [id],
    address: deploy.address,
    operation: "deploy",
  };
  verifyRecoveryReceipt(data, expected);
  assert.throws(() =>
    verifyRecoveryReceipt({ ...data, status: "FailEntirely" }, expected),
  );
  assert.throws(() =>
    verifyRecoveryReceipt(data, {
      ...expected,
      identifiers: [`00${"bc".repeat(32)}`],
    }),
  );
  assert.throws(() =>
    verifyRecoveryReceipt(data, { ...expected, address: "00".repeat(32) }),
  );
  assert.throws(() =>
    verifyRecoveryReceipt(data, { ...expected, operation: "lock" }),
  );
  const mergedIds = [id, `00${"cd".repeat(32)}`];
  verifyRecoveryReceipt(
    {
      ...data,
      identifiers: mergedIds,
      tx: { ...data.tx, identifiers: () => mergedIds },
    },
    expected,
  );
  for (const identifiers of [[id, id], [], [id, "bad"]])
    assert.throws(() =>
      verifyRecoveryReceipt(
        {
          ...data,
          identifiers,
          tx: { ...data.tx, identifiers: () => identifiers },
        },
        expected,
      ),
    );
  assert.throws(() =>
    verifyRecoveryReceipt({ ...data, txHash: "ef".repeat(32) }, expected),
  );
});
