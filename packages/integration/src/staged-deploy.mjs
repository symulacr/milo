// Staged Preprod deploy (--deploy).
//
// Why this exists. The monolithic deploy proves one transaction carrying all
// fourteen verifier keys and the full constructor state. On Preprod the
// binding dimension is the ledger's `bytes_written`, charged as declared
// dispatch ref-time, and the node rejects that transaction with
//   1010 Invalid Transaction (Transaction would exhaust the block limits)
// at 1,321,480,000,001 ref-time against a per-extrinsic limit of
// 1,299,891,843,000, over by 21,588,157,001 (1.66 percent). There is no fee
// term to trade against: the check is a per-extrinsic constant. The only
// lever left is to move some verifier keys out of the deploy transaction.
//
// The split. Deploy with seven keys, then install the remaining seven with a
// signed ledger-level maintenance update at the same address:
//   7-key deploy  746,400,000,001  (about 42.6 percent margin)
//   13-key deploy 1,240,600,000,001 (about 4.6 percent margin)
//   14-key deploy 1,321,480,000,001 (over the limit)
// The per-key gradient is about 82e9 ref-time, so the seven-key maintenance
// insert costs roughly the same as the seven keys it writes, comfortably
// inside the limit. 13+1 is rejected as the deliberate choice because its
// deploy margin is only 4.6 percent, which a byte of drift would erase; 7+7
// keeps both transactions well clear. This is also the split the local native
// staged bootstrap already proved.
//
// The path reuses bootstrap.mjs: `prepareBootstrap` computes the constructor
// state, the seven-name initial set, the remaining set, the signer and the
// key map; `inspectBootstrap` is the exact confirmation (observed operation
// set plus byte-for-byte verifier-key equality plus the maintenance
// authority). The orchestration itself cannot call `runStagedBootstrap` /
// `bootstrapMaintenance` verbatim: both assert `networkId === "undeployed"`,
// which a Preprod transaction cannot satisfy. What is reused is the ledger
// primitives (`ContractDeploy`, `MaintenanceUpdate`, `VerifierKeyInsert`) and
// those two helpers; the transaction assembly below mirrors
// `bootstrapMaintenance` without the local-network assertion.
//
// The authority is left in place (committee [signer], threshold one, counter
// advanced by the insert). The local bootstrap locks at the end; Preprod must
// not, because the lane's existing --breaker/--restore/--freeze drills sign
// against this deployment. `requireCompletedLockedBootstrap` is therefore not
// the guard used here; `inspectBootstrap(state, plan, proofCircuits, counter,
// false)` is.
//
// Fail closed and restartable. The receipt file is written before the deploy
// is submitted (chosen address plus the encoded configuration), then again
// after every confirmed transaction. If the deploy lands and the insert does
// not, the run records the address, the deploy txId and block height, the
// confirmed inserts, and (when the indexer still answers) exactly which
// circuits are missing, then throws. A later run reads that receipt, rebuilds
// the plan from the persisted configuration and the persisted maintenance key,
// skips the deploy, re-ties the recorded address to that plan through the
// observed ledger data and signer, and inserts only the missing circuits.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { proofCircuits } from "./artifacts.mjs";
import { inspectBootstrap, prepareBootstrap } from "./bootstrap.mjs";
import { publicReceipt } from "./config.mjs";
import { deployTx, intentExpiry, maintenanceTx } from "./tx.mjs";

export const MAINTENANCE_KEY_FILE = "maintenance-key.json";
export const STAGED_DEPLOY_RECEIPT_FILE = "staged-deploy.json";

/** The chosen split, recorded on every receipt so the decision is auditable. */
export const SPLIT_RATIONALE =
  "deploy seven keys, install the remaining seven by one signed maintenance " +
  "update; the 7-key deploy declares 746,400,000,001 ref-time (about 42.6 " +
  "percent below the 1,299,891,843,000 per-extrinsic limit) where the " +
  "monolithic 14-key deploy declares 1,321,480,000,001 and is rejected with " +
  "1010; 13+1 was rejected because its 4.6 percent deploy margin is too " +
  "small for unexpected drift";

