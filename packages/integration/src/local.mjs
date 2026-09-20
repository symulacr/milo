import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { validateArtifacts, validateCohort } from "./artifacts.mjs";
import { localConfig, publicReceipt } from "./config.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { balanceWithDustReadiness } from "./dust.mjs";
import { deploymentPreflight } from "./resources.mjs";
import { captureSubmissions } from "./submissions.mjs";
import { intentExpiry, maintenanceTx } from "./tx.mjs";

let stage = "configuration";
let boundary = "harness";
const emit = (event, fields = {}) =>
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
const fail = (error) => {
  emit("failed", {
    stage,
    boundary,
    ...errorDiagnostics(error),
    immutableOrderAdmission: false,
    r1Complete: false,
  });
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

async function main() {
  const env = localConfig(process.env);
  const expiresAt = Date.now() + env.timeoutMs;
  const deadline = setTimeout(() => {
    emit("timeout", {
      stage,
      outcome: "unknown-if-submitted",
      immutableOrderAdmission: false,
      r1Complete: false,
    });
    process.exit(1);
  }, env.timeoutMs);
  const step = (name) => {
    stage = name;
    boundary = "harness";
    emit("stage", { stage });
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
  const cohort = await validateCohort();
  const { artifacts: artifactHashes, ...artifactFingerprints } =
    artifactReceipt;
  emit("compiler-artifacts-validated", { ...artifactFingerprints, cohort });
  step("verify-owned-genesis");
  assert.equal(await rpc("chain_getBlockHash", [0]), env.genesisHash);

  const tk = await import("@midnight-ntwrk/testkit-js");
  // Testkit's wallet builders otherwise log seeds, including fresh random ones.
  tk.logger.level = "silent";
  const { setNetworkId } = await import(
    "@midnight-ntwrk/midnight-js-network-id"
  );
  setNetworkId(env.networkId);
  const L = await import("@midnight-ntwrk/midnight-js-protocol/ledger");
  const { CompiledContract } = await import(
    "@midnight-ntwrk/midnight-js-protocol/compact-js"
  );
  const { deployContract, submitTx, verifyContractState } = await import(
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
  const { artifacts, generated, witnesses, freshOrder } = await import(
    "./order.mjs"
  );
  const { createConstructorContext } = await import(
    "@midnight-ntwrk/compact-runtime"
  );
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const contract = new generated.Contract(witnesses);
  const circuits = Object.keys(contract.provableCircuits).sort();
  const zkConfigProvider = new NodeZkConfigProvider(artifacts);
  const verifierKeys = await zkConfigProvider.getVerifierKeys(circuits);
  assert.deepEqual(
    circuits,
    Object.keys(artifactHashes)
      .filter((path) => path.endsWith(".verifier"))
      .map((path) => path.slice(5, -9))
      .sort(),
  );
  for (const [name, key] of verifierKeys)
    assert.equal(sha256(key), artifactHashes[`keys/${name}.verifier`]);
  emit("artifacts", {
    generatedSha256: artifactHashes["contract/index.js"],
    verifierSha256: Object.fromEntries(
      verifierKeys.map(([name, key]) => [name, sha256(key)]),
    ),
  });
  const publicDataProvider = indexerPublicDataProvider(
    env.indexer,
    env.indexerWS,
  );
  const proof = httpClientProofProvider(env.proofServer, zkConfigProvider, {
    timeout: env.timeoutMs,
  });
  const privateStateProvider = tk.inMemoryPrivateStateProvider();
  const wallets = [];
  const restoreSubmissions = [];
  const bootstrapMetrics = [];
  let submissionFence;
  try {
    step("genesis-wallet-sync");
    // Constructor and this public seed property do not start a Docker environment.
    const genesis = new tk.LocalTestEnvironment(tk.logger);
    const funder = await tk.MidnightWalletProvider.build(
      tk.logger,
      env,
      genesis.genesisMintWalletSeed[0],
    );
    wallets.push(funder);
    restoreSubmissions.push(
      captureSubmissions(funder.wallet, emit, () => stage),
    );
    await funder.start(false);
    const night = L.unshieldedToken().raw;
    const waitState = (provider, predicate) =>
      firstValueFrom(
        provider.wallet.state().pipe(
          filter((state) => state.isSynced && predicate(state)),
          timeout({ first: env.timeoutMs }),
        ),
      );
    const genesisState = await tk.syncWallet(funder.wallet);
    const fundingAmount = 50_000n * 1_000_000n;
    assert((genesisState.unshielded.balances[night] ?? 0n) >= fundingAmount);
    await tk.waitForFunds(funder.wallet, env, false, funder.unshieldedKeystore);
    await waitState(funder, (state) => state.dust.balance(new Date()) > 0n);

    step("fresh-buyer-funding");
    const buyer = await tk.MidnightWalletProvider.build(
      tk.logger,
      env,
      randomBytes(32).toString("hex"),
    );
    wallets.push(buyer);
    restoreSubmissions.push(
      captureSubmissions(buyer.wallet, emit, () => stage),
    );
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
      {
        ttl: intentExpiry(),
      },
    );
    const signed = await funder.wallet.signRecipe(recipe, (payload) =>
      funder.unshieldedKeystore.signData(payload),
    );
    const fundingId = await funder.submitTx(
      await funder.wallet.finalizeRecipe(signed),
    );
    emit("submitted", { stage, txId: fundingId });
    emit(
      "funding-finalized",
      publicReceipt(await publicDataProvider.watchForTxData(fundingId)),
    );
    await waitState(
      buyer,
      (state) => (state.unshielded.balances[night] ?? 0n) > 0n,
    );
    step("fresh-buyer-dust");
    await tk.waitForFunds(buyer.wallet, env, false, buyer.unshieldedKeystore);
    await waitState(buyer, (state) => state.dust.balance(new Date()) > 0n);
    emit("fresh-buyer-funded", { nightObserved: true, dustObserved: true });

    const providers = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider: {
        async proveTx(...args) {
          boundary = "proofProvider.proveTx";
          const result = await proof.proveTx(...args);
          emit("proof-provider-completed", { stage });
          boundary = "contracts.continuation";
          return result;
        },
      },
      walletProvider: {
        getCoinPublicKey: () => buyer.getCoinPublicKey(),
        getEncryptionPublicKey: () => buyer.getEncryptionPublicKey(),
        async balanceTx(tx, ttl = new Date(Date.now() + 3_600_000)) {
          boundary = "walletProvider.balanceTx";
          emit("wallet-balancing-started", { stage });
          const recipe = await balanceWithDustReadiness(
            buyer.wallet,
            tx,
            {
              shieldedSecretKeys: buyer.zswapSecretKeys,
              dustSecretKey: buyer.dustSecretKey,
            },
            {
              ttl,
              deadline: expiresAt,
              emit: (event, fields) => emit(event, { stage, ...fields }),
            },
          );
          // Signing/finalization can reserve inputs; they must not be retried with balancing.
          boundary = "walletProvider.signRecipe";
          const signed = await buyer.wallet.signRecipe(recipe, (payload) =>
            buyer.unshieldedKeystore.signData(payload),
          );
          boundary = "walletProvider.finalizeRecipe";
          const result = await buyer.wallet.finalizeRecipe(signed);
          emit("wallet-balancing-completed", { stage });
          boundary = "contracts.continuation";
          return result;
        },
      },
      midnightProvider: {
        async submitTx(tx) {
          const maintenance =
            stage.startsWith("MID-T01-attack-") ||
            stage.startsWith("MID-T01-control-");
          if (stage === "MID-T01-deploy" || env.bootstrapMode === "staged") {
            boundary = "midnightProvider.resourcePreflight";
            await deploymentPreflight(env, tx, (event, fields) =>
              emit(
                maintenance
                  ? "maintenance-resource-preflight"
                  : env.bootstrapMode === "staged"
                    ? "bootstrap-resource-preflight"
                    : event,
                {
                  stage,
                  artifactSetSha256: artifactFingerprints.artifactSetSha256,
                  compileReceiptSha256:
                    artifactFingerprints.compileReceiptSha256,
                  ...fields,
                },
              ),
            );
          }
          if (env.bootstrapMode === "staged") {
            const estimate = await buyer.wallet.calculateTransactionFee(tx);
            assert(typeof estimate === "bigint" && estimate >= 0n);
            const metric = {
              stage,
              feeEstimateSpecksWithMargin: estimate.toString(),
            };
            if (!maintenance) bootstrapMetrics.push(metric);
            emit(
              maintenance
                ? "maintenance-wallet-fee-estimate"
                : "bootstrap-wallet-fee-estimate",
              metric,
            );
          }
          boundary = "midnightProvider.submitTx";
          if (submissionFence) await submissionFence(tx);
          const txId = await buyer.submitTx(tx);
          emit("submitted", { stage, txId });
          boundary = "contracts.continuation";
          return txId;
        },
      },
    };
    if (env.bootstrapMode === "staged") {
      const { runStagedBootstrap } = await import("./bootstrap.mjs");
      const {
        prepareAdmissionObserver,
        createAdmissionObservationCoordinator,
        admissionObservationEvidence,
      } = await import("./admission-observation.mjs");
      const order = env.recoveryAudit ? undefined : freshOrder();
      const observerOptions = order
        ? {
            coinPublicKey: buyer.getCoinPublicKey(),
            verifierKeys,
            artifactReceipt,
            genesisHash: env.genesisHash,
            networkId: env.networkId,
            lockCounter: env.maintenanceControls ? 3n : 2n,
          }
        : undefined;
      // Freeze synthetic public inputs before deployment; this is not a database quote.
      const syntheticFrozenQuote = order
        ? (() => {
            const configuration = structuredClone(order.configuration);
            const { expectedPolicy } = prepareAdmissionObserver({
              ...observerOptions,
              configuration,
            });
            return {
              quote: Object.freeze({
                id: `synthetic-${expectedPolicy.nonce}`,
                version: 1,
                ...expectedPolicy,
              }),
              configuration,
            };
          })()
        : undefined;
      const { runRetainedKeyAudit, observeFinalizedContract } = await import(
        "./maintenance-audit.mjs"
      );
      const { runMaintenanceControls } = await import(
        "./maintenance-controls.mjs"
      );
      const { observeCounterDispatch } = await import(
        "./dispatch-rejection.mjs"
      );
      const observe = (address, blockHash) =>
        publicDataProvider.queryContractState(address, {
          type: "blockHash",
          blockHash,
        });
      // One as-of finalized snapshot reader shared by recovery and both
      // maintenance lanes; an absent afterHeight falls back to the default -1.
      const snapshotAt = (address, afterHeight) =>
        observeFinalizedContract({
          rpc,
          indexer: env.indexer,
          observe: (address) => publicDataProvider.queryContractState(address),
          address,
          afterHeight,
          deadline: Math.min(expiresAt, Date.now() + 60_000),
        });
      const result = env.recoveryAudit
        ? await (await import("./recovery-process.mjs")).runProcessRecovery({
            home: process.env.HOME,
            genesisHash: env.genesisHash,
            artifactSetSha256: artifactReceipt.artifactSetSha256,
            coinPublicKey: buyer.getCoinPublicKey(),
            emit,
            step,
            observe,
            reconcile: (identifiers) =>
              publicDataProvider.watchForTxData(identifiers.at(-1)),
            snapshot: snapshotAt,
            submit: async (unprovenTx, fence) => {
              assert.equal(submissionFence, undefined);
              submissionFence = fence;
              try {
                return await submitTx(providers, { unprovenTx });
              } finally {
                submissionFence = undefined;
              }
            },
          })
        : await runStagedBootstrap({
            configuration: order.configuration,
            coinPublicKey: buyer.getCoinPublicKey(),
            verifierKeys,
            networkId: env.networkId,
            submit: (unprovenTx) => submitTx(providers, { unprovenTx }),
            observe,
            emit,
            step,
            auditControls: env.maintenanceControls
              ? (inputs) =>
                  runMaintenanceControls({
                    ...inputs,
                    inspectFailure: (data) =>
                      observeCounterDispatch(
                        env,
                        data,
                        `${process.env.HOME}/node.stderr.log`,
                      ),
                    emit,
                    step,
                    observe,
                    submit: (unprovenTx) => submitTx(providers, { unprovenTx }),
                    context: () => ({ boundary }),
                    snapshot: snapshotAt,
                  })
              : undefined,
            auditMaintenance: env.maintenanceAudit
              ? (inputs) =>
                  runRetainedKeyAudit({
                    ...inputs,
                    emit,
                    step,
                    submit: (unprovenTx) => submitTx(providers, { unprovenTx }),
                    context: () => ({ boundary }),
                    snapshot: snapshotAt,
                  })
              : undefined,
          });
      assert.equal(bootstrapMetrics.length, 3);
      if (syntheticFrozenQuote) {
        step("MID-T01-admission-observation");
        const coordinateObservation = createAdmissionObservationCoordinator({
          getFrozenQuote: async (quoteId) => {
            assert.equal(quoteId, syntheticFrozenQuote.quote.id);
            return structuredClone(syntheticFrozenQuote);
          },
          observerOptions,
          observationOptions: {
            rpc,
            indexer: env.indexer,
            observe: (address) =>
              publicDataProvider.queryContractState(address),
          },
          timeoutMs: Math.min(expiresAt - Date.now(), 60_000),
        });
        const { observation, quoteVersion } = await coordinateObservation({
          quoteId: syntheticFrozenQuote.quote.id,
          address: result.address,
        });
        emit("admission-observation-verified", {
          ...admissionObservationEvidence(observation),
          observationCoordinator: "trusted-frozen-quote",
          frozenQuoteSource: "synthetic-in-memory-fixture",
          quoteVersion,
          canonicalBindingPersisted: false,
          authenticationVerified: false,
          paymentAuthorizationVerified: false,
        });
      }
      emit("staged-bootstrap-complete-nonadmitted", {
        ...result,
        feeEstimates: bootstrapMetrics,
        totalFeeEstimateSpecksWithMargin: bootstrapMetrics
          .reduce(
            (sum, item) => sum + BigInt(item.feeEstimateSpecksWithMargin),
            0n,
          )
          .toString(),
      });
      return;
    }
    const compiledContract = CompiledContract.make(
      "milo-order",
      generated.Contract,
    ).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets(artifacts),
    );
    const order = freshOrder();
    step("MID-T01-deploy");
    const deployed = await deployContract(providers, {
      compiledContract,
      privateStateId: "buyer",
      initialPrivateState: order.privateState,
      args: [order.configuration],
    });
    const address = deployed.deployTxData.public.contractAddress;
    assert.equal(typeof address, "string");
    const deploymentReceipt = publicReceipt(deployed.deployTxData.public);
    emit("deployment-finalized", { address, ...deploymentReceipt });
    step("MID-T01-bootstrap-inspection");
    const initial = await publicDataProvider.queryContractState(address, {
      type: "blockHash",
      blockHash: deploymentReceipt.blockHash,
    });
    assert(initial);
    const expected = contract.initialState(
      createConstructorContext({}, buyer.getCoinPublicKey()),
      order.configuration,
    );
    assert.deepEqual(
      generated.ledger(initial.data),
      generated.ledger(expected.currentContractState.data),
    );
    verifyContractState(verifierKeys, initial);
    assert.deepEqual(
      initial
        .operations()
        .map((name) =>
          typeof name === "string" ? name : new TextDecoder().decode(name),
        )
        .sort(),
      circuits,
    );
    emit("bootstrap-inspected", {
      initialStateMatches: true,
      completeVerifierSetMatches: true,
      committeeSize: initial.maintenanceAuthority.committee.length,
      threshold: initial.maintenanceAuthority.threshold,
    });

    step("MID-T01-maintenance-lock");
    const signingKey = await privateStateProvider.getSigningKey(address);
    assert(signingKey);
    const oldAuthority = initial.maintenanceAuthority;
    assert.equal(oldAuthority.threshold, 1);
    assert.deepEqual(oldAuthority.committee, [
      L.signatureVerifyingKey(signingKey),
    ]);
    const lockedAuthority = new L.ContractMaintenanceAuthority(
      [],
      1,
      oldAuthority.counter + 1n,
    );
    let update = new L.MaintenanceUpdate(
      address,
      [new L.ReplaceAuthority(lockedAuthority)],
      oldAuthority.counter,
    );
    update = update.addSignature(0n, L.signData(signingKey, update.dataToSign));
    const unprovenTx = maintenanceTx(env.networkId, update);
    const lockReceipt = publicReceipt(
      await submitTx(providers, { unprovenTx }),
    );
    const locked = await publicDataProvider.queryContractState(address, {
      type: "blockHash",
      blockHash: lockReceipt.blockHash,
    });
    assert(locked);
    assert.deepEqual(locked.maintenanceAuthority.committee, []);
    assert.equal(locked.maintenanceAuthority.threshold, 1);
    assert.equal(
      locked.maintenanceAuthority.counter,
      oldAuthority.counter + 1n,
    );
    verifyContractState(verifierKeys, locked);
    assert.deepEqual(
      generated.ledger(locked.data),
      generated.ledger(initial.data),
    );
    emit("maintenance-lock-observed", {
      ...lockReceipt,
      committeeSize: 0,
      threshold: 1,
      adversarialMaintenanceRejectionVerified: false,
    });

    emit("full-bootstrap-complete-nonadmitted", {
      address,
      phase: "DEPLOYED",
      revision: "0",
      immutableOrderAdmission: false,
      reservationExecuted: false,
      r1Complete: false,
      remaining: [
        "adversarial-maintenance-rejection",
        "canonical-quote-binding",
        "private-recovery",
        "reservation",
        "remaining-MID-operation-evidence",
      ],
    });
  } finally {
    emit("stopping-owned-wallets");
    await Promise.allSettled(wallets.map((wallet) => wallet.stop()));
    for (const restore of restoreSubmissions) restore();
    clearTimeout(deadline);
  }
}
main()
  .then(() => process.exit(0))
  .catch(fail);
