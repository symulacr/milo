// Preprod actions (v6): deploy, exhaustive circuit sweep, maintenance breaker.
// Every action records a receipt line; nothing is claimed that the chain did not
// confirm. Failures are recorded as rejections, which is the point of the
// negative cases. Secrets: the sampled maintenance key is written to the run
// directory (ignored, 0600) so the breaker drill can reuse it; the wallet seed
// never leaves the environment.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { witnesses } from "./order.mjs";

const GENERATED = resolve("packages/contract/generated");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const bytes32 = () => new Uint8Array(randomBytes(32));

/** A preprod-flavoured order with one private state per actor. */
function miloOrder(Contract) {
  const { pureCircuits, Role } = Contract;
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("preprod"));
  const nonce = bytes32();
  const secrets = {
    buyer: bytes32(),
    merchant: bytes32(),
    operator: bytes32(),
  };
  const terms = {
    serviceVersion: 1n,
    packQuantity: 1n,
    outputCount: 3n,
    unitPrice: 36_000n,
    total: 36_000n,
    currency: new TextEncoder().encode("USD"),
    scopeDigest: bytes32(),
    rightsDigest: bytes32(),
    paymentPolicy: bytes32(),
    salt: bytes32(),
  };
  const now = BigInt(Math.floor(Date.now() / 1000));
  // The expiry circuits need a deadline to have passed while the earlier phase
  // was reached first, so the runner waits on these absolute values.
  const deadlinesFor = (offsets = {}) => ({
    acceptance: now + BigInt(offsets.acceptance ?? 3_600),
    delivery: now + BigInt(offsets.delivery ?? 7_200),
    review: now + BigInt(offsets.review ?? 10_800),
    resolution: now + BigInt(offsets.resolution ?? 14_400),
  });
  return {
    terms,
    deadlinesFor,
    configurationFor: (offsets = {}) => {
      const d = deadlinesFor(offsets);
      return {
        network,
        orderNonce: nonce,
        termsCommitment: pureCircuits.hashTerms(network, nonce, terms),
        buyerCommitment: pureCircuits.hashCapability(
          network,
          nonce,
          Role.BUYER,
          secrets.buyer,
        ),
        merchantCommitment: pureCircuits.hashCapability(
          network,
          nonce,
          Role.MERCHANT,
          secrets.merchant,
        ),
        operatorCommitment: pureCircuits.hashCapability(
          network,
          nonce,
          Role.OPERATOR,
          secrets.operator,
        ),
        acceptanceDeadline: d.acceptance,
        deliveryDeadline: d.delivery,
        reviewDeadline: d.review,
        resolutionDeadline: d.resolution,
      };
    },
    privateState: (actor) => ({
      actor,
      secret: secrets[actor],
      terms,
      limit: 36_000n,
    }),
  };
}

async function compiledContract(Contract) {
  const { CompiledContract } = await import(
    "@midnight-ntwrk/midnight-js-protocol/compact-js"
  );
  return CompiledContract.withCompiledFileAssets(
    CompiledContract.withWitnesses(
      CompiledContract.make("milo", Contract),
      witnesses,
    ),
    GENERATED,
  );
}

async function maintenanceKey(config) {
  const path = resolve(config.runDir, "maintenance-key.json");
  try {
    const stored = JSON.parse(await readFile(path, "utf8"));
    return { path, key: stored.key, created: false };
  } catch {
    return { path, key: undefined, created: true };
  }
}

async function deployOrder({
  Contract,
  providers,
  configuration,
  privateStateFor,
  label,
  emit,
}) {
  const { deployContract } = await import(
    "@midnight-ntwrk/midnight-js-contracts"
  );
  const compiled = await compiledContract(Contract);
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    // The constructor takes the configuration: ContractConstructorOptionsWithArguments
    // requires `args` whenever the constructor has parameters.
    args: [configuration],
    privateStateId: `${label}-buyer`,
    initialPrivateState: privateStateFor("buyer"),
    ...(signingKey ? { signingKey } : {}),
  });
  const receipt = {
    event: "preprod-deployed",
    label,
    address: deployed.deployTxData.public.contractAddress,
    txId: deployed.deployTxData.public.txId,
    blockHeight: deployed.deployTxData.public.blockHeight,
    explorer: `${config.explorer}/contract/${deployed.deployTxData.public.contractAddress}`,
  };
  await emit(receipt);
  return deployed;
}

