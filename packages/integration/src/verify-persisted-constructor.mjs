import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ContractState,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import { reconstructPublicConstructor } from "../../backend/src/public-constructor.mjs";
import { generated, witnesses } from "./order.mjs";

// Offline only: no observer, wallet, signing key, verifier keys or chain transport.
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  assert(input.length <= 32_768, "Persisted constructor input exceeds limit");
}
const quote = JSON.parse(input);
assert.equal(quote.network, "preprod");
const configuration = reconstructPublicConstructor(quote);
const result = new generated.Contract(witnesses).initialState(
  createConstructorContext({}, "00".repeat(32)),
  configuration,
);
const ledger = generated.ledger(
  ContractState.deserialize(result.currentContractState.serialize()).data,
);
const hex = (bytes) => {
  assert(bytes instanceof Uint8Array && bytes.length === 32);
  return Buffer.from(bytes).toString("hex");
};
const fingerprint = (kind, value) =>
  createHash("sha256")
    .update(JSON.stringify(["milo:admission-observation:v2", kind, value]))
    .digest("hex");
assert.equal(ledger.protocolVersion, 1n);
assert.equal(ledger.phase, generated.Phase.DEPLOYED);
assert.equal(ledger.revision, 0n);
assert.equal(hex(ledger.deliveryCommitment), "0".repeat(64));
assert.equal(hex(ledger.evidenceCommitment), "0".repeat(64));
assert.deepEqual(ledger.configuration, configuration);

// Retain the original observer fingerprint order, using decoded ledger values,
// independently of publicConstructorFingerprints and the synthetic fixture builder.
const config = ledger.configuration;
assert.equal(
  quote.rolesFingerprint,
  fingerprint("roles", [
    hex(config.buyerCommitment),
    hex(config.merchantCommitment),
    hex(config.operatorCommitment),
  ]),
);
assert.equal(
  quote.initialStateFingerprint,
  fingerprint("initial-ledger", [
    ledger.protocolVersion.toString(),
    ...[
      "network",
      "orderNonce",
      "termsCommitment",
      "buyerCommitment",
      "merchantCommitment",
      "operatorCommitment",
    ].map((key) => hex(config[key])),
    ...[
      "acceptanceDeadline",
      "deliveryDeadline",
      "reviewDeadline",
      "resolutionDeadline",
    ].map((key) => config[key].toString()),
    ledger.phase.toString(),
    ledger.revision.toString(),
    hex(ledger.deliveryCommitment),
    hex(ledger.evidenceCommitment),
  ]),
);
console.log(
  "Restart-reloaded Preprod quote matches decoded generated constructor and independent fingerprints (offline)",
);
