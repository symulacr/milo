import assert from "node:assert/strict";
import test from "node:test";
import { captureSubmissions } from "../src/submissions.mjs";

const id = `01${"a".repeat(64)}`;
test("MID-T01 captures pre-send IDs for hidden DUST registration, funding and contract submissions", async () => {
  const events = [];
  let stage;
  const secret = "PRIVATE_SEED_WITNESS_MUST_NOT_ESCAPE";
  const tx = {
    identifiers: () => [id],
    serialize: () => new Uint8Array(3),
    privateState: secret,
    toJSON() {
      throw new Error(secret);
    },
  };
  const wallet = {
    async submitTransaction(value) {
      assert.equal(value, tx);
      assert.equal(events.at(-1).event, "submission-attempt");
      assert.equal(this, wallet);
      return id;
    },
  };
  const original = wallet.submitTransaction;
  const restore = captureSubmissions(
    wallet,
    (event, fields) => events.push({ event, ...fields }),
    () => stage,
  );
  for (stage of [
    "genesis-wallet-sync",
    "fresh-buyer-funding",
    "fresh-buyer-dust",
    "MID-T01-deploy",
    "MID-T01-maintenance-lock",
    "MID-T02-reserve-diagnostic-nonadmitted",
  ]) {
    assert.equal(await wallet.submitTransaction(tx), id);
    assert.deepEqual(events.at(-2), {
      event: "submission-attempt",
      stage,
      identifiers: [id],
      transactionBytes: 3,
    });
    assert.deepEqual(events.at(-1), {
      event: "submission-returned",
      stage,
      identifiers: [id],
      txId: id,
    });
  }
  assert(!JSON.stringify(events).includes(secret));
  restore();
  assert.equal(wallet.submitTransaction, original);
});

test("MID-T01 retains attempted IDs when send throws; malformed identifiers never reach submission", async () => {
  const events = [];
  let sent = 0;
  const error = new Error("PRIVATE_SERVER_ERROR");
  const wallet = {
    async submitTransaction() {
      sent++;
      throw error;
    },
  };
  captureSubmissions(
    wallet,
    (event, fields) => events.push({ event, ...fields }),
    () => "fresh-buyer-dust",
  );
  await assert.rejects(
    wallet.submitTransaction({
      identifiers: () => [id],
      serialize: () => new Uint8Array(3),
    }),
    (cause) => cause === error,
  );
  assert.deepEqual(events, [
    {
      event: "submission-attempt",
      stage: "fresh-buyer-dust",
      identifiers: [id],
      transactionBytes: 3,
    },
  ]);
  for (const identifiers of [
    [],
    ["PRIVATE_SECRET"],
    [null],
    Array(257).fill(id),
  ]) {
    await assert.rejects(
      wallet.submitTransaction({ identifiers: () => identifiers }),
    );
  }
  assert.equal(sent, 1);
  assert(!JSON.stringify(events).includes("PRIVATE"));
});
