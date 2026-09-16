import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { decideCanonicalAdmission } from "../../backend/src/admission-policy.ts";
import {
  admissionObservationEvidence,
  createAdmissionObservationCoordinator,
  prepareAdmissionObserver,
} from "../src/admission-observation.mjs";
import { proofCircuits, validateArtifacts } from "../src/artifacts.mjs";
import { prepareBootstrap } from "../src/bootstrap.mjs";
import { artifacts, freshOrder } from "../src/order.mjs";

const artifactReceipt = await validateArtifacts();
const verifierKeys = await new NodeZkConfigProvider(artifacts).getVerifierKeys(
  proofCircuits,
);
const genesisHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const address = "c".repeat(64);
const coinPublicKey = "00".repeat(32);

function coordinatorFixture() {
  const f = fixture();
  const quote = { id: "quote-1", version: 1, ...f.observer.expectedPolicy };
  const options = {
    getFrozenQuote: async (id) => {
      assert.equal(id, quote.id);
      return { quote, configuration: f.inputs.configuration };
    },
    observerOptions: f.inputs,
    observationOptions: f.observeInputs,
    now: f.observeInputs.now,
    timeoutMs: 500,
  };
  return { ...f, quote, options, input: { quoteId: quote.id, address } };
}

test("trusted coordinator retrieves frozen inputs and returns native validated observation without binding", async () => {
  const f = coordinatorFixture();
  const result = await createAdmissionObservationCoordinator(f.options)(
    f.input,
  );
  assert.equal(result.quoteId, f.quote.id);
  assert.equal(result.quoteVersion, 1);
  assert.equal(result.observation.address, address);
  assert.equal(
    result.observation.initialStateFingerprint,
    f.quote.initialStateFingerprint,
  );
  assert(f.calls.length > 0);
  assert.equal(
    admissionObservationEvidence(result.observation).reservationExecuted,
    false,
  );
});

test("every frozen policy mismatch stops before network observation", async () => {
  const f = coordinatorFixture();
  for (const key of Object.keys(f.observer.expectedPolicy)) {
    const original = f.quote[key];
    f.quote[key] = typeof original === "number" ? original + 1 : `${original}x`;
    await assert.rejects(
      createAdmissionObservationCoordinator(f.options)(f.input),
      /Frozen quote policy mismatch/,
    );
    f.quote[key] = original;
  }
  assert.equal(f.calls.length, 0);
});

test("coordinator reconstructs generated constructor from persisted quote alone", async () => {
  const f = coordinatorFixture();
  const result = await createAdmissionObservationCoordinator({
    ...f.options,
    getFrozenQuote: async () => ({ quote: f.quote }),
  })(f.input);
  assert.equal(
    result.observation.initialStateFingerprint,
    f.quote.initialStateFingerprint,
  );
  assert.equal(result.observation.buyerCommitment, f.quote.buyerCommitment);
});

test("legacy quotes and conflicting separately supplied constructors fail before network I/O", async () => {
  const f = coordinatorFixture();
  for (const key of [
    "constructorVersion",
    "constructorEncoding",
    "buyerCommitment",
    "merchantCommitment",
    "operatorCommitment",
  ]) {
    const quote = { ...f.quote };
    delete quote[key];
    await assert.rejects(
      createAdmissionObservationCoordinator({
        ...f.options,
        getFrozenQuote: async () => ({ quote }),
      })(f.input),
      /Frozen quote policy mismatch/,
    );
  }
  const configuration = structuredClone(f.inputs.configuration);
  configuration.buyerCommitment = new Uint8Array(32).fill(7);
  await assert.rejects(
    createAdmissionObservationCoordinator({
      ...f.options,
      getFrozenQuote: async () => ({ quote: f.quote, configuration }),
    })(f.input),
    /Frozen quote policy mismatch/,
  );
  assert.equal(f.calls.length, 0);
});