const BYTE_FIELDS = [
  "network",
  "orderNonce",
  "termsCommitment",
  "buyerCommitment",
  "merchantCommitment",
  "operatorCommitment",
];
const BIGINT_FIELDS = [
  "acceptanceDeadline",
  "deliveryDeadline",
  "reviewDeadline",
  "resolutionDeadline",
];

const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const unhex = (text) => {
  assert.match(text, /^(?:[0-9a-f]{2})+$/, "Invalid hex field");
  return new Uint8Array(Buffer.from(text, "hex"));
};

function operationNames(state) {
  return state
    .operations()
    .map((name) =>
      typeof name === "string"
        ? name
        : new TextDecoder("utf-8", { fatal: true }).decode(name),
    )
    .sort();
}

/** A public constructor configuration for the lane. The network bytes come from
 * the lane's network id, so the deployed configuration names the network it is
 * deployed on; this mirrors what the monolithic preprod deploy built. Kept here
 * so the lane's interception stays thin and the receipt can persist and restore
 * exactly the configuration that produced the address. */
export function preprodConfiguration(contract, networkId) {
  assert(contract?.pureCircuits && contract?.Role, "Contract module required");
  assert.equal(typeof networkId, "string");
  const network = new Uint8Array(32);
  const encoded = new TextEncoder().encode(networkId);
  assert(encoded.length <= 32 && encoded.length > 0, "Invalid network id");
  network.set(encoded);
  const bytes = () => new Uint8Array(randomBytes(32));
  const terms = {
    serviceVersion: 1n,
    packQuantity: 1n,
    outputCount: 3n,
    unitPrice: 36_000n,
    total: 36_000n,
    currency: new TextEncoder().encode("USD"),
    scopeDigest: bytes(),
    rightsDigest: bytes(),
    paymentPolicy: bytes(),
    salt: bytes(),
  };
  const { pureCircuits, Role } = contract;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const nonce = bytes();
  return {
    network,
    orderNonce: nonce,
    termsCommitment: pureCircuits.hashTerms(network, nonce, terms),
    buyerCommitment: pureCircuits.hashCapability(
      network,
      nonce,
      Role.BUYER,
      bytes(),
    ),
    merchantCommitment: pureCircuits.hashCapability(
      network,
      nonce,
      Role.MERCHANT,
      bytes(),
    ),
    operatorCommitment: pureCircuits.hashCapability(
      network,
      nonce,
      Role.OPERATOR,
      bytes(),
    ),
    acceptanceDeadline: now + 3_600n,
    deliveryDeadline: now + 7_200n,
    reviewDeadline: now + 10_800n,
    resolutionDeadline: now + 14_400n,
  };
}

/** Serialize a public configuration for the durable receipt. No secret material. */
export function encodeConfiguration(configuration) {
  const encoded = {};
  for (const field of BYTE_FIELDS) {
    assert(
      configuration[field] instanceof Uint8Array &&
        configuration[field].length === 32,
      `Invalid configuration field ${field}`,
    );
    encoded[field] = hex(configuration[field]);
  }
  for (const field of BIGINT_FIELDS)
    encoded[field] = BigInt(configuration[field]).toString();
  return encoded;
}

export function decodeConfiguration(encoded) {
  assert(
    encoded && typeof encoded === "object",
    "Missing encoded configuration",
  );
  const configuration = {};
  for (const field of BYTE_FIELDS) {
    assert.equal(
      typeof encoded[field],
      "string",
      `Missing encoded configuration field ${field}`,
    );
    configuration[field] = unhex(encoded[field]);
    assert.equal(configuration[field].length, 32);
  }
  for (const field of BIGINT_FIELDS)
    configuration[field] = BigInt(encoded[field]);
  return configuration;
}

/** Read the maintenance signing key the deploy will use, or create and persist a
 * fresh one. The file shape is exactly the one preprod-actions.mjs reads
 * (`{ "key": "<64 hex characters>" }`, mode 0600), so the lane's existing
 * breaker/restore/freeze modes keep one source of truth. A present-but-unusable
 * file is a hard failure, never silently replaced: overwriting it would orphan
 * the authority of an already deployed contract. */
export async function loadOrCreateMaintenanceKey(runDir) {
  const path = resolve(runDir, MAINTENANCE_KEY_FILE);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const key = L.sampleSigningKey();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ key }), { mode: 0o600 });
    await chmod(path, 0o600);
    return { path, key, created: true };
  }
  const stored = JSON.parse(text);
  assert.equal(typeof stored?.key, "string", "Maintenance key file has no key");
  return { path, key: stored.key, created: false };
}

