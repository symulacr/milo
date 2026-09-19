import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";

// The staged-transaction intent TTL: one fact for every signed transaction the
// harness submits (deploy, maintenance, lock, recovery replay).
export const INTENT_TTL_MS = 600_000;

export const intentExpiry = () => new Date(Date.now() + INTENT_TTL_MS);

export const maintenanceTx = (networkId, update) =>
  L.Transaction.fromParts(
    networkId,
    undefined,
    undefined,
    L.Intent.new(intentExpiry()).addMaintenanceUpdate(update),
  );