test("coordinator rejects caller configuration, provenance, endpoints and runtime overrides before loading", async () => {
  const f = coordinatorFixture();
  let loads = 0;
  const run = createAdmissionObservationCoordinator({
    ...f.options,
    getFrozenQuote: async () => {
      loads++;
    },
  });
  for (const key of [
    "configuration",
    "expectedPolicy",
    "artifactFingerprint",
    "rpc",
    "indexer",
    "deadline",
    "now",
    "prepareObserver",
    "quoteVersion",
  ]) {
    await assert.rejects(run({ ...f.input, [key]: "untrusted" }));
  }
  await assert.rejects(run({ ...f.input, address: "invalid" }));
  assert.equal(loads, 0);
  assert.equal(f.calls.length, 0);
});

test("coordinator rejects missing, swapped, unversioned and expired frozen quote retrieval", async () => {
  const f = coordinatorFixture();
  for (const loaded of [
    undefined,
    { quote: { ...f.quote, id: "other" } },
    { quote: { ...f.quote, version: 0 } },
  ]) {
    await assert.rejects(
      createAdmissionObservationCoordinator({
        ...f.options,
        getFrozenQuote: async () => loaded,
      })(f.input),
    );
  }
  let time = 1500;
  await assert.rejects(
    createAdmissionObservationCoordinator({
      ...f.options,
      now: () => time,
      getFrozenQuote: async () => {
        time = 2000;
        return { quote: f.quote, configuration: f.inputs.configuration };
      },
    })(f.input),
    /retrieval expired/,
  );
  assert.equal(f.calls.length, 0);
});

test("coordinator revalidates records even with explicit test observer doubles", async () => {
  const f = coordinatorFixture();
  const valid = await f.observer.observe(f.observeInputs);
  for (const patch of [
    { address: "d".repeat(64) },
    { nonce: "e".repeat(64) },
    { revision: 1 },
    { maintenancePolicy: "mutable" },
    { blockHeight: -1 },
    { blockHash: "invalid" },
    { observedAt: 1499 },
    { observedAt: 2000 },
    { id: "forged" },
    { entrypoints: [] },
    { source: "caller" },
    { observationVersion: 1 },
  ]) {
    const candidate = { ...valid, ...patch };
    if (!Object.hasOwn(patch, "id")) {
      const { id: _, ...record } = candidate;
      candidate.id = createHash("sha256")
        .update(
          JSON.stringify(["milo:admission-observation:v2", "record", record]),
        )
        .digest("hex");
    }
    await assert.rejects(
      createAdmissionObservationCoordinator({
        ...f.options,
        prepareObserver: () => ({
          expectedPolicy: f.observer.expectedPolicy,
          observe: async () => candidate,
        }),
      })(f.input),
      { name: "AssertionError" },
    );
  }
});
const lockedState = (
  plan,
  names = proofCircuits,
  committee = [],
  counter = 2n,
) => {
  const state = new L.ContractState();
  state.data = plan.initial.data;
  state.maintenanceAuthority = new L.ContractMaintenanceAuthority(
    committee,
    1,
    counter,
  );
  for (const name of names) {
    const operation = new L.ContractOperation();
    operation.verifierKey = plan.keys.get(name);
    state.setOperation(name, operation);
  }
  return state;
};
function fixture() {
  const configuration = freshOrder().configuration;
  const plan = prepareBootstrap({
    configuration,
    coinPublicKey,
    verifierKeys,
    signingKey: L.sampleSigningKey(),
  });
  const inputs = {
    configuration,
    coinPublicKey,
    verifierKeys,
    artifactReceipt,
    genesisHash,
    networkId: "undeployed",
  };
  const observer = prepareAdmissionObserver(inputs);
  const state = lockedState(plan);
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "chain_getBlockHash")
      return params[0] === 0 ? genesisHash : blockHash;
    if (method === "chain_getFinalizedHead") return blockHash;
    if (method === "chain_getHeader") return { number: "0x20" };
    if (method === "midnight_contractState") {
      assert.deepEqual(params, [address, blockHash]);
      return Buffer.from(state.serialize()).toString("hex");
    }
    throw new Error("Unexpected RPC method");
  };
  const observeInputs = {
    address,
    rpc,
    indexer: "http://127.0.0.1:8088/api/v3/graphql",
    deadline: 2_000,
    now: () => 1_500,
    request: async () => ({
      ok: true,
      json: async () => ({
        data: { block: { height: 32, hash: blockHash.slice(2) } },
      }),
    }),
    observe: async (actualAddress) => {
      assert.equal(actualAddress, address);
      return state;
    },
  };
  return { inputs, observer, plan, state, calls, observeInputs };
}