/** One signed maintenance update inserting exactly `names`. This is the
 * network-agnostic counterpart of bootstrapMaintenance's insert branch: the
 * counter is the contract's observed authority counter, the version is v3, and
 * the update is signed by the maintenance signer that authored the deploy. */
export function stagedDeployInsert({
  address,
  plan,
  names,
  signingKey,
  networkId,
  counter,
  ttl = intentExpiry(),
}) {
  assert(names.length > 0, "No verifier keys to insert");
  assert.equal(typeof counter, "bigint", "Counter must be an unsigned integer");
  assert.equal(
    L.signatureVerifyingKey(signingKey),
    plan.signer,
    "Wrong maintenance signer",
  );
  const updates = names.map((name) => {
    assert(plan.keys.has(name), `Unknown verifier key ${name}`);
    return new L.VerifierKeyInsert(
      name,
      new L.ContractOperationVersionedVerifierKey("v3", plan.keys.get(name)),
    );
  });
  let update = new L.MaintenanceUpdate(address, updates, counter);
  update = update.addSignature(0n, L.signData(signingKey, update.dataToSign));
  return maintenanceTx(networkId, update, ttl);
}

export class StagedDeployError extends Error {
  constructor(message, receipt, options) {
    super(message, options);
    this.name = "StagedDeployError";
    this.receipt = receipt;
  }
}

async function readPriorReceipt(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { unreadable: true };
  }
}

/**
 * Deploy the contract with the seven-name initial subset, install the rest,
 * confirm all fourteen operations at one address, and return the receipt.
 *
 * `submit` is the lane's transaction path (prove, balance, submit) returning
 * the finalized receipt; `observe(address, blockHash?)` returns the ledger
 * `ContractState` at that block, or the latest state when no block is given.
 * Both are injected so this module can be exercised without a network.
 */
