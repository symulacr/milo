/**
 * D2a happy-path driver (fixed): reserve → accept → submitDelivery → approve.
 * Differences from local-ops.mjs:
 * - balanceTx skips wallet.estimateTransactionFee (hangs on call txs)
 * - uses submitCallTxAsync + timed watchForTxData (avoids indefinite submitTx wait)
 * - appendFileSync trail so progress is never lost to stdout buffering
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { validateArtifacts, validateCohort } from "./artifacts.mjs";
import { localConfig, publicReceipt } from "./config.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { intentExpiry } from "./tx.mjs";

const TRAIL = "/tmp/d2a-happy-trail.jsonl";
mkdirSync("/tmp/d2a-happy-run", { recursive: true });
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
process.on("exit", (code) => {
  try {
    appendFileSync(
      TRAIL,
      JSON.stringify({ event: "process-exit", at: Date.now(), code }) + "\n",
    );
  } catch {}
});
setInterval(() => {
  try {
    appendFileSync(
      TRAIL,
      JSON.stringify({
        event: "heartbeat",
        at: Date.now(),
        stage,
        rss: process.memoryUsage().rss,
      }) + "\n",
    );
  } catch {}
}, 5000).unref();

const bytes32 = () => new Uint8Array(randomBytes(32));

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

async function graphql(env, query, variables) {
  const response = await fetch(env.indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `indexer HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.errors, JSON.stringify(body.errors));
  return body.data;
}

async function main() {
  const env = localConfig(process.env);
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
  const { artifacts, generated, witnesses } = await import("./order.mjs");

  const { pureCircuits, Role } = generated;
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("undeployed"));
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
  const configuration = {
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
    acceptanceDeadline: now + 3600n,
    deliveryDeadline: now + 7200n,
    reviewDeadline: now + 10800n,
    resolutionDeadline: now + 14400n,
  };
  const privateStateFor = (actor) => ({
    actor,
    secret: secrets[actor],
    terms,
    limit: 36_000n,
  });

  const contract = new generated.Contract(witnesses);
  const circuits = Object.keys(contract.provableCircuits).sort();
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
    emit("lte-ctor-start");
    const genesis = new tk.LocalTestEnvironment(tk.logger);
    emit("lte-ctor-done", { hasSeed: !!genesis.genesisMintWalletSeed?.[0] });
    emit("funder-build-start");
    const funder = await tk.MidnightWalletProvider.build(
      tk.logger,
      env,
      genesis.genesisMintWalletSeed[0],
    );
    emit("funder-build-done");
    wallets.push(funder);
    emit("funder-start-begin");
    await funder.start(false);
    emit("funder-start-done");
    const night = L.unshieldedToken().raw;
    const waitState = (provider, predicate) =>
      firstValueFrom(
        provider.wallet.state().pipe(
          filter((state) => state.isSynced && predicate(state)),
          timeout({ first: env.timeoutMs }),
        ),
      );
    emit("sync-funder-begin");
    await tk.syncWallet(funder.wallet);
    emit("sync-funder-done");
    const fundingAmount = 50_000n * 1_000_000n;
    emit("wait-funds-begin");
    await tk.waitForFunds(funder.wallet, env, false, funder.unshieldedKeystore);
    emit("wait-funds-done");
    await waitState(funder, (state) => state.dust.balance(new Date()) > 0n);
    emit("funder-dust-ready");

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
    emit("buyer-balance-wait");
    await waitState(
      buyer,
      (state) => (state.unshielded.balances[night] ?? 0n) > 0n,
    );
    emit("buyer-balance-ok");
    emit("buyer-funds-wait");
    await tk.waitForFunds(buyer.wallet, env, false, buyer.unshieldedKeystore);
    emit("buyer-funds-ok");
    emit("buyer-dust-wait");
    await waitState(buyer, (state) => state.dust.balance(new Date()) > 0n);
    emit("buyer-dust-ok");

    // balanceTx WITHOUT estimateTransactionFee — that call hung >30min on call txs
    // (local-ops.mjs dust-base-fee-covered then silence). Deploy path is fine with
    // it; call txs are not. Just wait for dust and balance; insufficient dust throws.
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
          emit("balance-start", {
            note: "skip-estimate",
            tokenKinds: "dust",
            eraseProofsForFee: true,
          });
          await firstValueFrom(
            buyer.wallet.state().pipe(
              filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
              timeout({ first: Math.max(1_000, expiresAt - Date.now()) }),
            ),
          );
          emit("dust-present");
          // feesWithMargin on a proved call tx spins in WASM (deploy is fine).
          // Fee math must ignore proof bytes; dryRunFee already eraseProofs, but
          // computeBalancingRecipe's initial calculateFee does not. Patch once.
          if (!globalThis.__miloFeesEraseProofs) {
            globalThis.__miloFeesEraseProofs = true;
            const proto = Object.getPrototypeOf(tx);
            // feesWithMargin (WASM) spins on proved call txs; deploy is fine.
            // Local disposable chain: use a fixed generous fee so the dust
            // fixed-point iteration converges in one step. 2000 NIGHT in
            // smallest units (1 NIGHT = 1e6).
            const LOCAL_FEE = 2_000_000_000n;
            proto.feesWithMargin = function patchedFeesWithMargin() {
              return LOCAL_FEE;
            };
          }
          emit("balance-unbound-start");
          const recipe = await buyer.wallet.balanceUnboundTransaction(
            tx,
            {
              shieldedSecretKeys: buyer.zswapSecretKeys,
              dustSecretKey: buyer.dustSecretKey,
            },
            { ttl, tokenKindsToBalance: ["dust"] },
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

    step("MID-T01-staged-deploy");
    const { runStagedDeploy, loadOrCreateMaintenanceKey } = await import(
      "./staged-deploy.mjs"
    );
    const { path: keyPath, key: signingKey } =
      await loadOrCreateMaintenanceKey("/tmp/d2a-happy-run");
    const receiptPath = "/tmp/d2a-happy-run/staged-deploy-local.json";
    const receipt = await runStagedDeploy({
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
            `happy-${actor}`,
            privateStateFor(actor),
          );
      },
    });
    const address = receipt.address;
    assert.equal(typeof address, "string");
    assert.equal(receipt.status, "complete");
    assert.equal(receipt.finalCircuitCount, 14);
    emit("deployment-finalized", {
      address,
      deployTxId: receipt.deploy?.txId ?? null,
      deployTxHash: receipt.deploy?.txHash ?? null,
      deployBlockHeight: receipt.deploy?.blockHeight ?? null,
      insertTxIds: (receipt.inserts ?? []).map((i) => i.txId),
      insertTxHashes: (receipt.inserts ?? []).map((i) => i.txHash),
      finalCircuitCount: receipt.finalCircuitCount,
      maintenanceKeyPath: keyPath,
    });

    step("handles");
    const compiledContract = CompiledContract.make(
      "milo-order",
      generated.Contract,
    ).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets(artifacts),
    );
    await findDeployedContract(providers, {
      contractAddress: address,
      compiledContract,
      privateStateId: "happy-buyer",
      initialPrivateState: privateStateFor("buyer"),
    });
    emit("handle-ready", { actor: "buyer" });
    await findDeployedContract(providers, {
      contractAddress: address,
      compiledContract,
      privateStateId: "happy-merchant",
      initialPrivateState: privateStateFor("merchant"),
    });
    emit("handle-ready", { actor: "merchant" });

    const delivery = bytes32();
    emit("delivery-commitment", {
      deliveryHex: Buffer.from(delivery).toString("hex"),
    });
    const happy = [
      {
        circuit: "reserve",
        actor: "buyer",
        revision: 0n,
        args: () => [],
        pid: "happy-buyer",
      },
      {
        circuit: "accept",
        actor: "merchant",
        revision: 1n,
        args: () => [],
        pid: "happy-merchant",
      },
      {
        circuit: "submitDelivery",
        actor: "merchant",
        revision: 2n,
        args: () => [delivery],
        pid: "happy-merchant",
      },
      {
        circuit: "approve",
        actor: "buyer",
        revision: 3n,
        args: () => [delivery],
        pid: "happy-buyer",
      },
    ];

    const receipts = [];
    for (const item of happy) {
      step(`call-${item.circuit}`);
      emit("call-start", {
        circuit: item.circuit,
        actor: item.actor,
        revision: item.revision.toString(),
      });
      const submitted = await withTimeout(
        submitCallTxAsync(providers, {
          compiledContract,
          circuitId: item.circuit,
          contractAddress: address,
          privateStateId: item.pid,
          args: [item.revision, ...item.args()],
        }),
        240_000,
        `submitCallTxAsync:${item.circuit}`,
      );
      const txId = submitted.txId;
      emit("submitted", { circuit: item.circuit, txId });
      const finalized = await withTimeout(
        publicDataProvider.watchForTxData(txId),
        120_000,
        `watchForTxData:${item.circuit}`,
      );
      const receipt = publicReceipt(finalized);
      if (receipt.status === "SucceedEntirely") {
        await privateStateProvider.set(
          item.pid,
          submitted.callTxData.private.nextPrivateState,
        );
      }
      emit("call-finalized", {
        circuit: item.circuit,
        actor: item.actor,
        revision: item.revision.toString(),
        ...receipt,
      });
      receipts.push({ circuit: item.circuit, actor: item.actor, ...receipt });
    }

    step("indexer-read-back");
    const tip = await graphql(env, `query { block { height hash } }`);
    const action = await graphql(
      env,
      `query ($address: String!) {
         contractAction(address: $address) {
           __typename address state transaction { hash block { height } }
         }
       }`,
      { address },
    );
    const txReads = [];
    for (const item of receipts) {
      const found = await graphql(
        env,
        `query ($hash: String!) {
           transactions(offset: { hash: $hash }) { hash block { height } }
         }`,
        { hash: item.txId },
      ).catch(() => null);
      txReads.push({
        circuit: item.circuit,
        txId: item.txId,
        txHash: item.txHash,
        indexed: Boolean(found?.transactions?.length),
        blockHeight:
          found?.transactions?.[0]?.block?.height ?? item.blockHeight,
      });
    }
    const state = await publicDataProvider.queryContractState(address);
    const ops = state
      .operations()
      .map((name) =>
        typeof name === "string" ? name : new TextDecoder().decode(name),
      )
      .sort();
    const ledger = generated.ledger(state.data);

    emit("indexer-read-back", {
      address,
      tipHeight: tip?.block?.height ?? null,
      tipHash: tip?.block?.hash ?? null,
      contractActionIndexed: Boolean(action?.contractAction),
      actionTxHash: action?.contractAction?.transaction?.hash ?? null,
      actionBlockHeight:
        action?.contractAction?.transaction?.block?.height ?? null,
      stateBytes: action?.contractAction?.state?.length ?? 0,
      operations: ops,
      txReads,
      ledgerPhase: String(ledger?.phase),
      ledgerRevision: String(ledger?.revision),
    });

    const result = {
      address,
      phase: String(ledger?.phase),
      revision: String(ledger?.revision),
      circuits: happy.map((h) => h.circuit),
      receipts,
      artifactSetSha256: artifactReceipt.artifactSetSha256,
      genesisHash: env.genesisHash,
      networkId: env.networkId,
      deploy: {
        txId: receipt.deploy?.txId ?? null,
        txHash: receipt.deploy?.txHash ?? null,
        blockHeight: receipt.deploy?.blockHeight ?? null,
      },
      inserts: receipt.inserts ?? [],
    };
    writeFileSync(
      "/tmp/d2a-happy-run/happy-path.json",
      JSON.stringify(result, null, 2),
    );
    emit("happy-path-complete", {
      ...result,
      immutableOrderAdmission: false,
      r1Complete: false,
      remaining: [
        "adversarial-maintenance-rejection",
        "canonical-quote-binding",
        "private-recovery",
        "remaining-MID-operation-evidence",
        "preprod-happy-path",
      ],
    });
  } finally {
    emit("stopping-owned-wallets");
    await Promise.allSettled(wallets.map((wallet) => wallet.stop()));
  }
}
main()
  .then(() => process.exit(0))
  .catch(fail);
