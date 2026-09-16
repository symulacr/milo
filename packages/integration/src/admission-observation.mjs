import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
  reconstructPublicConstructor,
  validPublicConstructor,
} from "../../backend/src/public-constructor.mjs";
import { proofCircuits } from "./artifacts.mjs";
import {
  prepareBootstrap,
  requireCompletedLockedBootstrap,
} from "./bootstrap.mjs";
import { observeFinalizedContract } from "./maintenance-audit.mjs";
import { generated } from "./order.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fingerprint = (kind, value) =>
  sha256(JSON.stringify(["milo:admission-observation:v2", kind, value]));
const deadlineSeconds = (value) => {
  assert(
    typeof value === "bigint" &&
      value > 0n &&
      value <= BigInt(Number.MAX_SAFE_INTEGER),
    "Contract deadline cannot be represented by the admission policy",
  );
  return Number(value);
};
const hex32 = (bytes) => {
  assert(bytes instanceof Uint8Array && bytes.length === 32);
  return Buffer.from(bytes).toString("hex");
};
const ledgerOf = (state) =>
  generated.ledger(CompactState.deserialize(state.serialize()).data);
const ledgerFingerprint = (ledger) =>
  fingerprint("initial-ledger", [
    ledger.protocolVersion.toString(),
    ...[
      "network",
      "orderNonce",
      "termsCommitment",
      "buyerCommitment",
      "merchantCommitment",
      "operatorCommitment",
    ].map((key) => hex32(ledger.configuration[key])),
    ...[
      "acceptanceDeadline",
      "deliveryDeadline",
      "reviewDeadline",
      "resolutionDeadline",
    ].map((key) => ledger.configuration[key].toString()),
    ledger.phase.toString(),
    ledger.revision.toString(),
    hex32(ledger.deliveryCommitment),
    hex32(ledger.evidenceCommitment),
  ]);