/** One call, recorded: a tx id on success, or a rejection with its message. */
async function attempt(emit, fields, call) {
  try {
    const result = await call();
    await emit({
      event: "call-finalized",
      ...fields,
      txId: result?.public?.txId,
      blockHeight: result?.public?.blockHeight,
    });
    return { ok: true, txId: result?.public?.txId };
  } catch (error) {
    await emit({
      event: "call-rejected",
      ...fields,
      errorNames: [error?.constructor?.name ?? "Error"],
      message: String(error?.message ?? error).slice(0, 400),
    });
    return { ok: false, message: String(error?.message ?? error) };
  }
}

const CIRCUITS = [
  { name: "reserve", args: (rev) => [rev] },
  { name: "accept", args: (rev) => [rev] },
  { name: "cancelReserved", args: (rev) => [rev] },
  { name: "decline", args: (rev) => [rev] },
  { name: "submitDelivery", args: (rev) => [rev, bytes32()] },
  { name: "approve", args: (rev, delivery) => [rev, delivery] },
  { name: "disputeBuyer", args: (rev) => [rev, bytes32()] },
  { name: "disputeMerchant", args: (rev) => [rev, bytes32()] },
  { name: "resolve", args: (rev) => [rev, true, bytes32()] },
  { name: "expireBootstrap", args: (rev) => [rev] },
  { name: "expireReserved", args: (rev) => [rev] },
  { name: "expireUndelivered", args: (rev) => [rev] },
  { name: "escalateUnreviewed", args: (rev) => [rev] },
  { name: "expireDispute", args: (rev) => [rev] },
];

/**
 * The sweep: one order per lifecycle branch, each deployed fresh so every
 * circuit runs from a legal phase, plus the negative cases that must be
 * rejected. Expiry circuits need past deadlines, which is why they get their
 * own deployments.
 */
async function sweep({ Contract, providers, config, emit }) {
  const order = miloOrder(Contract);
  const scenarios = [
    { label: "happy-path", offsets: {} },
    { label: "cancel", offsets: {} },
    { label: "decline", offsets: {} },
    { label: "dispute-buyer", offsets: {} },
    { label: "dispute-merchant", offsets: {} },
    { label: "expire-bootstrap", offsets: { acceptance: -60 } },
    { label: "expire-reserved", offsets: { acceptance: 300 } },
    {
      label: "expire-undelivered",
      offsets: { acceptance: 900, delivery: 420 },
    },
    {
      label: "escalate-unreviewed",
      offsets: { acceptance: 1200, delivery: 600, review: 660 },
    },
    {
      label: "expire-dispute",
      offsets: {
        acceptance: 1500,
        delivery: 700,
        review: 900,
        resolution: 960,
      },
    },
  ];
  // Coverage assertion: every proof circuit must appear in a positive scenario.
  const planned = new Set(
    scenarios.flatMap((scenario) =>
      scenarioSteps(scenario.label).map((step) => step.circuit),
    ),
  );
  for (const circuit of CIRCUITS.map((entry) => entry.name))
    assert(planned.has(circuit), `sweep does not cover ${circuit}`);

  const summary = [];
  for (const scenario of scenarios) {
    const deadlines = order.deadlinesFor(scenario.offsets);
    const deployed = await deployOrder({
      Contract,
      providers,
      config,
      configuration: order.configurationFor(scenario.offsets),
      privateStateFor: order.privateState,
      label: scenario.label,
      emit,
    });
    const actors = await handlesFor({
      deployed,
      Contract,
      providers,
      privateStateFor: order.privateState,
      label: scenario.label,
    });
    for (const step of scenarioSteps(scenario.label)) {
      if (step.waitFor) {
        const deadline = Number(deadlines[step.waitFor]);
        await emit({
          event: "waiting-for-deadline",
          scenario: scenario.label,
          circuit: step.circuit,
          deadline,
        });
        while (Math.floor(Date.now() / 1000) < deadline + 10)
          await new Promise((done) => setTimeout(done, 10_000));
      }
      await attempt(
        emit,
        {
          scenario: scenario.label,
          circuit: step.circuit,
          actor: step.actor,
          negative: false,
        },
        () =>
          actors[step.actor].callTx[step.circuit](
            step.revision,
            ...step.args(),
          ),
      );
    }
    summary.push({
      scenario: scenario.label,
      address: deployed.deployTxData.public.contractAddress,
    });
  }
  return summary;
}

