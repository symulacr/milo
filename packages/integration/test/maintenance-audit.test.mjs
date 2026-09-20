import assert from "node:assert/strict";
import test from "node:test";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "../src/artifacts.mjs";
import { prepareBootstrap } from "../src/bootstrap.mjs";
import {
  auditCaseTx,
  maintenanceCases,
  observeFinalizedContract,
  retainedKeyProposal,
  runRetainedKeyAudit,
} from "../src/maintenance-audit.mjs";
import { artifacts, freshOrder } from "../src/order.mjs";
import { deployTx, maintenanceTx, staged } from "../src/tx.mjs";

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
  });
  const state = L.ContractState.deserialize(plan.initial.serialize());
  const address = new L.ContractDeploy(plan.initial).address;
  for (const [name, key] of verifierKeys) {
    const op = new L.ContractOperation();
    op.verifierKey = key;
    state.setOperation(name, op);
  }
  state.maintenanceAuthority = new L.ContractMaintenanceAuthority([], 1, 2n);
  return {
    signingKey,
    plan,
    state,
    address,
    networkId: "undeployed",
    ttl: new Date(Date.now() + 600_000),
  };
};

test("MID-T01 retained-key proposals use exact address/current counter and a valid retained signature", () => {
  const f = fixture();
  for (const kind of maintenanceCases) {
    const tx = retainedKeyProposal({ ...f, kind });
    const actions = [...tx.intents.values()][0].actions;
    assert.equal(actions.length, 1);
    const update = actions[0];
    assert(update instanceof L.MaintenanceUpdate);
    assert.equal(update.address, f.address);
    assert.equal(update.counter, 2n);
    const [[index, signature]] = update.signatures;
    assert.equal(index, 0n);
    assert(L.verifySignature(f.plan.signer, update.dataToSign, signature));
    const instruction = update.updates.at(-1);
    if (kind === "replace-verifier" || kind === "insert-verifier") {
      assert(instruction instanceof L.VerifierKeyInsert);
      if (kind === "replace-verifier") {
        assert.equal(update.updates.length, 2);
        assert(update.updates[0] instanceof L.VerifierKeyRemove);
        assert.equal(update.updates[0].operation, "reserve");
        assert.equal(instruction.operation, "reserve");
      } else {
        assert.equal(update.updates.length, 1);
        assert.equal(instruction.operation, "maintenanceCanary");
        assert.equal(f.state.operation("maintenanceCanary"), undefined);
      }
      assert.deepEqual(
        instruction.vk.rawVk,
        new L.ContractOperationVersionedVerifierKey(
          "v3",
          f.plan.keys.get("accept"),
        ).rawVk,
      );
      assert.notDeepEqual(
        f.plan.keys.get("accept"),
        f.plan.keys.get("reserve"),
      );
    } else if (kind === "remove-verifier") {
      assert(instruction instanceof L.VerifierKeyRemove);
      assert.equal(instruction.operation, "reserve");
    } else {
      assert(instruction instanceof L.ReplaceAuthority);
      assert.deepEqual(instruction.authority.committee, [f.plan.signer]);
      assert.equal(instruction.authority.threshold, 1);
      assert.equal(instruction.authority.counter, 3n);
    }
  }
  assert.throws(() => retainedKeyProposal({ ...f, kind: "unknown" }));
  assert.throws(() =>
    retainedKeyProposal({
      ...f,
      kind: "restore-authority",
      signingKey: L.sampleSigningKey(),
    }),
  );
  assert.throws(() =>
    retainedKeyProposal({
      ...f,
      kind: "restore-authority",
      state: f.plan.initial,
    }),
  );
});

test("MID-T01 post-lock counter probes retain internally normalized authority counters and valid signatures", () => {
  const f = fixture();
  for (const counterDelta of [-1n, 0n, 1n]) {
    const tx = retainedKeyProposal({
      ...f,
      kind: "restore-authority",
      counterDelta,
      ttl: new Date(Date.now() + 600_000),
    });
    const update = [...tx.intents.values()][0].actions[0];
    assert.equal(
      update.counter,
      f.state.maintenanceAuthority.counter + counterDelta,
    );
    assert.equal(update.updates[0].authority.counter, update.counter + 1n);
    assert(
      L.verifySignature(
        f.plan.signer,
        update.dataToSign,
        update.signatures[0][1],
      ),
    );
  }
});