// Internal tooling only. These hashes are observation provenance, not Compact commitments.
export function prepareAdmissionObserver({
  configuration,
  coinPublicKey,
  verifierKeys,
  artifactReceipt,
  genesisHash,
  networkId,
  lockCounter = 2n,
}) {
  assert.equal(networkId, "undeployed");
  assert.match(genesisHash, /^0x[0-9a-f]{64}$/);
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode(networkId));
  assert.deepEqual(
    configuration.network,
    network,
    "Quote network differs from local ledger network",
  );
  assert.equal(artifactReceipt.compiler, "0.31.1");
  assert.equal(artifactReceipt.runtime, "0.16.0");
  assert.equal(artifactReceipt.language, "0.23.0");
  assert.equal(
    artifactReceipt.artifactSetSha256,
    sha256(JSON.stringify(artifactReceipt.artifacts)),
  );
  for (const [name, bytes] of verifierKeys) {
    assert(proofCircuits.includes(name));
    assert.equal(
      sha256(bytes),
      artifactReceipt.artifacts[`keys/${name}.verifier`],
      "Verifier key differs from validated artifact receipt",
    );
  }
  // The independent expected constructor has no authority relationship to the deployed contract.
  const plan = prepareBootstrap({
    configuration: structuredClone(configuration),
    coinPublicKey,
    verifierKeys,
    signingKey: L.sampleSigningKey(),
    lockCounter,
  });
  const config = plan.expectedLedger.configuration;
  const expectedPolicy = Object.freeze({
    constructorVersion: 1,
    constructorEncoding: CONSTRUCTOR_ENCODING,
    buyerCommitment: hex32(config.buyerCommitment),
    merchantCommitment: hex32(config.merchantCommitment),
    operatorCommitment: hex32(config.operatorCommitment),
    network: networkId,
    nonce: hex32(config.orderNonce),
    termsCommitment: hex32(config.termsCommitment),
    artifactFingerprint: artifactReceipt.artifactSetSha256,
    keySetFingerprint: fingerprint(
      "verifier-keys",
      proofCircuits.map((name) => [name, sha256(plan.keys.get(name))]),
    ),
    rolesFingerprint: fingerprint("roles", [
      hex32(config.buyerCommitment),
      hex32(config.merchantCommitment),
      hex32(config.operatorCommitment),
    ]),
    initialStateFingerprint: ledgerFingerprint(plan.expectedLedger),
    genesisHash: genesisHash.slice(2),
    acceptanceDeadlineSeconds: deadlineSeconds(config.acceptanceDeadline),
    deliveryDeadlineSeconds: deadlineSeconds(config.deliveryDeadline),
    reviewDeadlineSeconds: deadlineSeconds(config.reviewDeadline),
    resolutionDeadlineSeconds: deadlineSeconds(config.resolutionDeadline),
  });
  assert.deepEqual(reconstructPublicConstructor(expectedPolicy), config);
  assert.deepEqual(publicConstructorFingerprints(expectedPolicy), {
    rolesFingerprint: expectedPolicy.rolesFingerprint,
    initialStateFingerprint: expectedPolicy.initialStateFingerprint,
  });
  return Object.freeze({
    expectedPolicy,
    async observe({
      address,
      rpc,
      indexer,
      observe,
      deadline,
      request,
      wait,
      now = Date.now,
    }) {
      assert.match(address, /^[0-9a-f]{64}$/);
      assert(Number.isSafeInteger(deadline) && deadline > now());
      assert.equal(
        await rpc("chain_getBlockHash", [0]),
        genesisHash,
        "Observation genesis mismatch",
      );
      const snapshot = await observeFinalizedContract({
        rpc,
        indexer,
        observe,
        address,
        deadline,
        request,
        wait,
        now,
      });
      requireCompletedLockedBootstrap(snapshot.state, plan);
      assert.equal(
        ledgerFingerprint(ledgerOf(snapshot.state)),
        expectedPolicy.initialStateFingerprint,
      );
      assert.equal(
        await rpc("chain_getBlockHash", [snapshot.blockHeight]),
        snapshot.blockHash,
        "Observed block is not on the expected chain",
      );
      assert.equal(
        await rpc("chain_getBlockHash", [0]),
        genesisHash,
        "Observation genesis changed",
      );
      const observedAt = now();
      assert(
        Number.isSafeInteger(observedAt) &&
          observedAt >= 0 &&
          observedAt < deadline,
        "Observation expired before validation completed",
      );
      const stateFingerprint = sha256(snapshot.state.serialize());
      const record = {
        observationVersion: 2,
        source: "chain-observer",
        ...expectedPolicy,
        address,
        phase: "DEPLOYED",
        revision: 0,
        entrypoints: [...proofCircuits],
        maintenancePolicy: "locked",
        blockHash: snapshot.blockHash.slice(2),
        blockHeight: snapshot.blockHeight,
        stateFingerprint,
        maintenanceReceiptFingerprint: fingerprint("locked-maintenance", [
          networkId,
          genesisHash,
          address,
          snapshot.blockHash,
          snapshot.blockHeight,
          stateFingerprint,
          [],
          1,
          plan.lockCounter.toString(),
        ]),
        observedAt,
      };
      return { id: fingerprint("record", record), ...record };
    },
  });
}

export function admissionObservationEvidence(observation) {
  return {
    observationVersion: observation.observationVersion,
    id: observation.id,
    address: observation.address,
    blockHash: observation.blockHash,
    blockHeight: observation.blockHeight,
    stateFingerprint: observation.stateFingerprint,
    artifactFingerprint: observation.artifactFingerprint,
    keySetFingerprint: observation.keySetFingerprint,
    maintenanceReceiptFingerprint: observation.maintenanceReceiptFingerprint,
    genesisHash: observation.genesisHash,
    observedAt: observation.observedAt,
    expectedPolicyMatched: true,
    immutableOrderAdmission: false,
    reservationExecuted: false,
  };
}

