// Preprod actions (v6): deploy, exhaustive circuit sweep, maintenance breaker.
// Every action records a receipt line; nothing is claimed that the chain did not
// confirm. Failures are recorded as rejections, which is the point of the
// negative cases. Secrets: the sampled maintenance key is written to the run
// directory (ignored, 0600) so the breaker drill can reuse it; the wallet seed
// never leaves the environment.
//
// Maintenance modes (--breaker/--restore/--freeze) deliberately do NOT go through
// findDeployedContract: it unconditionally runs verifyContractState, which throws
// while any circuit's verifier key is missing - the exact state --restore repairs -
// and it stores the supplied initialPrivateState, overwriting the deployment's
// recorded `main-buyer` state. Instead the handles are built straight from the
// contract address with createCircuitMaintenanceTxInterfaces /
// createContractMaintenanceTxInterface (no verification, no private state). An
// empty maintenance authority cannot be expressed through replaceAuthority (an
// omitted key samples a random one), so --freeze empty uses the same lower-level
// ledger MaintenanceUpdate route bootstrap.mjs uses.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "./artifacts.mjs";
import { publicReceipt } from "./config.mjs";
import { witnesses } from "./order.mjs";
import { intentExpiry, maintenanceTx } from "./tx.mjs";

const GENERATED = resolve("packages/contract/generated");

const bytes32 = () => new Uint8Array(randomBytes(32));

/** A preprod-flavoured order with one private state per actor. Exported so the staged deploy
 * can build the SAME order the drills will drive: if the constructor gets one order and the
 * driver another, the commitments have no matching private state and every call fails. */
export function miloOrder(Contract) {
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
    // Stored verbatim. SigningKey is a plain hex STRING whose decoded byte length must be
    // 32..=35 (platform-js SigningKey.js: ConstrainedPlainHex({ byteLength: '32..=35' })), so
    // sampleSigningKey()'s 64-character hex value is already the right shape. Hex-encoding it
    // on write doubled it to 128 characters and deployContract failed with InvalidData at
    // keys.signing. `key: null` is the truthful record left by `--freeze empty` (control
    // relinquished), so it reads back as "no key" rather than a usable one.
    return { path, key: stored.key ?? undefined, created: false };
  } catch {
    return { path, key: undefined, created: true };
  }
}

/**
 * Persist the operator signing key the driver last used, 0600. Called after a
 * successful `--freeze`, so the recorded key follows the on-chain authority
 * instead of going stale, and with `{ key: null, relinquished: true }` after a
 * `--freeze empty`.
 */
async function writeMaintenanceKey(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record), { mode: 0o600 });
  await chmod(path, 0o600);
}

/**
 * One per-scenario deployment, through the staged path.
 *
 * midnight-js `deployContract` puts all fourteen verifier keys in one
 * transaction; Preprod rejects that with 1010 (block limits). The lane's
 * `--deploy` branch already avoids it by deploying seven keys and installing
 * the other seven with one signed maintenance update (staged-deploy.mjs), so
 * every per-scenario deploy reuses that same working path. Each scenario writes
 * its own receipt (`staged-deploy-<label>.json`), so a re-run resumes the
 * scenario instead of redeploying it.
 *
 * A PER-SCENARIO deployment is never labelled `main`: the maintenance drills
 * target the run's real main deployment, so the `preprod-deployed` line
 * staged-deploy.mjs emits internally (hardcoded `main`) is captured and
 * re-emitted under the scenario's own label once all fourteen circuits are
 * confirmed. The returned shape keeps the callers' contract:
 * `deployTxData.public.contractAddress` plus a top-level txId and blockHeight.
 */
