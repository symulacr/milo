import assert from "node:assert/strict";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";

// The staged-transaction intent TTL: one fact for every signed transaction the
// harness submits (deploy, maintenance, lock, recovery replay).
export const INTENT_TTL_MS = 600_000;

export const intentExpiry = () => new Date(Date.now() + INTENT_TTL_MS);

/**
 * The single construction point for every transaction the harness submits.
 *
 * `staged` is the shape gate. `Transaction.fromParts` silently accepts a nested
 * Transaction where an Intent belongs: it does not throw, it produces a
 * transaction whose `intents` is undefined, and it serializes to a
 * silently-invalid transaction. Asserting the intent type before the call and
 * the resulting shape after it turns that class of mistake into a loud failure
 * at the one place all callers pass through.
 */
export function staged(networkId, intent) {
  assert(intent instanceof L.Intent, "staged: expected a single Intent");
  const tx = L.Transaction.fromParts(networkId, undefined, undefined, intent);
  assert.notEqual(tx.intents, undefined, "staged: transaction has no intents");
  assert.equal(tx.intents.size, 1, "staged: expected exactly one intent");
  const [only] = [...tx.intents.values()];
  assert.equal(only.actions.length, 1, "staged: expected exactly one action");
  assert(
    !(only.actions[0] instanceof L.Transaction),
    "staged: action is a Transaction",
  );
  return tx;
}

export const maintenanceTx = (networkId, update, ttl = intentExpiry()) =>
  staged(networkId, L.Intent.new(ttl).addMaintenanceUpdate(update));

export const deployTx = (networkId, deploy, ttl = intentExpiry()) =>
  staged(networkId, L.Intent.new(ttl).addDeploy(deploy));