test("MID-T01 node-invalid is not authority proof; generic rejection is observed then stops without further sends", async () => {
  const f = fixture();
  const events = [];
  let sends = 0;
  let snapshots = 0;
  await assert.rejects(
    runRetainedKeyAudit({
      ...f,
      step: () => {},
      emit: (event, data) => events.push({ event, ...data }),
      context: () => ({ boundary: "midnightProvider.submitTx" }),
      submit: async () => {
        sends++;
        throw Object.assign(new Error("private-message-canary"), {
          name: "RpcError",
          code: 1010,
          data: "InvalidTransaction custom error",
        });
      },
      snapshot: async (_address, afterHeight) => {
        snapshots++;
        if (snapshots === 2) assert.equal(afterHeight, 30);
        return {
          state: f.state,
          blockHeight: snapshots === 1 ? 30 : 31,
          blockHash: snapshots === 1 ? "before" : "after",
        };
      },
    }),
    /Authority-specific/,
  );
  assert.equal(sends, 1);
  assert.equal(snapshots, 2);
  const observed = events.find(
    (e) => e.event === "maintenance-node-rejection-observed",
  );
  assert.equal(observed.unchanged, true);
  assert.equal(observed.authorityRejectionVerified, false);
  assert.equal(observed.conclusion, "node-rejected-cause-unresolved");
  assert(!JSON.stringify(events).includes("private-message-canary"));
});

test("MID-T01 pre-submit failures and outcome-unknown errors never count as maintenance rejection or trigger retries", async () => {
  for (const boundary of [
    "walletProvider.balanceTx",
    "midnightProvider.resourcePreflight",
    "midnightProvider.submitTx",
  ]) {
    const f = fixture();
    let sends = 0;
    let snapshots = 0;
    await assert.rejects(
      runRetainedKeyAudit({
        ...f,
        step: () => {},
        emit: () => {},
        context: () => ({ boundary }),
        submit: async () => {
          sends++;
          throw new Error("unknown");
        },
        snapshot: async () => {
          snapshots++;
          return { state: f.state, blockHeight: 30, blockHash: "before" };
        },
      }),
      /inconclusive/,
    );
    assert.equal(sends, 1);
    assert.equal(snapshots, 1);
  }
});

test("MID-T01 exact committee rejection permits four distinct probes but does not close replay/admission gates", async () => {
  const f = fixture();
  let sends = 0;
  let height = 30;
  const events = [];
  const result = await runRetainedKeyAudit({
    ...f,
    step: () => {},
    emit: (event, fields) => events.push({ event, ...fields }),
    context: () => ({ boundary: "midnightProvider.submitTx" }),
    submit: async () => {
      sends++;
      throw Object.assign(new Error("not-published"), {
        name: "RpcError",
        code: 1010,
        data: "Custom error: 134",
      });
    },
    snapshot: async () => {
      height++;
      return {
        state: f.state,
        blockHeight: height,
        blockHash: `block-${height}`,
      };
    },
  });
  assert.equal(sends, 4);
  assert.equal(result.retainedKeyCasesVerified, 4);
  assert.equal(result.authorityRejectionVerified, true);
  assert.equal(result.replayCounterControlsVerified, false);
  assert.equal(result.immutableOrderAdmission, false);
  assert.equal(result.reservationExecuted, false);
  assert.equal(
    events.filter((e) => e.conclusion === "KeyNotInCommittee").length,
    4,
  );
});

test("MID-T01 alternate custom errors cannot masquerade as locked-authority evidence", async () => {
  const f = fixture();
  for (const code of [108, 126, 135, 136, 255]) {
    let sends = 0;
    let height = 30;
    await assert.rejects(
      runRetainedKeyAudit({
        ...f,
        step: () => {},
        emit: () => {},
        context: () => ({ boundary: "midnightProvider.submitTx" }),
        submit: async () => {
          sends++;
          throw Object.assign(new Error("not-published"), {
            name: "RpcError",
            code: 1010,
            data: `Custom error: ${code}`,
          });
        },
        snapshot: async () => {
          height++;
          return {
            state: f.state,
            blockHeight: height,
            blockHash: `block-${height}`,
          };
        },
      }),
      /Authority-specific/,
    );
    assert.equal(sends, 1);
  }
});

