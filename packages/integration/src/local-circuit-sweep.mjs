/**
 * M2 local circuit sweep (disposable undeployed network).
 *
 * Deploys a fresh staged 7+7 instance per scenario and drives every proof
 * circuit to a SucceedEntirely receipt, covering the ten circuits R9 left
 * installed-but-not-called (cancelReserved, decline, disputeBuyer,
 * disputeMerchant, escalateUnreviewed, expireBootstrap, expireDispute,
 * expireReserved, expireUndelivered, resolve) plus the happy-path four so the
 * M2 table is one coherent instance | scenario | circuit | tx | block run.
 *
 * Patterns reused (do not fork them):
 * - fee-math.mjs (eraseProofs before feesWithMargin; optional
 *   MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only is local-only)
 * - local-happy.mjs provider wiring + submitCallTxAsync + timed watchForTxData
 * - preprod-actions.mjs scenarioSteps / short-deadline offsets for expiry
 *
 * Optional: MILO_SWEEP_ONLY=<label> runs one scenario.
 * Optional: MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only (network undeployed).
 * Lane lock: flock on .locks/local-circuit-sweep.lock (run script wraps this).
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { validateArtifacts, validateCohort } from "./artifacts.mjs";
import { localConfig, publicReceipt } from "./config.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { intentExpiry } from "./tx.mjs";
import { installFeeMath, localFixedFeeConfig } from "./fee-math.mjs";

const RUN_DIR = process.env.MILO_SWEEP_RUN_DIR || "/tmp/m2-circuit-sweep";
const TRAIL = process.env.MILO_SWEEP_TRAIL || "/tmp/m2-circuit-sweep-trail.jsonl";
mkdirSync(RUN_DIR, { recursive: true });
const trail = (event, fields = {}) => {
  const line = JSON.stringify({ event, at: Date.now(), ...fields });
  appendFileSync(TRAIL, line + "\n");
  process.stdout.write(line + "\n");
};

let stage = "configuration";
const emit = (event, fields = {}) => trail(event, { stage, ...fields });
const fail = (error) => {
  emit("failed", {
    ...errorDiagnostics(error),
    message: (error && error.message) || String(error),
    stack:
      error && error.stack
        ? error.stack.split("\n").slice(0, 8).join(" | ")
        : null,
  });
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

const bytes32 = () => new Uint8Array(randomBytes(32));
const sha256hex = (text) =>
  createHash("sha256").update(text).digest("hex");

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      emit("step-timeout", { label, ms });
      reject(new Error(`timeout after ${ms}ms: ${label}`));
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

/** Short offsets: expiry circuits need a passed deadline, not a 15-minute wait. */
const SCENARIOS = [
  { label: "happy-path", offsets: {} },
  { label: "cancel", offsets: {} },
  { label: "decline", offsets: {} },
  { label: "dispute-buyer", offsets: {} },
  { label: "dispute-merchant", offsets: {} },
  // acceptance already past at deploy time
  {
    label: "expire-bootstrap",
    offsets: { acceptance: -90, delivery: -60, review: -30, resolution: 300 },
  },
  // Offsets must leave enough wall-clock to reach the phase BEFORE the waited
  // deadline: a staged deploy is ~40s and each call ~30s. Both reserve AND
  // accept assert "acceptance deadline reached" (order.compact:126,135); a
  // tight acceptance offset made accept fail with runtime custom error 104.
  // wait acceptance (~2.5 min from configuration)
  {
    label: "expire-reserved",
    offsets: { acceptance: 150, delivery: 210, review: 270, resolution: 330 },
  },
  // wait delivery
  {
    label: "expire-undelivered",
    offsets: { acceptance: 150, delivery: 210, review: 270, resolution: 330 },
  },
  // wait review
  {
    label: "escalate-unreviewed",
    offsets: { acceptance: 180, delivery: 220, review: 280, resolution: 340 },
  },
  // wait resolution
  {
    label: "expire-dispute",
    offsets: { acceptance: 150, delivery: 190, review: 230, resolution: 290 },
  },
];

/**
 * Same step shapes as preprod-actions.scenarioSteps, kept local so the sweep
 * does not pull the Preprod lane module (which asserts network credentials).
 * approve expectedDelivery must equal submitDelivery's commitment.
 */
