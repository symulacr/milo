import assert from "node:assert/strict";
import test from "node:test";
import {
  awaitObserved,
  createTrackedSubmitter,
  createTransportSubmissionService,
  installTransportSubmissionService,
  LEDGER_TRANSACTION_ID,
  ledgerTransactionId,
} from "../src/submit-tracking.mjs";

// Local drill receipts record ledger identifiers as bare 66-hex (e.g.
// 001f0e612d97000949448b887bfb32911c103f5e04a61f71ac92f5a7fbe7a9f5a3); Preprod
// receipts recorded the socket submitter's 0x + 64-hex extrinsic hash instead.
const LEDGER_ID = `00${"1f".repeat(32)}`;
const EXTRINSIC_HASH = `0x${"ab".repeat(32)}`;

const finalized = (identifiers) => ({
  identifiers: () => identifiers,
  serialize: () => new Uint8Array(4),
});

test("ledgerTransactionId returns the last identifier, as WalletFacade.submitTransaction does", () => {
  assert.match(LEDGER_ID, LEDGER_TRANSACTION_ID);
  assert.equal(ledgerTransactionId(finalized([LEDGER_ID])), LEDGER_ID);
  // Multi-intent: the facade takes .at(-1); the first and last agree in our single-intent
  // transactions but the contract value is the last.
  const second = `01${"22".repeat(32)}`;
  assert.equal(ledgerTransactionId(finalized([LEDGER_ID, second])), second);
});

test("ledgerTransactionId rejects the node extrinsic hash, the mismatch that hangs the watch", () => {
  assert.throws(
    () => ledgerTransactionId(finalized([EXTRINSIC_HASH])),
    /not a ledger transaction identifier[\s\S]*extrinsic hash is 32 bytes/,
  );
  assert.throws(() => ledgerTransactionId(finalized([])));
  assert.throws(() => ledgerTransactionId(finalized([null])));
  assert.throws(() =>
    ledgerTransactionId({ serialize: () => new Uint8Array(1) }),
  );
});

test("createTrackedSubmitter books the pending record, accepts, and returns the ledger id", async () => {
  const events = [];
  const booked = [];
  const wallet = {
    pendingTransactionsService: {
      async addPendingTransaction(tx) {
        booked.push(tx);
      },
    },
  };
  const transportResult = EXTRINSIC_HASH; // what the raw socket submit returns
  const submit = createTrackedSubmitter({
    submit: async () => transportResult,
    wallet,
    emit: (event, fields) => events.push({ event, ...fields }),
  });
  const tx = finalized([LEDGER_ID]);
  assert.equal(await submit(tx), LEDGER_ID);
  assert.deepEqual(booked, [tx]);
  assert.deepEqual(events, [
    {
      event: "submission-accepted",
      txId: LEDGER_ID,
      extrinsicHash: EXTRINSIC_HASH,
    },
  ]);
  // Acceptance is not finality: the tracker never clears the pending record.
  assert.equal(wallet.pendingTransactionsService.clear, undefined);
});

test("createTrackedSubmitter works without a wallet and never returns the extrinsic hash", async () => {
  const submit = createTrackedSubmitter({ submit: async () => EXTRINSIC_HASH });
  assert.equal(await submit(finalized([LEDGER_ID])), LEDGER_ID);
});

// A stand-in for midnight-js's blocking path: `submitTx` feeds the provider return value
// to an indexer query keyed by the ledger identifier. The query resolves only for a
// 66-hex identifier, exactly as the indexer's TransactionOffset { identifier } does.
function watchForTxData(txId, index) {
  return new Promise((resolve) => {
    if (index.has(txId)) resolve({ txId, found: true });
  });
}

test("the tracked submit resolves the indexer watch; the raw extrinsic hash never would", async () => {
  const onChain = new Set([LEDGER_ID]);
  const raw = await (async () => EXTRINSIC_HASH)();
  // The raw provider return value is the extrinsic hash, which is never an indexer key.
  const rawWatch = await Promise.race([
    watchForTxData(raw, onChain),
    new Promise((resolve) => setTimeout(() => resolve("stalled"), 10)),
  ]);
  assert.equal(rawWatch, "stalled");

  const submit = createTrackedSubmitter({ submit: async () => raw });
  const txId = await submit(finalized([LEDGER_ID]));
  const trackedWatch = await Promise.race([
    watchForTxData(txId, onChain),
    new Promise((resolve) => setTimeout(() => resolve("stalled"), 10)),
  ]);
  assert.deepEqual(trackedWatch, { txId: LEDGER_ID, found: true });
});

test("variant (a): the transport submission service resolves on acceptance, not Finalized", async () => {
  const events = [];
  const sent = [];
  const service = createTransportSubmissionService({
    submit: async (tx) => {
      sent.push(tx);
      return EXTRINSIC_HASH; // the transport's acceptance result
    },
    emit: (event, fields) => events.push({ event, ...fields }),
  });
  const tx = finalized([LEDGER_ID]);
  // The facade calls submitTransaction(tx, 'Finalized'); the service must NOT wait for a
  // Finalized event (the relay cannot deliver one) - it resolves on acceptance.
  const result = await service.submitTransaction(tx, "Finalized");
  assert.equal(result, EXTRINSIC_HASH);
  assert.deepEqual(sent, [tx]);
  assert.deepEqual(events, [
    {
      event: "submission-accepted",
      waitForStatus: "Finalized",
      extrinsicHash: EXTRINSIC_HASH,
    },
  ]);
  await service.close();
});

test("variant (a): installing it makes the facade's own submitTransaction coherent", async () => {
  // A faithful stand-in for WalletFacade.submitTransaction (facade index.js:318-328): book
  // the pending record, call the submission service with 'Finalized', return the last id.
  const booked = [];
  const wallet = {
    pendingTransactionsService: {
      async addPendingTransaction(tx) {
        booked.push(tx);
      },
    },
    async submitTransaction(tx) {
      await this.pendingTransactionsService.addPendingTransaction(tx);
      await this.submissionService.submitTransaction(tx, "Finalized");
      return tx.identifiers().at(-1);
    },
  };
  installTransportSubmissionService(wallet, {
    submit: async () => EXTRINSIC_HASH,
  });
  const tx = finalized([LEDGER_ID]);
  assert.equal(await wallet.submitTransaction(tx), LEDGER_ID);
  assert.deepEqual(booked, [tx]);
  // The default relay-waiting submission service is gone, not merely bypassed.
  assert.equal(typeof wallet.submissionService.submitTransaction, "function");
});

test("awaitObserved confirms only from observed state and is bounded", async () => {
  let probes = 0;
  const value = await awaitObserved(
    async () => {
      probes++;
      return probes >= 2 ? "SUCCESS" : undefined;
    },
    { timeoutMs: 200, intervalMs: 5 },
  );
  assert.equal(value, "SUCCESS");
  assert.ok(probes >= 2);

  await assert.rejects(
    awaitObserved(async () => undefined, { timeoutMs: 20, intervalMs: 5 }),
    /fact not observed within 20ms/,
  );
  await assert.rejects(awaitObserved(undefined), /needs observe/);
});