function scenarioSteps(label) {
  switch (label) {
    case "happy-path":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "buyer", revision: 1n, args: () => [] },
        {
          circuit: "submitDelivery",
          actor: "merchant",
          revision: 2n,
          args: () => [bytes32()],
        },
        {
          circuit: "approve",
          actor: "buyer",
          revision: 3n,
          args: () => [bytes32()],
        },
      ];
    case "cancel":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        {
          circuit: "cancelReserved",
          actor: "buyer",
          revision: 1n,
          args: () => [],
        },
      ];
    case "decline":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "decline", actor: "merchant", revision: 1n, args: () => [] },
      ];
    case "dispute-buyer":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "buyer", revision: 1n, args: () => [] },
        {
          circuit: "disputeBuyer",
          actor: "buyer",
          revision: 2n,
          args: () => [bytes32()],
        },
        {
          circuit: "resolve",
          actor: "operator",
          revision: 3n,
          args: () => [false, bytes32()],
        },
      ];
    case "dispute-merchant":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "buyer", revision: 1n, args: () => [] },
        {
          circuit: "disputeMerchant",
          actor: "merchant",
          revision: 2n,
          args: () => [bytes32()],
        },
        {
          circuit: "resolve",
          actor: "operator",
          revision: 3n,
          args: () => [true, bytes32()],
        },
      ];
    case "expire-bootstrap":
      return [
        {
          circuit: "expireBootstrap",
          actor: "buyer",
          revision: 0n,
          args: () => [],
        },
      ];
    case "expire-reserved":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        {
          circuit: "expireReserved",
          actor: "buyer",
          revision: 1n,
          waitFor: "acceptance",
        },
      ];
    case "expire-undelivered":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "buyer", revision: 1n, args: () => [] },
        {
          circuit: "expireUndelivered",
          actor: "buyer",
          revision: 2n,
          waitFor: "delivery",
        },
      ];
    case "escalate-unreviewed":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "buyer", revision: 1n, args: () => [] },
        {
          circuit: "submitDelivery",
          actor: "merchant",
          revision: 2n,
          args: () => [bytes32()],
        },
        {
          circuit: "escalateUnreviewed",
          actor: "buyer",
          revision: 3n,
          waitFor: "review",
        },
      ];
    case "expire-dispute":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "buyer", revision: 1n, args: () => [] },
        {
          circuit: "disputeBuyer",
          actor: "buyer",
          revision: 2n,
          args: () => [bytes32()],
        },
        {
          circuit: "expireDispute",
          actor: "buyer",
          revision: 3n,
          waitFor: "resolution",
        },
      ];
    default:
      return [];
  }
}

async function handlesFor({
  deployed,
  Contract,
  providers,
  privateStateFor,
  label,
}) {
  const { findDeployedContract } = await import(
    "@midnight-ntwrk/midnight-js-contracts"
  );
  const compiled = await compiledContract(Contract);
  const address = deployed.deployTxData.public.contractAddress;
  const byActor = {};
  for (const actor of ["buyer", "merchant", "operator"]) {
    byActor[actor] = await findDeployedContract(providers, {
      contractAddress: address,
      compiledContract: compiled,
      privateStateId: `${label}-${actor}`,
      initialPrivateState: privateStateFor(actor),
    });
  }
  return byActor;
}

/** Negative cases: the calls that must be rejected, on a fresh order. */
async function negatives({ Contract, providers, config, emit }) {
  const order = miloOrder(Contract);
  const deployed = await deployOrder({
    Contract,
    providers,
    config,
    configuration: order.configurationFor({}),
    privateStateFor: order.privateState,
    label: "negatives",
    emit,
  });
  const actors = await handlesFor({
    deployed,
    Contract,
    providers,
    privateStateFor: order.privateState,
    label: "negatives",
  });
  const cases = [
    {
      circuit: "reserve",
      actor: "buyer",
      args: [9n],
      why: "revision mismatch",
    },
    {
      circuit: "reserve",
      actor: "merchant",
      args: [0n],
      why: "wrong role capability",
    },
    {
      circuit: "accept",
      actor: "buyer",
      args: [0n],
      why: "wrong phase (not reserved)",
    },
    {
      circuit: "approve",
      actor: "buyer",
      args: [0n, bytes32()],
      why: "wrong phase (no delivery)",
    },
    {
      circuit: "resolve",
      actor: "operator",
      args: [0n, true, bytes32()],
      why: "wrong phase (no dispute)",
    },
    {
      circuit: "expireDispute",
      actor: "buyer",
      args: [0n],
      why: "wrong phase (no dispute)",
    },
    {
      circuit: "submitDelivery",
      actor: "merchant",
      args: [0n, new Uint8Array(32)],
      why: "empty commitment",
    },
  ];
  const results = [];
  for (const testCase of cases) {
    const result = await attempt(
      emit,
      {
        scenario: "negatives",
        circuit: testCase.circuit,
        actor: testCase.actor,
        negative: true,
        why: testCase.why,
      },
      () => actors[testCase.actor].callTx[testCase.circuit](...testCase.args),
    );
    results.push({ ...testCase, rejected: !result.ok });
  }
  await emit({ event: "negatives-summary", results });
  return results;
}