test("admission observer binds independently expected state and keys to node/indexer block identity", async () => {
  const f = fixture();
  const record = await f.observer.observe(f.observeInputs);
  for (const [key, value] of Object.entries(f.observer.expectedPolicy))
    assert.equal(record[key], value);
  assert.equal(record.address, address);
  assert.equal(record.blockHash, blockHash.slice(2));
  assert.equal(record.genesisHash, genesisHash.slice(2));
  assert.equal(record.blockHeight, 32);
  assert.equal(record.observedAt, 1_500);
  assert.equal(record.observationVersion, 2);
  for (const name of ["acceptance", "delivery", "review", "resolution"]) {
    assert.equal(
      BigInt(record[`${name}DeadlineSeconds`]),
      f.plan.expectedLedger.configuration[`${name}Deadline`],
    );
  }
  assert.equal(record.phase, "DEPLOYED");
  assert.deepEqual(record.entrypoints, proofCircuits);
  for (const key of [
    "id",
    "stateFingerprint",
    "maintenanceReceiptFingerprint",
    "initialStateFingerprint",
    "keySetFingerprint",
    "rolesFingerprint",
  ])
    assert.match(record[key], /^[0-9a-f]{64}$/);
  assert.equal(
    f.calls.filter(
      (call) => call.method === "chain_getBlockHash" && call.params[0] === 0,
    ).length,
    2,
  );
  assert(f.calls.every((call) => !/submit|send/i.test(call.method)));
  const evidence = admissionObservationEvidence({
    ...record,
    signingKey: "private-canary",
    privateState: { witness: "private-canary" },
    rawTransaction: "private-canary",
  });
  assert.deepEqual(
    Object.keys(evidence).sort(),
    [
      "observationVersion",
      "id",
      "address",
      "blockHash",
      "blockHeight",
      "stateFingerprint",
      "artifactFingerprint",
      "keySetFingerprint",
      "maintenanceReceiptFingerprint",
      "genesisHash",
      "observedAt",
      "expectedPolicyMatched",
      "immutableOrderAdmission",
      "reservationExecuted",
    ].sort(),
  );
  assert(!JSON.stringify(evidence).includes("private-canary"));
  assert.equal(evidence.immutableOrderAdmission, false);
  assert.equal(evidence.reservationExecuted, false);
  assert(!Object.hasOwn(evidence, "nonce"));
  assert(!Object.hasOwn(evidence, "termsCommitment"));
  assert(!Object.hasOwn(evidence, "configuration"));
  assert(!Object.hasOwn(evidence, "state"));
  assert(!Object.hasOwn(evidence, "resolutionDeadlineSeconds"));
});

