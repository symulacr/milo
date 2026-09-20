// Submission-tracking coherence for our socket submitter.
//
// THE MISMATCH THIS MODULE EXISTS TO REMOVE
//
// midnight-js's provider contract is that `midnightProvider.submitTx(finalizedTx)`
// returns a TransactionId: the LEDGER transaction identifier. Everything downstream
// that waits for a submission resolves that return value as the ledger identifier:
//
//   - the blocking `submitTx` (midnight-js-contracts/dist/index.mjs:69-72) calls
//     `publicDataProvider.watchForTxData(txId)`, and the indexer provider queries
//     `transactions(offset: { identifier })` (midnight-js-indexer-public-data-provider/
//     dist/index.mjs:965-994, schema in dist/gen/graphql.d.ts:740-749);
//   - `PendingTransactionsService.queryForStatus` queries `TransactionStatus` with
//     `this.#txTrait.firstId(tx)`, which is `tx.identifiers()[0]`
//     (wallet-sdk-capabilities/dist/pendingTransactions/pendingTransactionsService.js:
//      118-121, wallet-sdk-facade/dist/transaction.js:26-28).
//
// The SDK's own submit path returns exactly that value: `WalletFacade.submitTransaction`
// returns `tx.identifiers().at(-1)` (wallet-sdk-facade/dist/index.js:318-323), the
// testkit wrapper delegates to it (testkit-js/dist/index.mjs:1979-1980), and the
// official browser guide's `midnightProvider.submitTx` returns `tx.identifiers()[0]`.
//
// Our socket submitter returns the node's `author_submitExtrinsic` result instead: the
// substrate EXTRINSIC HASH. That is a different value in a different space - 32 bytes
// (64 hex) against the ledger identifier's 33 bytes (66 hex). Passing the extrinsic hash
// to `watchForTxData` matches nothing, so the poll never resolves and the caller hangs.
// The deploy path is unaffected because it uses `submitTxAsync` (no watch); the first
// circuit call is not, because circuit calls and the maintenance authority-replacement
// path go through the blocking `submitTx`.
//
// This module separates the two facts a submission produces:
//   - acceptance: the node accepted the extrinsic (the transport's result), not finality;
//   - identity: the ledger transaction identifier (this module's `ledgerTransactionId`).
// The transport keeps returning the extrinsic hash; the provider return value is the
// ledger identifier. Confirmation still comes only from observed ledger state.
import assert from "node:assert/strict";

/** A ledger transaction identifier: 33 bytes, bare lowercase hex, as `identifiers()` returns. */
export const LEDGER_TRANSACTION_ID = /^[0-9a-f]{66}$/;

/** A substrate extrinsic hash as the node returns it: 32 bytes, `0x`-prefixed hex. */
export const EXTRINSIC_HASH = /^0x[0-9a-f]{64}$/;

/**
 * The ledger transaction identifier for a finalized transaction.
 *
 * Matches `WalletFacade.submitTransaction`: the LAST identifier
 * (wallet-sdk-facade/dist/index.js:322). For the single-intent transactions this harness
 * builds the last and first identifiers are the same, so either agrees with the SDK.
 *
 * Fails loudly rather than falling back to an extrinsic hash: silently returning the
 * wrong id is the class of hang this module removes.
 */
export function ledgerTransactionId(finalized) {
  assert.equal(
    typeof finalized?.identifiers,
    "function",
    "submit-tracking: finalized transaction has no identifiers(); cannot derive a ledger transaction id",
  );
  const identifiers = finalized.identifiers();
  assert.ok(
    Array.isArray(identifiers) && identifiers.length > 0,
    "submit-tracking: finalized transaction carries no identifiers",
  );
  const id = identifiers.at(-1);
  assert.equal(
    typeof id,
    "string",
    "submit-tracking: ledger transaction identifier is not a string",
  );
  assert.match(
    id,
    LEDGER_TRANSACTION_ID,
    `submit-tracking: '${String(id).slice(0, 80)}' is not a ledger transaction identifier ` +
      "(33 bytes, bare 66-hex); an extrinsic hash is 32 bytes and would make watchForTxData poll forever",
  );
  return id;
}

/**
 * Book the wallet's pending record before the send, exactly as
 * `WalletFacade.submitTransaction` does (wallet-sdk-facade/dist/index.js:320),
 * then return the ledger identifier after the transport accepts.
 *
 * `addPendingTransaction` is idempotent for the same transaction
 * (pendingTransactions/pendingTransactions.js:33-41 merges transactions whose ids are
 * included in one another), so booking here is a no-op when `finalizeRecipe` already
 * booked it, as the lane's `walletProvider.balanceTx` does
 * (wallet-sdk-facade/dist/index.js:434-435, 486-491).
 *
 * This NEVER clears the pending record and never reports success: acceptance is not
 * finality. The wallet's own indexer poll clears the record only on an observed
 * SUCCESS (pendingTransactionsService.js:107-116), and callers confirm against observed
 * ledger state.
 *
 * @param {{
 *   submit: (finalized: object) => Promise<unknown>,
 *   wallet?: { pendingTransactionsService?: { addPendingTransaction?: (tx: object) => Promise<unknown> } },
 *   emit?: (event: string, fields?: object) => void,
 * }} deps
 * @returns {(finalized: object) => Promise<string>} the SDK-contract submit: ledger id.
 */