/** The circuit breaker: the deployer's maintenance authority, exercised. */
async function breaker({ deployed, circuit, emit }) {
  const handle = deployed.circuitMaintenanceTx[circuit];
  assert(handle, `no maintenance interface for ${circuit}`);
  await attempt(emit, { breaker: "removeVerifierKey", circuit }, () =>
    handle.removeVerifierKey(),
  );
  return { circuit };
}

async function restore({ deployed, circuit, zkConfigProvider, emit }) {
  const verifierKey = await zkConfigProvider.getVerifierKey(circuit);
  await attempt(emit, { breaker: "insertVerifierKey", circuit }, () =>
    deployed.circuitMaintenanceTx[circuit].insertVerifierKey(verifierKey),
  );
  return { circuit };
}

async function freeze({ deployed, key, emit }) {
  const { sampleSigningKey } = await import(
    "@midnight-ntwrk/midnight-js-protocol/compact-runtime"
  );
  const next = key === "empty" ? sampleSigningKey() : key;
  await attempt(emit, { breaker: "replaceAuthority", to: key }, () =>
    deployed.contractMaintenanceTx.replaceAuthority(next),
  );
  return { to: key };
}

export async function run({
  mode,
  flags,
  config,
  providers,
  Contract,
  zkConfigProvider,
  emit,
}) {
  const keyPath = await maintenanceKey(config);
  const signingKey =
    keyPath.key ??
    (
      await import("@midnight-ntwrk/midnight-js-protocol/compact-runtime")
    ).sampleSigningKey();
  if (keyPath.created && !keyPath.key) {
    await mkdir(config.runDir, { recursive: true });
    await writeFile(keyPath.path, JSON.stringify({ key: hex(signingKey) }), {
      mode: 0o600,
    });
    await chmod(keyPath.path, 0o600);
  }
  const order = miloOrder(Contract);
  if (mode === "--deploy") {
    const deployed = await deployOrder({
      Contract,
      providers,
      config,
      signingKey,
      configuration: order.configurationFor({}),
      privateStateFor: order.privateState,
      label: "main",
      emit,
    });
    await emit({
      event: "maintenance-authority",
      note: "deployer holds a single-signature authority; key stored in the ignored run dir",
      keyPath,
    });
    return deployed.deployTxData.public.contractAddress;
  }
  if (mode === "--sweep") {
    const summary = await sweep({ Contract, providers, config, emit });
    const negativeResults = await negatives({
      Contract,
      providers,
      config,
      emit,
    });
    await emit({
      event: "sweep-complete",
      summary,
      negatives: negativeResults,
    });
    return summary;
  }
  // breaker modes operate on an existing deployment recorded in the run dir
  const deployments = await readFile(
    resolve(config.runDir, "transactions.jsonl"),
    "utf8",
  )
    .then((text) =>
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.event === "preprod-deployed"),
    )
    .catch(() => []);
  assert(
    deployments.length > 0,
    "deploy first: no preprod-deployed receipt in the run dir",
  );
  // The breaker targets the main deployment, never a sweep order.
  const main =
    deployments.filter((entry) => entry.label === "main").at(-1) ??
    deployments.at(-1);
  const address = main.address;
  const { findDeployedContract } = await import(
    "@midnight-ntwrk/midnight-js-contracts"
  );
  const deployed = await findDeployedContract(providers, {
    contractAddress: address,
    compiledContract: await compiledContract(Contract),
    privateStateId: "main-buyer",
    initialPrivateState: order.privateState("buyer"),
  });
  const circuit = flags[flags.indexOf(mode) + 1];
  if (mode === "--breaker") return breaker({ deployed, circuit, emit });
  if (mode === "--restore")
    return restore({ deployed, circuit, zkConfigProvider, emit });
  if (mode === "--freeze") return freeze({ deployed, key: circuit, emit });
  throw new Error(`unknown mode ${mode}`);
}