function scenarioSteps(label) {
  const delivery = bytes32();
  switch (label) {
    case "happy-path":
      return [
        { circuit: "reserve", actor: "buyer", revision: 0n, args: () => [] },
        { circuit: "accept", actor: "merchant", revision: 1n, args: () => [] },
        {
          circuit: "submitDelivery",
          actor: "merchant",
          revision: 2n,
          args: () => [delivery],
        },
        {
          circuit: "approve",
          actor: "buyer",
          revision: 3n,
          args: () => [delivery],
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
          // disputeMerchant runs in ACCEPTED with no delivery; resolve(true)
          // asserts a submitted delivery. Always false here.
          args: () => [false, bytes32()],
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
          args: () => [],
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
          args: () => [],
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
          args: () => [],
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
          args: () => [],
        },
      ];
    default:
      return [];
  }
}

const ALL_CIRCUITS = [
  "reserve",
  "accept",
  "cancelReserved",
  "decline",
  "submitDelivery",
  "approve",
  "disputeBuyer",
  "disputeMerchant",
  "resolve",
  "expireBootstrap",
  "expireReserved",
  "expireUndelivered",
  "escalateUnreviewed",
  "expireDispute",
];

function deadlinesFor(offsets = {}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    acceptance: now + BigInt(offsets.acceptance ?? 3_600),
    delivery: now + BigInt(offsets.delivery ?? 7_200),
    review: now + BigInt(offsets.review ?? 10_800),
    resolution: now + BigInt(offsets.resolution ?? 14_400),
  };
}

function configurationFor(offsets, secrets, terms) {
  const { pureCircuits, Role } = generated;
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("undeployed"));
  const nonce = bytes32();
  const d = deadlinesFor(offsets);
  // Constructor asserts acceptance < delivery < review < resolution.
  assert(
    d.acceptance < d.delivery &&
      d.delivery < d.review &&
      d.review < d.resolution,
    `unordered deadlines for offsets ${JSON.stringify(offsets)}`,
  );
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
}

let generated;
let witnesses;
let artifacts;