test("actual observer record interoperates with backend policy, but cannot replace payment/auth/persistence", async () => {
  const f = fixture();
  const record = await f.observer.observe(f.observeInputs);
  const quote = {
    id: "synthetic-quote",
    version: 1,
    amountMinor: 100,
    currency: "USD",
    buyerAccountId: "synthetic-buyer",
    ...f.observer.expectedPolicy,
  };
  const timingPolicy = { captureSafetyMarginMs: 60_000 };
  const requiredCaptureWindowEnd =
    quote.resolutionDeadlineSeconds * 1_000 +
    timingPolicy.captureSafetyMarginMs;
  const authorization = {
    id: "synthetic-authorization",
    source: "payment-observer",
    status: "authorized",
    quoteId: quote.id,
    quoteVersion: 1,
    buyerAccountId: quote.buyerAccountId,
    amountMinor: 100,
    currency: "USD",
    usableFrom: 1_000,
    usableUntil: 2_000,
    captureBeforeMs: requiredCaptureWindowEnd + 1,
    providerReceiptFingerprint: "d".repeat(64),
  };
  let payment;
  let buyer;
  let bound;
  let writes = 0;
  // Explicit in-memory transaction double: never used by the native diagnostic.
  const repository = {
    transact: (operation) =>
      operation({
        authenticatedAccountId: () => buyer,
        serverNow: () => 1_500,
        getAdmissionTimingPolicy: (network) => {
          assert.equal(network, quote.network);
          return timingPolicy;
        },
        getFrozenQuote: () => quote,
        getCurrentPaymentAuthorization: () => payment,
        getObservedDeployment: () => record,
        getBinding: () => bound,
        getBindingByAddress: () => bound,
        getBindingByQuote: () => bound,
        insertBinding: (value) => {
          writes++;
          bound = value;
        },
      }),
  };
  const input = {
    quoteId: quote.id,
    observationId: record.id,
    authorizationId: authorization.id,
    address,
  };
  assert.equal(decideCanonicalAdmission(repository, input).kind, "rejected");
  payment = authorization;
  assert.equal(decideCanonicalAdmission(repository, input).kind, "rejected");
  buyer = quote.buyerAccountId;
  for (const expiry of [
    requiredCaptureWindowEnd - 1,
    requiredCaptureWindowEnd,
  ]) {
    payment = { ...authorization, captureBeforeMs: expiry };
    assert.equal(decideCanonicalAdmission(repository, input).kind, "rejected");
    assert.equal(writes, 0);
  }
  payment = authorization;
  assert.equal(decideCanonicalAdmission(repository, input).kind, "bound");
  assert.equal(
    decideCanonicalAdmission(repository, input).kind,
    "already-bound",
  );
  assert.equal(writes, 1);
  quote.rolesFingerprint = "e".repeat(64);
  assert.equal(decideCanonicalAdmission(repository, input).kind, "rejected");
});

test("observer binds every immutable deadline and refuses unsafe policy timestamp conversion", async () => {
  const f = fixture();
  for (const name of ["acceptance", "delivery", "review", "resolution"]) {
    const field = `${name}Deadline`;
    const alteredPlan = prepareBootstrap({
      configuration: {
        ...f.inputs.configuration,
        [field]: f.inputs.configuration[field] + 1n,
      },
      coinPublicKey,
      verifierKeys,
      signingKey: L.sampleSigningKey(),
    });
    const state = lockedState(alteredPlan);
    await assert.rejects(
      f.observer.observe({
        ...f.observeInputs,
        rpc: (method, params) =>
          method === "midnight_contractState"
            ? Buffer.from(state.serialize()).toString("hex")
            : f.observeInputs.rpc(method, params),
        observe: async () => state,
      }),
    );
  }
  assert.throws(
    () =>
      prepareAdmissionObserver({
        ...f.inputs,
        configuration: {
          ...f.inputs.configuration,
          resolutionDeadline: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        },
      }),
    /deadline cannot be represented/,
  );
});

test("observer refuses incomplete, mutable, swapped-key, cross-order and wrong-counter deployments", async () => {
  for (const mutate of [
    (f) => lockedState(f.plan, proofCircuits.slice(1)),
    (f) => lockedState(f.plan, proofCircuits, [f.plan.signer]),
    (f) => lockedState(f.plan, proofCircuits, [], 3n),
    (f) => {
      const state = lockedState(f.plan);
      const op = new L.ContractOperation();
      op.verifierKey = f.plan.keys.get("accept");
      state.setOperation("reserve", op);
      return state;
    },
    () => fixture().state,
  ]) {
    const f = fixture();
    const changed = mutate(f);
    await assert.rejects(
      f.observer.observe({
        ...f.observeInputs,
        rpc: (method, params) =>
          method === "midnight_contractState"
            ? Buffer.from(changed.serialize()).toString("hex")
            : f.observeInputs.rpc(method, params),
        observe: async () => changed,
      }),
    );
  }
});