export function createTrackedSubmitter({ submit, wallet, emit } = {}) {
  assert.equal(
    typeof submit,
    "function",
    "submit-tracking: createTrackedSubmitter needs a submit transport",
  );
  const pending = wallet?.pendingTransactionsService;
  return async function submitTracked(finalized) {
    // Derive identity before the send, so a malformed transaction is rejected before a
    // socket opens and no submission is attempted.
    const txId = ledgerTransactionId(finalized);
    if (typeof pending?.addPendingTransaction === "function")
      await pending.addPendingTransaction(finalized);
    const accepted = await submit(finalized);
    const extrinsicHash = accepted?.extrinsicHash ?? accepted;
    if (emit) emit("submission-accepted", { txId, extrinsicHash });
    // The provider contract value. The extrinsic hash is acceptance evidence, kept in the
    // event above, never returned as the transaction identity.
    return txId;
  };
}

/**
 * VARIANT (a), prototyped for comparison: a SubmissionService that uses OUR transport.
 *
 * `WalletFacade.submitTransaction` (wallet-sdk-facade/dist/index.js:318-328) is the wallet's
 * own coherent path: it books the pending record (line 320), calls
 * `submissionService.submitTransaction(tx, 'Finalized')` (line 321), and returns the ledger
 * identifier `tx.identifiers().at(-1)` (line 322), reverting the pending record on error
 * (lines 324-326). Its DEFAULT submission service cannot be used here: it waits for a
 * Finalized event over `PolkadotNodeClient` (submission/submissionService.js:30-31), the
 * relay subscription Preprod closes.
 *
 * This adapter is the missing piece that makes the facade's own path usable: the facade
 * passes `waitForStatus = 'Finalized'`, and this resolves on ACCEPTANCE from our transport
 * instead. It deliberately ignores `waitForStatus`; waiting for Finalized is what the relay
 * cannot do. Wiring it needs the owner of preprod-lane.mjs, not this module:
 *
 *   installTransportSubmissionService(session.wallet, { submit });
 *   // then provider.midnightProvider.submitTx = (tx) => session.wallet.submitTransaction(tx)
 *
 * NOT wired here: the recommended variant is smaller and needs no change to the facade's
 * construction. Acceptance is still not finality: this resolves only once the node accepted
 * the extrinsic, and callers must confirm from observed ledger state.
 */
export function createTransportSubmissionService({ submit, emit } = {}) {
  assert.equal(
    typeof submit,
    "function",
    "submit-tracking: createTransportSubmissionService needs a submit transport",
  );
  return {
    async submitTransaction(tx, waitForStatus) {
      const accepted = await submit(tx);
      if (emit)
        emit("submission-accepted", {
          waitForStatus,
          extrinsicHash: accepted?.extrinsicHash ?? accepted,
        });
      return accepted;
    },
    async close() {
      // Nothing to close: the transport owns its own socket lifetime.
    },
  };
}

/**
 * Wire the adapter above onto an already-initialized facade by replacing its public
 * `submissionService` field (wallet-sdk-facade/dist/index.js:198). Returns the service.
 * Review aid for variant (a); the recommended variant leaves the facade untouched.
 */
export function installTransportSubmissionService(wallet, deps) {
  assert.ok(
    wallet && typeof wallet === "object",
    "submit-tracking: installTransportSubmissionService needs a wallet facade",
  );
  wallet.submissionService = createTransportSubmissionService(deps);
  return wallet.submissionService;
}

/**
 * Confirmation, not acceptance: resolve only when `observe()` reports the fact on ledger.
 *
 * This is the bounded loop the harness's rule wants instead of trusting a promise
 * resolution. It never claims success; it returns the observed value or throws on the
 * deadline. Used to keep the "acceptance is not finality" rule executable in one place.
 *
 * @param {() => Promise<unknown> | unknown} observe resolves truthy once the fact is on chain.
 */
export async function awaitObserved(
  observe,
  { timeoutMs = 120_000, intervalMs = 1_000 } = {},
) {
  assert.equal(
    typeof observe,
    "function",
    "submit-tracking: awaitObserved needs observe()",
  );
  const deadline = Date.now() + timeoutMs;
  let observed = await observe();
  while (!observed) {
    if (Date.now() >= deadline)
      throw new Error(
        `submit-tracking: fact not observed within ${timeoutMs}ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    observed = await observe();
  }
  return observed;
}