// Internal server composition, not an RPC handler or an admission/persistence authority.
export function createAdmissionObservationCoordinator({
  getFrozenQuote,
  observerOptions,
  observationOptions,
  timeoutMs = 30_000,
  now = Date.now,
  prepareObserver = prepareAdmissionObserver,
}) {
  assert.equal(typeof getFrozenQuote, "function");
  assert.equal(typeof prepareObserver, "function");
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  const trustedOptions = structuredClone(observerOptions);
  const transport = { ...observationOptions };
  return async (input) => {
    assert(input && Object.getPrototypeOf(input) === Object.prototype);
    assert.deepEqual(Reflect.ownKeys(input).sort(), ["address", "quoteId"]);
    const { quoteId, address } = input;
    assert(
      typeof quoteId === "string" &&
        quoteId.length > 0 &&
        quoteId.length <= 256,
    );
    assert(typeof address === "string" && /^[0-9a-f]{64}$/.test(address));
    const startedAt = now();
    const deadline = startedAt + timeoutMs;
    assert(Number.isSafeInteger(startedAt) && startedAt >= 0);
    assert(Number.isSafeInteger(deadline));
    // The loader must retrieve one persisted frozen version and its public constructor inputs.
    const loaded = await getFrozenQuote(quoteId);
    assert(loaded, "Frozen quote not found");
    const { quote, configuration: suppliedConfiguration } =
      structuredClone(loaded);
    assert.equal(quote.id, quoteId, "Frozen quote identity mismatch");
    assert(Number.isSafeInteger(quote.version) && quote.version > 0);
    assert(
      validPublicConstructor(quote),
      "Frozen quote policy mismatch: constructor",
    );
    const configuration = reconstructPublicConstructor(quote);
    if (suppliedConfiguration !== undefined)
      assert.deepEqual(
        suppliedConfiguration,
        configuration,
        "Frozen quote policy mismatch: configuration",
      );
    const observer = prepareObserver({ ...trustedOptions, configuration });
    const policy = structuredClone(observer.expectedPolicy);
    for (const [key, value] of Object.entries(policy)) {
      assert.equal(quote[key], value, `Frozen quote policy mismatch: ${key}`);
    }
    assert(now() < deadline, "Frozen quote retrieval expired");
    const observation = structuredClone(
      await observer.observe({
        ...transport,
        address,
        deadline,
        now,
      }),
    );
    for (const [key, value] of Object.entries(policy)) {
      assert.equal(observation[key], value, `Observed policy mismatch: ${key}`);
    }
    assert.equal(observation.address, address);
    assert.equal(observation.source, "chain-observer");
    assert.equal(observation.observationVersion, 2);
    assert.equal(observation.phase, "DEPLOYED");
    assert.equal(observation.revision, 0);
    assert.equal(observation.maintenancePolicy, "locked");
    assert.deepEqual(observation.entrypoints, proofCircuits);
    assert(
      Number.isSafeInteger(observation.blockHeight) &&
        observation.blockHeight >= 0,
    );
    for (const key of [
      "blockHash",
      "stateFingerprint",
      "maintenanceReceiptFingerprint",
    ]) {
      assert(
        typeof observation[key] === "string" &&
          /^[0-9a-f]{64}$/.test(observation[key]),
      );
    }
    const finishedAt = now();
    assert(
      Number.isSafeInteger(finishedAt) &&
        finishedAt >= startedAt &&
        finishedAt < deadline,
    );
    assert(
      Number.isSafeInteger(observation.observedAt) &&
        observation.observedAt >= startedAt &&
        observation.observedAt <= finishedAt,
    );
    const { id, ...record } = observation;
    assert.equal(
      id,
      fingerprint("record", record),
      "Observation identity mismatch",
    );
    return { quoteId, quoteVersion: quote.version, observation };
  };
}
