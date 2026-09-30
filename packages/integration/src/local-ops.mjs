/**
 * D2a local happy-path driver: reserve → accept → submitDelivery → approve.
 * Reuses local.mjs provider wiring and preprod-actions callTx patterns.
 * Multi-actor order (buyer/merchant/operator secrets) so merchant circuits
 * can prove; network label is `undeployed` to match MILO_LOCAL_NETWORK_ID.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { validateArtifacts, validateCohort } from "./artifacts.mjs";
import { localConfig, publicReceipt } from "./config.mjs";
import { errorDiagnostics } from "./diagnostics.mjs";
import { balanceWithDustReadiness } from "./dust.mjs";
import { intentExpiry } from "./tx.mjs";

let stage = "configuration";
const emit = (event, fields = {}) =>
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
const fail = (error) => {
  emit("failed", {
    stage,
    ...errorDiagnostics(error),
    immutableOrderAdmission: false,
    r1Complete: false,
  });
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

const bytes32 = () => new Uint8Array(randomBytes(32));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
  const deadline = setTimeout(() => {
    emit("timeout", { stage });
    process.exit(1);
  }, env.timeoutMs);
  const step = (name) => {
    stage = name;
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
  const { findDeployedContract, submitTx } = await import(
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

  // Multi-actor order: same shape as preprod-actions.miloOrder, network `undeployed`.
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
    const fundingAmount = 50_000n * 1_000_000n;
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
    emit("submitted", { stage, txId: fundingId });
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
          const result = await proof.proveTx(...args);
          emit("proof-provider-completed", { stage });
          return result;
        },
      },
      walletProvider: {
        getCoinPublicKey: () => buyer.getCoinPublicKey(),
        getEncryptionPublicKey: () => buyer.getEncryptionPublicKey(),
        async balanceTx(tx, ttl = new Date(Date.now() + 3_600_000)) {
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
          const signed = await buyer.wallet.signRecipe(recipe, (payload) =>
            buyer.unshieldedKeystore.signData(payload),
          );
          return await buyer.wallet.finalizeRecipe(signed);
        },
      },
      midnightProvider: {
        async submitTx(tx) {
          const txId = await buyer.submitTx(tx);
          emit("submitted", { stage, txId });
          return txId;
        },
      },
    };

    step("MID-T01-staged-deploy");
    // Local node rejects a single 14-key deploy (RPC 1010 ExhaustsResources),
    // same as Preprod. Use the staged 7+7 path that staged bootstrap already proved.
    const { runStagedDeploy, loadOrCreateMaintenanceKey } = await import(
      "./staged-deploy.mjs"
    );
    const { path: keyPath, key: signingKey } =
      await loadOrCreateMaintenanceKey("/tmp/d2a-ops-run");
    const stagedEmit = async (event, fields = {}) => {
      emit(event, { stage, ...fields });
    };
    const receiptPath = "/tmp/d2a-ops-run/staged-deploy-local.json";
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
        publicDataProvider.queryContractState(address, {
          type: "blockHash",
          blockHash,
        }),
      emit: stagedEmit,
      receiptPath,
      onDeployed: async ({ address: landed }) => {
        privateStateProvider.setContractAddress(landed);
        for (const actor of ["buyer", "merchant", "operator"])
          await privateStateProvider.set(
            `local-${actor}`,
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
    const byActor = {};
    for (const actor of ["buyer", "merchant"]) {
      byActor[actor] = await findDeployedContract(providers, {
        contractAddress: address,
        compiledContract,
        privateStateId: `local-${actor}`,
        initialPrivateState: privateStateFor(actor),
      });
      emit("handle-ready", { actor });
    }

    // approve(expectedDelivery) must equal what submitDelivery submitted.
    const delivery = bytes32();
    const happy = [
      {
        circuit: "reserve",
        actor: "buyer",
        revision: 0n,
        args: () => [],
      },
      {
        circuit: "accept",
        actor: "merchant",
        revision: 1n,
        args: () => [],
      },
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

    const receipts = [];
    for (const item of happy) {
      step(`call-${item.circuit}`);
      const result = await byActor[item.actor].callTx[item.circuit](
        item.revision,
        ...item.args(),
      );
      const receipt = publicReceipt(result);
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
        indexed: Boolean(found?.transactions?.length),
        blockHeight: found?.transactions?.[0]?.block?.height ?? null,
      });
    }
    const state = await publicDataProvider.queryContractState(address);
    const ops = state
      .operations()
      .map((name) =>
        typeof name === "string" ? name : new TextDecoder().decode(name),
      )
      .sort();

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
      ledgerPhase: String(generated.ledger(state.data)?.phase),
      ledgerRevision: String(generated.ledger(state.data)?.revision),
    });

    emit("happy-path-complete", {
      address,
      phase: "COMPLETED",
      revision: "4",
      circuits: happy.map((h) => h.circuit),
      receipts,
      artifactSetSha256: artifactReceipt.artifactSetSha256,
      genesisHash: env.genesisHash,
      networkId: env.networkId,
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
    clearTimeout(deadline);
  }
}
main()
  .then(() => process.exit(0))
  .catch(fail);