async function main() {
  const env = localConfig(process.env);
  assert.equal(env.networkId, "undeployed", "sweep is local-only");
  const expiresAt = Date.now() + env.timeoutMs;
  setTimeout(() => {
    emit("timeout", { stage });
    process.exit(1);
  }, env.timeoutMs).unref?.();
  const step = (name) => {
    stage = name;
    emit("stage");
  };
  const rpc = async (method, params) => {
    const response = await fetch(env.node, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert(response.ok);
    const data = await response.json();
    assert(!data.error);
    return data.result;
  };

  step("verify-compiler-artifacts-and-cohort");
  const artifactReceipt = await validateArtifacts();
  await validateCohort();
  step("verify-owned-genesis");
  assert.equal(await rpc("chain_getBlockHash", [0]), env.genesisHash);

  const tk = await import("@midnight-ntwrk/testkit-js");
  tk.logger.level = "silent";
  const { setNetworkId } = await import(
    "@midnight-ntwrk/midnight-js-network-id"
  );
  setNetworkId(env.networkId);
  const L = await import("@midnight-ntwrk/midnight-js-protocol/ledger");
  const feeMath = installFeeMath({
    env: process.env,
    networkId: env.networkId,
    Transaction: L.Transaction,
  });
  emit("fee-math-installed", {
    mode: feeMath.mode,
    fee: feeMath.fee ? feeMath.fee.toString() : null,
    localFixed: localFixedFeeConfig(process.env, env.networkId).mode,
  });
  const { CompiledContract } = await import(
    "@midnight-ntwrk/midnight-js-protocol/compact-js"
  );
  const { findDeployedContract, submitCallTxAsync, submitTx } = await import(
    "@midnight-ntwrk/midnight-js-contracts"
  );
  const { NodeZkConfigProvider } = await import(
    "@midnight-ntwrk/midnight-js-node-zk-config-provider"
  );
  const { httpClientProofProvider } = await import(
    "@midnight-ntwrk/midnight-js-http-client-proof-provider"
  );
  const { indexerPublicDataProvider } = await import(
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider"
  );
  const { UnshieldedAddress } = await import("@midnight-ntwrk/wallet-sdk");
  const { firstValueFrom, filter, timeout } = await import("rxjs");
  const orderMod = await import("./order.mjs");
  artifacts = orderMod.artifacts;
  generated = orderMod.generated;
  witnesses = orderMod.witnesses;

  const contract = new generated.Contract(witnesses);
  const circuits = Object.keys(contract.provableCircuits).sort();
  assert.equal(circuits.length, 14, "expected 14 proof circuits");
  const zkConfigProvider = new NodeZkConfigProvider(artifacts);
  const verifierKeys = await zkConfigProvider.getVerifierKeys(circuits);
  const publicDataProvider = indexerPublicDataProvider(
    env.indexer,
    env.indexerWS,
  );
  const proof = httpClientProofProvider(env.proofServer, zkConfigProvider, {
    timeout: env.timeoutMs,
  });
  const privateStateProvider = tk.inMemoryPrivateStateProvider();
  const wallets = [];

  try {
    step("genesis-wallet-sync");
    const genesis = new tk.LocalTestEnvironment(tk.logger);
    const funder = await tk.MidnightWalletProvider.build(
      tk.logger,
      env,
      genesis.genesisMintWalletSeed[0],
    );
    wallets.push(funder);
    await funder.start(false);
    const night = L.unshieldedToken().raw;
    const waitState = (provider, predicate) =>
      firstValueFrom(
        provider.wallet.state().pipe(
          filter((state) => state.isSynced && predicate(state)),
          timeout({ first: env.timeoutMs }),
        ),
      );
    await tk.syncWallet(funder.wallet);
    const fundingAmount = 200_000n * 1_000_000n;
    await tk.waitForFunds(funder.wallet, env, false, funder.unshieldedKeystore);
    await waitState(funder, (state) => state.dust.balance(new Date()) > 0n);

    step("buyer-funding");
    const buyer = await tk.MidnightWalletProvider.build(
      tk.logger,
      env,
      randomBytes(32).toString("hex"),
    );
    wallets.push(buyer);
    await buyer.start(false);
    await tk.syncWallet(buyer.wallet);
    const recipe = await funder.wallet.transferTransaction(
      [
        {
          type: "unshielded",
          outputs: [
            {
              type: night,
              amount: fundingAmount,
              receiverAddress: buyer.unshieldedKeystore
                .getBech32Address()
                .decode(UnshieldedAddress, env.networkId),
            },
          ],
        },
      ],
      {
        shieldedSecretKeys: funder.zswapSecretKeys,
        dustSecretKey: funder.dustSecretKey,
      },
      { ttl: intentExpiry() },
    );
    const signed = await funder.wallet.signRecipe(recipe, (payload) =>
      funder.unshieldedKeystore.signData(payload),
    );
    const fundingId = await funder.submitTx(
      await funder.wallet.finalizeRecipe(signed),
    );
    emit("submitted", { txId: fundingId });
    emit(
      "funding-finalized",
      publicReceipt(await publicDataProvider.watchForTxData(fundingId)),
    );
    await waitState(
      buyer,
      (state) => (state.unshielded.balances[night] ?? 0n) > 0n,
    );
    await tk.waitForFunds(buyer.wallet, env, false, buyer.unshieldedKeystore);
    await waitState(buyer, (state) => state.dust.balance(new Date()) > 0n);

    const providers = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider: {
        async proveTx(...args) {
          emit("prove-start");
          const result = await proof.proveTx(...args);
          emit("proof-provider-completed");
          return result;
        },
      },
      walletProvider: {
        getCoinPublicKey: () => buyer.getCoinPublicKey(),
        getEncryptionPublicKey: () => buyer.getEncryptionPublicKey(),
        async balanceTx(tx, ttl = new Date(Date.now() + 3_600_000)) {
          emit("balance-start", { note: "skip-estimate" });
          await firstValueFrom(
            buyer.wallet.state().pipe(
              filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
              timeout({ first: Math.max(1_000, expiresAt - Date.now()) }),
            ),
          );
          emit("dust-present");
          const recipe = await buyer.wallet.balanceUnboundTransaction(
            tx,
            {
              shieldedSecretKeys: buyer.zswapSecretKeys,
              dustSecretKey: buyer.dustSecretKey,
            },
            { ttl },
          );
          emit("dust-fee-ready");
          const signed = await buyer.wallet.signRecipe(recipe, (payload) =>
            buyer.unshieldedKeystore.signData(payload),
          );
          return await buyer.wallet.finalizeRecipe(signed);
        },
      },
      midnightProvider: {
        async submitTx(tx) {
          const txId = await buyer.submitTx(tx);
          emit("submitted", { txId });
          return txId;
        },
      },
    };

    const { runStagedDeploy, loadOrCreateMaintenanceKey } = await import(
      "./staged-deploy.mjs"
    );
    const { path: keyPath, key: signingKey } =
      await loadOrCreateMaintenanceKey(RUN_DIR);
    const compiledContract = CompiledContract.make(
      "milo-order",
      generated.Contract,
    ).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets(artifacts),
    );

    // Optional single- or multi-scenario run: MILO_SWEEP_ONLY=cancel,decline
    const onlyRaw = process.env.MILO_SWEEP_ONLY;
    const onlyLabels = onlyRaw
      ? onlyRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const selected = onlyLabels
      ? SCENARIOS.filter((s) => onlyLabels.includes(s.label))
      : SCENARIOS;
    assert(
      !onlyLabels || selected.length > 0,
      `MILO_SWEEP_ONLY=${onlyRaw} unmatched`,
    );

    const summary = [];
    for (const scenario of selected) {
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
      const privateStateFor = (actor) => ({
        actor,
        secret: secrets[actor],
        terms,
        limit: 36_000n,
      });
      const configuration = configurationFor(
        scenario.offsets,
        secrets,
        terms,
      );
      const deadlines = deadlinesFor(scenario.offsets);

      step(`deploy-${scenario.label}`);
      const receiptPath = `${RUN_DIR}/staged-deploy-${scenario.label}.json`;
      const receipt = await withTimeout(
        runStagedDeploy({
          networkId: env.networkId,
          configuration,
          coinPublicKey: buyer.getCoinPublicKey(),
          verifierKeys,
          signingKey,
          submit: async (unprovenTx) => {
            const raw = await submitTx(providers, { unprovenTx });
            return typeof raw === "string" && !raw.startsWith("0x")
              ? `0x${raw}`
              : raw;
          },
          observe: (address, blockHash) =>
            blockHash
              ? publicDataProvider.queryContractState(address, {
                  type: "blockHash",
                  blockHash,
                })
              : publicDataProvider.queryContractState(address),
          emit: async (event, fields = {}) => emit(event, fields),
          receiptPath,
          onDeployed: async ({ address: landed }) => {
            privateStateProvider.setContractAddress(landed);
            for (const actor of ["buyer", "merchant", "operator"])
              await privateStateProvider.set(
                `${scenario.label}-${actor}`,
                privateStateFor(actor),
              );
          },
        }),
        300_000,
        `runStagedDeploy:${scenario.label}`,
      );
      assert.equal(receipt.status, "complete", `deploy ${scenario.label}`);
      assert.equal(receipt.finalCircuitCount, 14);
      const address = receipt.address;
      emit("deployment-finalized", {
        scenario: scenario.label,
        address,
        deployTxId: receipt.deploy?.txId ?? null,
        deployTxHash: receipt.deploy?.txHash ?? null,
        deployBlockHeight: receipt.deploy?.blockHeight ?? null,
        insertTxHashes: (receipt.inserts ?? []).map((i) => i.txHash),
      });

      step(`handles-${scenario.label}`);
      const actors = {};
      for (const actor of ["buyer", "merchant", "operator"]) {
        actors[actor] = await withTimeout(
          findDeployedContract(providers, {
            contractAddress: address,
            compiledContract,
            privateStateId: `${scenario.label}-${actor}`,
            initialPrivateState: privateStateFor(actor),
          }),
          120_000,
          `handle:${scenario.label}:${actor}`,
        );
      }

      const rows = [];
      for (const item of scenarioSteps(scenario.label)) {
        if (item.waitFor) {
          const deadline = Number(deadlines[item.waitFor]);
          emit("waiting-for-deadline", {
            scenario: scenario.label,
            circuit: item.circuit,
            deadline,
            now: Math.floor(Date.now() / 1000),
          });
          while (Math.floor(Date.now() / 1000) < deadline + 2)
            await new Promise((done) => setTimeout(done, 2_000));
          emit("deadline-reached", {
            scenario: scenario.label,
            circuit: item.circuit,
            now: Math.floor(Date.now() / 1000),
          });
        }
        step(`call-${scenario.label}-${item.circuit}`);
        emit("call-start", {
          scenario: scenario.label,
          circuit: item.circuit,
          actor: item.actor,
          revision: item.revision.toString(),
        });
        // Give the wallet a beat to observe the previous extrinsic before the
        // next balance/submit; a tight reserve→accept sequence has failed with
        // runtime custom error 104 on the local lane.
        await firstValueFrom(
          buyer.wallet.state().pipe(
            filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
            timeout({ first: 30_000 }),
          ),
        );
        await new Promise((done) => setTimeout(done, 1_500));
        const submitted = await withTimeout(
          submitCallTxAsync(providers, {
            compiledContract,
            circuitId: item.circuit,
            contractAddress: address,
            privateStateId: `${scenario.label}-${item.actor}`,
            args: [item.revision, ...item.args()],
          }),
          240_000,
          `submitCallTxAsync:${scenario.label}:${item.circuit}`,
        );
        const txId = submitted.txId;
        emit("submitted", { circuit: item.circuit, txId });
        const finalized = await withTimeout(
          publicDataProvider.watchForTxData(txId),
          120_000,
          `watchForTxData:${scenario.label}:${item.circuit}`,
        );
        const callReceipt = publicReceipt(finalized);
        assert.equal(
          callReceipt.status,
          "SucceedEntirely",
          `${scenario.label}:${item.circuit} not SucceedEntirely`,
        );
        await privateStateProvider.set(
          `${scenario.label}-${item.actor}`,
          submitted.callTxData.private.nextPrivateState,
        );
        emit("call-finalized", {
          scenario: scenario.label,
          circuit: item.circuit,
          actor: item.actor,
          revision: item.revision.toString(),
          ...callReceipt,
        });
        rows.push({
          scenario: scenario.label,
          circuit: item.circuit,
          actor: item.actor,
          revision: item.revision.toString(),
          ...callReceipt,
        });
      }
      summary.push({
        scenario: scenario.label,
        address,
        deploy: {
          txId: receipt.deploy?.txId ?? null,
          txHash: receipt.deploy?.txHash ?? null,
          blockHeight: receipt.deploy?.blockHeight ?? null,
        },
        inserts: (receipt.inserts ?? []).map((i) => ({
          txId: i.txId,
          txHash: i.txHash,
          blockHeight: i.blockHeight,
          circuits: i.circuits,
        })),
        rows,
      });
      // Persist immediately so a later scenario failure does not drop this one.
      writeFileSync(
        `${RUN_DIR}/scenario-${scenario.label}.json`,
        JSON.stringify(summary[summary.length - 1], null, 2),
      );
    }

    // Persist each scenario independently so batched runs can be merged.
    for (const entry of summary) {
      writeFileSync(
        `${RUN_DIR}/scenario-${entry.scenario}.json`,
        JSON.stringify(entry, null, 2),
      );
    }

    // Merge every scenario receipt on disk (batched runs included).
    const merged = [];
    for (const name of readdirSync(RUN_DIR)) {
      const match = /^scenario-(.+)\.json$/.exec(name);
      if (!match) continue;
      merged.push(JSON.parse(readFileSync(`${RUN_DIR}/${name}`, "utf8")));
    }
    merged.sort(
      (a, b) =>
        SCENARIOS.findIndex((s) => s.label === a.scenario) -
        SCENARIOS.findIndex((s) => s.label === b.scenario),
    );

    // Coverage: every proof circuit must have a SucceedEntirely row.
    // Enforced when this process was not scenario-filtered, and also on the
    // final write when all scenario files are present.
    const called = new Set(merged.flatMap((s) => s.rows.map((r) => r.circuit)));
    const missing = ALL_CIRCUITS.filter((name) => !called.has(name));
    const allScenariosPresent = SCENARIOS.every((s) =>
      merged.some((m) => m.scenario === s.label),
    );
    if (!onlyLabels || allScenariosPresent) {
      assert.equal(
        missing.length,
        0,
        `sweep did not call circuits: ${missing.join(", ")}`,
      );
    }

    const result = {
      evidenceId: "obs_m2_circuit_sweep_1",
      at: new Date().toISOString(),
      networkId: env.networkId,
      genesisHash: env.genesisHash,
      artifactSetSha256: artifactReceipt.artifactSetSha256,
      maintenanceKeyPath: keyPath,
      feeMathMode: feeMath.mode,
      scenarios: merged,
      calledCircuits: ALL_CIRCUITS.filter((name) => called.has(name)),
      calledCount: called.size,
      missingCircuits: missing,
    };
    const resultPath = `${RUN_DIR}/m2-circuit-sweep.json`;
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    emit("sweep-complete", {
      resultPath,
      calledCount: called.size,
      missingCount: missing.length,
      scenarioCount: merged.length,
      instances: merged.map((s) => s.address),
    });
  } finally {
    emit("stopping-owned-wallets");
    await Promise.allSettled(wallets.map((wallet) => wallet.stop()));
  }
}

main()
  .then(() => process.exit(0))
  .catch(fail);