test("observer refuses mismatched genesis, canonical block, indexer identity/state and expired reads", async () => {
  const f = fixture();
  const wrongHash = `0x${"f".repeat(64)}`;
  await assert.rejects(
    f.observer.observe({
      ...f.observeInputs,
      rpc: (method, params) =>
        method === "chain_getBlockHash"
          ? wrongHash
          : f.observeInputs.rpc(method, params),
    }),
    /genesis mismatch/,
  );
  let genesisReads = 0;
  await assert.rejects(
    f.observer.observe({
      ...f.observeInputs,
      rpc: (method, params) => {
        if (
          method === "chain_getBlockHash" &&
          params[0] === 0 &&
          ++genesisReads > 1
        )
          return wrongHash;
        return f.observeInputs.rpc(method, params);
      },
    }),
    /genesis changed/,
  );
  await assert.rejects(
    f.observer.observe({
      ...f.observeInputs,
      rpc: (method, params) =>
        method === "chain_getBlockHash" && params[0] === 32
          ? wrongHash
          : f.observeInputs.rpc(method, params),
    }),
    /expected chain/,
  );
  await assert.rejects(
    f.observer.observe({
      ...f.observeInputs,
      request: async () => ({
        ok: true,
        json: async () => ({
          data: { block: { height: 32, hash: wrongHash } },
        }),
      }),
    }),
  );
  await assert.rejects(
    f.observer.observe({
      ...f.observeInputs,
      observe: async () => fixture().state,
    }),
    /state mismatch/,
  );
  let time = 1_500;
  await assert.rejects(
    f.observer.observe({
      ...f.observeInputs,
      now: () => time,
      observe: async () => {
        time = 2_000;
        return f.state;
      },
    }),
    /expired/,
  );
});

test("observer expectation refuses network/artifact substitution and is detached from input mutations", async () => {
  const f = fixture();
  assert.throws(() =>
    prepareAdmissionObserver({ ...f.inputs, networkId: "testnet" }),
  );
  assert.throws(() =>
    prepareAdmissionObserver({
      ...f.inputs,
      configuration: { ...f.inputs.configuration, network: new Uint8Array(32) },
    }),
  );
  assert.throws(() =>
    prepareAdmissionObserver({
      ...f.inputs,
      artifactReceipt: {
        ...artifactReceipt,
        artifactSetSha256: "f".repeat(64),
      },
    }),
  );
  assert.throws(() =>
    prepareAdmissionObserver({
      ...f.inputs,
      verifierKeys: verifierKeys.map(([name, bytes]) => [
        name,
        name === "reserve" ? new Uint8Array([0]) : bytes,
      ]),
    }),
  );
  f.inputs.configuration.orderNonce.fill(0);
  f.inputs.configuration.resolutionDeadline += 10n;
  const record = await f.observer.observe(f.observeInputs);
  assert.equal(record.nonce, f.observer.expectedPolicy.nonce);
  assert.notEqual(record.nonce, "0".repeat(64));
  assert.equal(
    record.resolutionDeadlineSeconds,
    f.observer.expectedPolicy.resolutionDeadlineSeconds,
  );
  assert.notEqual(
    BigInt(record.resolutionDeadlineSeconds),
    f.inputs.configuration.resolutionDeadline,
  );
});

test("observer accepts the separately configured counter-three maintenance-controls sequence", async () => {
  const f = fixture();
  const observer = prepareAdmissionObserver({ ...f.inputs, lockCounter: 3n });
  const state = lockedState(f.plan, proofCircuits, [], 3n);
  const record = await observer.observe({
    ...f.observeInputs,
    rpc: (method, params) =>
      method === "midnight_contractState"
        ? Buffer.from(state.serialize()).toString("hex")
        : f.observeInputs.rpc(method, params),
    observe: async () => state,
  });
  assert.equal(
    record.initialStateFingerprint,
    observer.expectedPolicy.initialStateFingerprint,
  );
  assert.equal(record.maintenancePolicy, "locked");
});

test("observer freezes key bytes and artifact provenance before asynchronous observation", async () => {
  const f = fixture();
  const inputs = {
    ...f.inputs,
    verifierKeys: structuredClone(verifierKeys),
    artifactReceipt: structuredClone(artifactReceipt),
  };
  const observer = prepareAdmissionObserver(inputs);
  inputs.verifierKeys[0][1].fill(0);
  inputs.verifierKeys.pop();
  inputs.artifactReceipt.artifactSetSha256 = "f".repeat(64);
  inputs.artifactReceipt.artifacts["keys/reserve.verifier"] = "f".repeat(64);
  const record = await observer.observe(f.observeInputs);
  assert.equal(record.artifactFingerprint, artifactReceipt.artifactSetSha256);
  assert.equal(
    record.keySetFingerprint,
    f.observer.expectedPolicy.keySetFingerprint,
  );
});