test("MID-T01 snapshots use node as-of state on empty blocks, cross-check indexer state and reject drift/timeouts", async () => {
  const f = fixture();
  const blockHash = `0x${"a".repeat(64)}`;
  const calls = [];
  const args = {
    address: f.address,
    indexer: "http://127.0.0.1/",
    deadline: 100,
    now: () => 1,
    rpc: async (method, params) => {
      calls.push({ method, params });
      if (method === "chain_getFinalizedHead") return blockHash;
      if (method === "chain_getHeader") return { number: "0x20" };
      assert.equal(method, "midnight_contractState");
      assert.deepEqual(params, [f.address, blockHash]);
      return Buffer.from(f.state.serialize()).toString("hex");
    },
    request: async () => ({
      ok: true,
      json: async () => ({
        data: { block: { height: 32, hash: blockHash.slice(2) } },
      }),
    }),
    observe: async (...params) => {
      assert.deepEqual(params, [f.address]);
      return f.state;
    },
  };
  const observed = await observeFinalizedContract(args);
  assert.equal(observed.blockHeight, 32);
  assert.deepEqual(observed.state.serialize(), f.state.serialize());
  assert(calls.some((c) => c.method === "midnight_contractState"));
  await assert.rejects(
    observeFinalizedContract({ ...args, observe: async () => fixture().state }),
    /mismatch/,
  );
  await assert.rejects(
    observeFinalizedContract({
      ...args,
      request: async () => ({
        ok: true,
        json: async () => ({ data: { block: { height: 32, hash: "wrong" } } }),
      }),
    }),
  );
  let clock = 0;
  await assert.rejects(
    observeFinalizedContract({
      ...args,
      afterHeight: 32,
      deadline: 5,
      now: () => ++clock,
      wait: async () => {},
    }),
    /No later/,
  );
});

test("audit-case construction wraps the replay update in exactly one intent (double-wrap gate)", () => {
  const f = fixture();
  const proposal = retainedKeyProposal({ ...f, kind: "replace-verifier" });
  const signedUpdate = [...proposal.intents.values()][0].actions[0];
  const tx = auditCaseTx({
    kind: "locked-signed-update-replay",
    replayUpdate: signedUpdate,
    address: f.address,
    state: f.state,
    plan: f.plan,
    signingKey: f.signingKey,
    networkId: f.networkId,
  });
  // A Transaction nested where an update belongs yields intents === undefined.
  assert(tx.intents !== undefined, "intents must be defined");
  const intents = [...tx.intents.values()];
  assert.equal(intents.length, 1);
  assert.equal(intents[0].actions.length, 1);
  assert(intents[0].actions[0] instanceof L.MaintenanceUpdate);
  assert.equal(intents[0].actions[0].address, f.address);
});

test("staged() rejects the nested-Transaction double-wrap and accepts real intents", () => {
  const f = fixture();
  const proposal = retainedKeyProposal({ ...f, kind: "replace-verifier" });
  const signedUpdate = [...proposal.intents.values()][0].actions[0];

  // Legitimate shapes pass.
  const maintenance = maintenanceTx(f.networkId, signedUpdate);
  assert.equal([...maintenance.intents.values()].length, 1);
  const deployment = deployTx(
    f.networkId,
    new L.ContractDeploy(new L.ContractState()),
  );
  assert.equal([...deployment.intents.values()].length, 1);

  // The double-wrap: the regression passed a whole Transaction where an
  // Intent belongs. Raw fromParts accepts it silently (intents undefined);
  // staged must throw.
  const doubleWrapped = L.Transaction.fromParts(
    f.networkId,
    undefined,
    undefined,
    maintenance,
  );
  assert.equal(doubleWrapped.intents, undefined, "raw fromParts stays silent");
  assert.throws(
    () => staged(f.networkId, doubleWrapped),
    /expected a single Intent/,
  );
});