async function deployOrder({
  providers,
  config,
  zkConfigProvider,
  configuration,
  privateStateFor,
  label,
  // The caller supplies the maintenance signing key; without it in scope the spread below
  // threw ReferenceError and the deploy never reached the network.
  signingKey,
  emit,
}) {
  const { submitTxAsync } = await import(
    "@midnight-ntwrk/midnight-js-contracts"
  );
  const { runStagedDeploy } = await import("./staged-deploy.mjs");
  const receiptPath = resolve(config.runDir, `staged-deploy-${label}.json`);
  let landed = null;
  const stagedEmit = async (event, fields = {}) => {
    if (event === "preprod-deployed") {
      landed = fields;
      return;
    }
    await emit({ event, ...fields });
  };
  const receipt = await runStagedDeploy({
    // The lane carries networkId on config; the local drill sets it process-wide instead
    // and only supplies { runDir, explorer }, so fall back to the global.
    networkId: config.networkId ?? getNetworkId(),
    configuration,
    coinPublicKey: providers.walletProvider.getCoinPublicKey(),
    verifierKeys: await zkConfigProvider.getVerifierKeys(proofCircuits),
    signingKey,
    // submitTxAsync, not submitTx: Preprod closes the relay subscription submitTx waits on
    // with 1000 Normal Closure, so the transaction lands while the promise never resolves.
    // Confirmation comes from the observed ledger state, not from the submit receipt.
    //
    // The Preprod lane's submitter returns a 0x-prefixed extrinsic hash; the local drill's
    // wallet facade returns the ledger transaction id as bare hex (TransactionId = string,
    // no 0x). publicReceipt recognises only the 0x form, so normalise the bare form to it.
    // This is never a finality claim: publicReceipt's string branch records status
    // "Submitted", and runStagedDeploy confirms by observing the ledger state.
    submit: async (unprovenTx) => {
      const txId = await submitTxAsync(providers, { unprovenTx });
      return typeof txId === "string" && !txId.startsWith("0x")
        ? `0x${txId}`
        : txId;
    },
    observe: (address, blockHash) =>
      blockHash
        ? providers.publicDataProvider.queryContractState(address, {
            type: "blockHash",
            blockHash,
          })
        : providers.publicDataProvider.queryContractState(address),
    emit: stagedEmit,
    receiptPath,
    explorer: config.explorer,
    onDeployed: async ({ address }) => {
      // The driver acts as buyer, merchant and operator and looks each actor up under
      // `<label>-<actor>` with findDeployedContract. Store the SAME order the constructor
      // received, or the deployed commitments have no matching private state and every
      // scenario call fails.
      providers.privateStateProvider.setContractAddress(address);
      for (const actor of ["buyer", "merchant", "operator"])
        await providers.privateStateProvider.set(
          `${label}-${actor}`,
          privateStateFor(actor),
        );
    },
  });
  const deploy = receipt.deploy ?? landed ?? {};
  const txId = deploy.txId ?? null;
  const blockHeight = deploy.blockHeight ?? null;
  await emit({
    event: "preprod-deployed",
    label,
    address: receipt.address,
    txId,
    blockHeight,
    explorer: `${config.explorer}/contract/${receipt.address}`,
    ...(receipt.split?.initialNames
      ? {
          split: `${receipt.split.initialNames.length}+${receipt.split.remainingNames.length}`,
        }
      : {}),
  });
  return {
    deployTxData: {
      public: { contractAddress: receipt.address, txId, blockHeight },
    },
    // attempt() reads the top-level fields for its call-finalized receipt.
    txId,
    blockHeight,
    stagedDeploy: receipt,
  };
}