export async function runStagedDeploy({
  networkId,
  configuration,
  coinPublicKey,
  verifierKeys,
  signingKey,
  submit,
  observe,
  emit = () => {},
  receiptPath,
  explorer,
  onDeployed,
  ttl = intentExpiry,
  observeAttempts = 10,
  observeRetryMs = 2_000,
}) {
  assert.equal(typeof networkId, "string");
  assert(networkId.length > 0, "A network id is required");
  assert.equal(typeof submit, "function");
  assert.equal(typeof observe, "function");
  assert.equal(typeof signingKey, "string");
  assert(signingKey.length > 0, "A maintenance signing key is required");

  const prior = receiptPath ? await readPriorReceipt(receiptPath) : null;
  if (prior?.unreadable)
    emit("staged-deploy-receipt-unreadable", { receiptPath });

  // Prefer the configuration recorded by a predecessor: it is what produced the
  // address, and the constructor data is public (it is the sealed ledger
  // `configuration`). Only a genuinely absent or unreadable receipt falls back
  // to the caller's fresh configuration.
  const effectiveConfiguration = prior?.configuration
    ? decodeConfiguration(prior.configuration)
    : configuration;
  const plan = prepareBootstrap({
    configuration: effectiveConfiguration,
    coinPublicKey,
    verifierKeys,
    signingKey,
    lockCounter: 2n,
  });
  // A confirmed deploy in the receipt means resume: skip the deploy and finish
  // the inserts. The deployment address is chosen by the ledger when the
  // ContractDeploy is built, so it cannot be recomputed on a later run; a
  // resume therefore trusts the recorded address and re-ties it to this plan
  // through the observed ledger data and maintenance signer (inspectBootstrap),
  // never by comparing a freshly generated address.
  const deployLanded = Boolean(prior?.deploy) && Boolean(prior?.address);
  const deployment = deployLanded ? null : new L.ContractDeploy(plan.initial);
  const address = deployLanded ? prior.address : deployment.address;

  const receipt = {
    event: "staged-deploy-receipt",
    network: networkId,
    address,
    split: {
      initialNames: [...plan.initialNames],
      remainingNames: [...plan.remainingNames],
      totalCircuits: proofCircuits.length,
      rationale: SPLIT_RATIONALE,
    },
    configuration: encodeConfiguration(effectiveConfiguration),
    deploy: prior?.deploy ?? null,
    inserts: Array.isArray(prior?.inserts) ? prior.inserts : [],
    finalCircuitCount: 0,
    finalOperationNames: [],
    confirmation: null,
    status: "pending",
    missingCircuits: [],
    latestObservation: null,
    failure: null,
    receiptPersisted: true,
    updatedAt: new Date().toISOString(),
  };

  const persistReceipt = async () => {
    if (!receiptPath) return;
    receipt.updatedAt = new Date().toISOString();
    try {
      const temp = `${receiptPath}.${process.pid}.tmp`;
      await mkdir(dirname(receiptPath), { recursive: true });
      await writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
      });
      await chmod(temp, 0o600);
      await rename(temp, receiptPath);
    } catch (error) {
      // The run trail through `emit` is still durable; say the file was not
      // written rather than aborting a deploy that may already be on chain.
      receipt.receiptPersisted = false;
      emit("staged-deploy-receipt-write-failed", {
        receiptPath,
        message: String(error?.message ?? error).slice(0, 300),
      });
    }
  };

  const observeState = async (target, blockHash) => {
    for (let attempt = 1; attempt <= observeAttempts; attempt++) {
      const state = await observe(target, blockHash);
      if (state) return state;
      if (attempt < observeAttempts) await wait(observeRetryMs);
    }
    throw new StagedDeployError(
      `No contract state observed at ${target}`,
      receipt,
    );
  };

  try {
    let state;
    let lastBlockHash = receipt.deploy?.blockHash ?? null;

    if (!deployLanded) {
      emit("staged-deploy-planned", {
        network: networkId,
        address,
        initialNames: plan.initialNames,
        remainingNames: plan.remainingNames,
        initialOperationCount: plan.initialNames.length,
        finalOperationCount: proofCircuits.length,
        rationale: SPLIT_RATIONALE,
      });
      await persistReceipt();
      const raw = await submit(deployTx(networkId, deployment, ttl()));
      const deploy = publicReceipt(raw);
      receipt.deploy = {
        txId: deploy.txId,
        txHash: deploy.txHash,
        blockHash: deploy.blockHash,
        blockHeight: deploy.blockHeight,
        circuits: [...plan.initialNames],
      };
      receipt.status = "deployed";
      await persistReceipt();
      // Let the caller record the maintenance signer against the landed address
      // before any insert runs, so a later partial failure still has it.
      if (onDeployed) await onDeployed({ address, deploy: receipt.deploy });
      emit("staged-deploy-deploy-finalized", {
        address,
        ...receipt.deploy,
        initialOperationCount: plan.initialNames.length,
        finalOperationCount: proofCircuits.length,
      });
      // The lane's --breaker/--restore/--freeze modes look for this exact event
      // and label, so a staged deployment stays a first-class "main" deployment.
      emit("preprod-deployed", {
        label: "main",
        address,
        txId: deploy.txId,
        blockHeight: deploy.blockHeight,
        ...(explorer ? { explorer: `${explorer}/contract/${address}` } : {}),
      });
      lastBlockHash = deploy.blockHash;
      state = await observeState(address, deploy.blockHash);
      inspectBootstrap(state, plan, plan.initialNames, 0n, false);
      emit("staged-deploy-inspected", {
        stage: "deploy",
        address,
        operationCount: plan.initialNames.length,
        counter: "0",
        allInitialKeysPresent: true,
      });
    } else {
      emit("staged-deploy-resuming", {
        address,
        deployTxId: receipt.deploy.txId,
        previousStatus: prior?.status ?? "unknown",
      });
      state = await observeState(address, undefined);
    }

    // What is actually installed, verified key by key through inspectBootstrap.
    const observed = operationNames(state);
    for (const name of observed)
      assert(plan.keys.has(name), `Unexpected operation ${name} on chain`);
    inspectBootstrap(
      state,
      plan,
      observed,
      state.maintenanceAuthority.counter,
      false,
    );
    const missing = proofCircuits.filter((name) => !observed.includes(name));
    receipt.missingCircuits = missing;
    await persistReceipt();

    if (missing.length > 0) {
      const counter = state.maintenanceAuthority.counter;
      emit("staged-deploy-insert-submitting", {
        address,
        circuits: missing,
        counter: counter.toString(),
      });
      const raw = await submit(
        stagedDeployInsert({
          address,
          plan,
          names: missing,
          signingKey,
          networkId,
          counter,
          ttl: ttl(),
        }),
      );
      const insert = publicReceipt(raw);
      receipt.inserts.push({
        circuits: [...missing],
        txId: insert.txId,
        txHash: insert.txHash,
        blockHash: insert.blockHash,
        blockHeight: insert.blockHeight,
      });
      receipt.status = "installed";
      await persistReceipt();
      emit("staged-deploy-insert-finalized", {
        address,
        ...receipt.inserts.at(-1),
        counter: counter.toString(),
      });
      lastBlockHash = insert.blockHash;
      state = await observeState(address, insert.blockHash);
    }

    // Confirmation, not assumption: the observed operation set must be exactly
    // the fourteen proof circuits and every verifier key must equal the key we
    // intended to install, byte for byte, with the expected authority.
    const finalNames = operationNames(state);
    assert.deepEqual(
      finalNames,
      [...proofCircuits],
      "Staged deploy did not expose exactly the proof circuits",
    );
    inspectBootstrap(
      state,
      plan,
      proofCircuits,
      state.maintenanceAuthority.counter,
      false,
    );
    receipt.finalCircuitCount = finalNames.length;
    receipt.finalOperationNames = finalNames;
    receipt.confirmation = {
      method: "observed-operation-set-and-verifier-key-equality",
      source: "indexer-queryContractState",
      observedAtBlockHash: lastBlockHash,
      expectedCircuitCount: proofCircuits.length,
      observedCircuitCount: finalNames.length,
      allCircuitsPresent: true,
      verifierKeysMatchPlan: true,
      counter: state.maintenanceAuthority.counter.toString(),
      maintenanceAuthority: {
        threshold: state.maintenanceAuthority.threshold,
        committeeSize: state.maintenanceAuthority.committee.length,
      },
      verifierKeySha256: Object.fromEntries(
        proofCircuits.map((name) => [name, sha256hex(plan.keys.get(name))]),
      ),
    };
    receipt.status = "complete";
    receipt.missingCircuits = [];
    await persistReceipt();
    emit("staged-deploy-confirmed", { address, ...receipt.confirmation });
    emit("staged-deploy-complete", {
      address,
      deployTxId: receipt.deploy?.txId ?? null,
      insertTxIds: receipt.inserts.map((insert) => insert.txId),
      finalCircuitCount: receipt.finalCircuitCount,
      missingCircuits: [],
      receiptPath: receiptPath ?? null,
      receiptPersisted: receipt.receiptPersisted,
    });
    return receipt;
  } catch (error) {
    // Fail closed. Record exactly what landed; never claim an insert that was
    // not observed. When the deploy landed, try the latest state so the receipt
    // names the circuits still missing; if the indexer cannot answer, say the
    // observation is unavailable instead of guessing.
    const failure = {
      name: error?.name ?? "Error",
      message: String(error?.message ?? error).slice(0, 500),
    };
    let missing = null;
    let observed = null;
    if (receipt.deploy) {
      try {
        const latest = await observe(address, undefined);
        if (latest) {
          observed = operationNames(latest);
          missing = proofCircuits.filter((name) => !observed.includes(name));
        }
      } catch {
        observed = null;
      }
    }
    receipt.status = "failed";
    receipt.missingCircuits = missing;
    receipt.latestObservation = observed;
    receipt.failure = failure;
    await persistReceipt();
    emit("staged-deploy-failed", {
      address: receipt.deploy ? address : null,
      deployLanded: Boolean(receipt.deploy),
      deploy: receipt.deploy,
      inserts: receipt.inserts,
      missingCircuits: missing,
      missingCircuitsVerified: missing !== null,
      observedOperationNames: observed,
      pendingInsertCircuits:
        missing ?? (receipt.deploy ? [...plan.remainingNames] : null),
      ...failure,
      receiptPath: receiptPath ?? null,
      receiptPersisted: receipt.receiptPersisted,
    });
    throw error instanceof StagedDeployError
      ? error
      : new StagedDeployError(
          `Staged deploy failed: ${failure.message}`,
          receipt,
          { cause: error },
        );
  }
}