/** One call, recorded: a tx id on success, or a rejection with its message. */
async function attempt(emit, fields, call) {
  try {
    const result = await call();
    // deployContract returns FinalizedTxData nested under `.public`; the maintenance
    // interfaces and the ledger-route submitTx return FinalizedTxData at the top
    // level. Read both so every maintenance receipt carries the real txId and block
    // height instead of recording none.
    const txId = result?.public?.txId ?? result?.txId;
    const blockHeight = result?.public?.blockHeight ?? result?.blockHeight;
    await emit({ event: "call-finalized", ...fields, txId, blockHeight });
    return { ok: true, txId, blockHeight, value: result };
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
async function sweep({
  Contract,
  providers,
  config,
  zkConfigProvider,
  signingKey,
  emit,
}) {
  const order = miloOrder(Contract);
  const scenarios = [
    { label: "happy-path", offsets: {} },
    { label: "cancel", offsets: {} },
    { label: "decline", offsets: {} },
    { label: "dispute-buyer", offsets: {} },
    { label: "dispute-merchant", offsets: {} },
    { label: "expire-bootstrap", offsets: { acceptance: -60 } },
    { label: "expire-reserved", offsets: { acceptance: 300 } },
    // The deadline fields must ascend: the constructor asserts
    // acceptance < delivery < review < resolution (order.compact:77). These three scenarios
    // previously assigned their values to the wrong fields, inverting the order, so they
    // failed with "unordered deadlines" before reaching the circuit they exist to exercise.
    // Each scenario's values are unchanged, only placed in ascending order, and the largest
    // value is the deadline that scenario waits for.
    {
      label: "expire-undelivered",
      offsets: { acceptance: 420, delivery: 900 },
    },
    {
      label: "escalate-unreviewed",
      offsets: { acceptance: 600, delivery: 660, review: 1200 },
    },
    {
      label: "expire-dispute",
      offsets: {
        acceptance: 700,
        delivery: 900,
        review: 960,
        resolution: 1500,
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
  // Deadline ordering assertion: the constructor asserts
  // acceptance < delivery < review < resolution, so a scenario whose offsets invert them
  // dies with "unordered deadlines" before reaching the circuit it exists to exercise.
  // Three scenarios did exactly that until the offsets were reordered.
  for (const scenario of scenarios) {
    const d = order.deadlinesFor(scenario.offsets);
    assert(
      d.acceptance < d.delivery &&
        d.delivery < d.review &&
        d.review < d.resolution,
      `scenario ${scenario.label} has unordered deadlines: ` +
        `${d.acceptance} ${d.delivery} ${d.review} ${d.resolution}`,
    );
  }

  const summary = [];
  for (const scenario of scenarios) {
    const deadlines = order.deadlinesFor(scenario.offsets);
    // The scenario deploy is the one call that can abort the whole sweep; record it
    // through attempt() too, so a rejected deploy leaves a receipt naming the
    // scenario instead of only stderr.
    const deployment = await attempt(
      emit,
      {
        scenario: scenario.label,
        circuit: "deploy",
        actor: null,
        negative: false,
      },
      () =>
        deployOrder({
          providers,
          config,
          zkConfigProvider,
          configuration: order.configurationFor(scenario.offsets),
          privateStateFor: order.privateState,
          label: scenario.label,
          signingKey,
          emit,
        }),
    );
    if (!deployment.ok) {
      summary.push({
        scenario: scenario.label,
        deployed: false,
        error: deployment.message,
      });
      continue;
    }
    const deployed = deployment.value;
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
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
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
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
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
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
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
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
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
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
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
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
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
async function negatives({
  Contract,
  providers,
  config,
  zkConfigProvider,
  signingKey,
  emit,
}) {
  const order = miloOrder(Contract);
  const deployment = await attempt(
    emit,
    { scenario: "negatives", circuit: "deploy", actor: null, negative: false },
    () =>
      deployOrder({
        providers,
        config,
        zkConfigProvider,
        configuration: order.configurationFor({}),
        privateStateFor: order.privateState,
        label: "negatives",
        signingKey,
        emit,
      }),
  );
  if (!deployment.ok) {
    await emit({
      event: "negatives-summary",
      results: [],
      deployFailed: true,
      error: deployment.message,
    });
    return [];
  }
  const deployed = deployment.value;
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
      actor: "merchant",
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

/**
 * Maintenance handles built from the contract address alone.
 *
 * findDeployedContract is deliberately avoided. It runs verifyContractState
 * unconditionally, so it throws ContractTypeError while any circuit's verifier key is
 * missing - exactly the state --restore exists to repair - and it stores the private
 * state passed to it, overwriting the deployment's recorded state. These two
 * factories take only (providers, compiledContract, address): they verify no circuit
 * set and touch no private state, reading the signing key the private state provider
 * stored under the address at deploy time. bootstrap.mjs uses the same lower-level
 * ledger MaintenanceUpdate route, kept here for the one update midnight-js cannot
 * express (an empty authority).
 */
async function maintenanceHandles(providers, compiled, address) {
  const {
    createCircuitMaintenanceTxInterfaces,
    createContractMaintenanceTxInterface,
  } = await import("@midnight-ntwrk/midnight-js-contracts");
  return {
    circuitMaintenanceTx: createCircuitMaintenanceTxInterfaces(
      providers,
      compiled,
      address,
    ),
    contractMaintenanceTx: createContractMaintenanceTxInterface(
      providers,
      compiled,
      address,
    ),
  };
}

/** The circuit breaker: the deployer's maintenance authority, exercised. */
async function breaker({ circuitMaintenanceTx, circuit, emit }) {
  const handle = circuitMaintenanceTx[circuit];
  assert(handle, `no maintenance interface for ${circuit}`);
  const result = await attempt(
    emit,
    { breaker: "removeVerifierKey", circuit },
    () => handle.removeVerifierKey(),
  );
  return { circuit, ...result };
}

async function restore({
  circuitMaintenanceTx,
  circuit,
  zkConfigProvider,
  emit,
}) {
  const handle = circuitMaintenanceTx[circuit];
  assert(handle, `no maintenance interface for ${circuit}`);
  const verifierKey = await zkConfigProvider.getVerifierKey(circuit);
  const result = await attempt(
    emit,
    { breaker: "insertVerifierKey", circuit },
    () => handle.insertVerifierKey(verifierKey),
  );
  return { circuit, ...result };
}

/**
 * Hand over (`<key>`) or relinquish (`empty`) maintenance control.
 *
 * `empty` cannot go through midnight-js replaceAuthority: an omitted key samples a
 * random one, which is the defect this replaces. It builds the ledger's empty
 * authority directly - no committee members and threshold 1, which no signature set
 * can satisfy (the same shape bootstrapMaintenance's lock uses) - signs the update
 * with the current authority and submits the staged transaction.
 */
async function freeze({
  providers,
  contractMaintenanceTx,
  address,
  key,
  keyPath,
  networkId,
  emit,
}) {
  if (key === undefined) {
    const message = "--freeze requires a signing key hex or 'empty'";
    await emit({
      event: "call-rejected",
      breaker: "replaceAuthority",
      to: null,
      errorNames: ["Error"],
      message,
    });
    throw new Error(message);
  }
  if (key === "empty") {
    const state =
      await providers.publicDataProvider.queryContractState(address);
    assert(state, `no contract state on chain for ${address}`);
    const currentKey =
      await providers.privateStateProvider.getSigningKey(address);
    assert(currentKey, `no signing key stored for contract ${address}`);
    const counter = state.maintenanceAuthority.counter;
    const { submitTx } = await import("@midnight-ntwrk/midnight-js-contracts");
    const result = await attempt(
      emit,
      {
        breaker: "replaceAuthority",
        to: "empty",
        relinquished: true,
        committeeSize: 0,
        threshold: 1,
        counter: String(counter),
      },
      async () => {
        let update = new L.MaintenanceUpdate(
          address,
          [
            new L.ReplaceAuthority(
              new L.ContractMaintenanceAuthority([], 1, counter + 1n),
            ),
          ],
          counter,
        );
        update = update.addSignature(
          0n,
          L.signData(currentKey, update.dataToSign),
        );
        return publicReceipt(
          await submitTx(providers, {
            unprovenTx: maintenanceTx(networkId, update, intentExpiry()),
          }),
        );
      },
    );
    if (result.ok)
      await writeMaintenanceKey(keyPath.path, {
        key: null,
        relinquished: true,
      });
    return { to: "empty", relinquished: true, ...result };
  }
  const result = await attempt(
    emit,
    { breaker: "replaceAuthority", to: key },
    () => contractMaintenanceTx.replaceAuthority(key),
  );
  // midnight-js stores the new key in the private state provider; mirror it in the
  // run-dir record so the recorded operator key does not go stale.
  if (result.ok) await writeMaintenanceKey(keyPath.path, { key });
  return { to: key, ...result };
}

async function readDeployments(config) {
  try {
    const text = await readFile(
      resolve(config.runDir, "transactions.jsonl"),
      "utf8",
    );
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === "preprod-deployed");
  } catch {
    return [];
  }
}

/**
 * The maintenance key every staged scenario deploy signs with, created and persisted on
 * first use. It is deliberately the run dir's one key (shared with `--deploy`) rather than
 * a fresh one per sweep: a re-run of a scenario resumes the staged deploy by re-tying its
 * recorded address to the on-chain maintenance authority, which only matches the key that
 * authored the original deploy. `loadOrCreateMaintenanceKey` is staged-deploy.mjs's own
 * reader/writer, so there is one stored shape. A relinquished key (`--freeze empty`) is a
 * hard failure here, never silently replaced.
 */
async function sweepSigningKey(config, emit) {
  const { loadOrCreateMaintenanceKey } = await import("./staged-deploy.mjs");
  const { path, key, created } = await loadOrCreateMaintenanceKey(
    config.runDir,
  );
  if (created)
    await emit({
      event: "sweep-maintenance-key-created",
      note: "sweep deployments share one single-signature maintenance key; created here",
      keyPath: { path },
    });
  return key;
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
  if (mode === "--deploy") {
    const keyPath = await maintenanceKey(config);
    const signingKey =
      keyPath.key ??
      (
        await import("@midnight-ntwrk/midnight-js-protocol/compact-runtime")
      ).sampleSigningKey();
    if (!keyPath.key)
      await writeMaintenanceKey(keyPath.path, { key: signingKey });
    const order = miloOrder(Contract);
    const deployed = await deployOrder({
      providers,
      config,
      zkConfigProvider,
      signingKey,
      configuration: order.configurationFor({}),
      privateStateFor: order.privateState,
      label: "main",
      emit,
    });
    await emit({
      event: "maintenance-authority",
      note: "deployer holds a single-signature authority; key stored in the ignored run dir",
      keyPath: { path: keyPath.path },
    });
    return deployed.deployTxData.public.contractAddress;
  }
  if (mode === "--sweep") {
    // Every scenario deploy is staged and signed, so it needs a maintenance key that is
    // stable across runs: a resume re-ties the recorded address to the on-chain authority
    // and a fresh key would not match. Share the run dir's key with the main deployment.
    const signingKey = await sweepSigningKey(config, emit);
    const summary = await sweep({
      Contract,
      providers,
      config,
      zkConfigProvider,
      signingKey,
      emit,
    });
    const negativeResults = await negatives({
      Contract,
      providers,
      config,
      zkConfigProvider,
      signingKey,
      emit,
    });
    await emit({
      event: "sweep-complete",
      summary,
      negatives: negativeResults,
    });
    return summary;
  }
  // Maintenance modes operate on an existing deployment recorded in the run dir.
  const deployments = await readDeployments(config);
  assert(
    deployments.length > 0,
    "deploy first: no preprod-deployed receipt in the run dir",
  );
  // The breaker targets the main deployment, never a sweep order.
  const main =
    deployments.filter((entry) => entry.label === "main").at(-1) ??
    deployments.at(-1);
  const address = main.address;
  const keyPath = await maintenanceKey(config);
  const compiled = await compiledContract(Contract);
  const { circuitMaintenanceTx, contractMaintenanceTx } =
    await maintenanceHandles(providers, compiled, address);

  // No private state is regenerated here: the maintenance route above never reads or
  // writes a private state ID, so the `main-buyer` state recorded by --deploy stays
  // intact and callable. The signing key is seeded from the run-dir record only when
  // the provider has none, so a later mode signs with the recorded operator key.
  const storedKey = await providers.privateStateProvider
    .getSigningKey(address)
    .catch(() => undefined);
  if (!storedKey && keyPath.key)
    await providers.privateStateProvider.setSigningKey(address, keyPath.key);

  const circuit = flags[flags.indexOf(mode) + 1];
  if (mode === "--breaker")
    return breaker({ circuitMaintenanceTx, circuit, emit });
  if (mode === "--restore")
    return restore({ circuitMaintenanceTx, circuit, zkConfigProvider, emit });
  if (mode === "--freeze")
    return freeze({
      providers,
      contractMaintenanceTx,
      address,
      key: circuit,
      keyPath,
      networkId: config.networkId ?? getNetworkId(),
      emit,
    });
  throw new Error(`unknown mode ${mode}`);
}
