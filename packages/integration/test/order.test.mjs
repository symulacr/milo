import assert from "node:assert/strict";
import test from "node:test";
import {
  createCircuitContext,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import { artifacts, freshOrder, generated, witnesses } from "../src/order.mjs";

test("MID-T01 isolated original generated runtime constructs fresh bootstrap", () => {
  const first = freshOrder();
  const second = freshOrder();
  assert.notDeepEqual(
    first.configuration.orderNonce,
    second.configuration.orderNonce,
  );
  assert.notDeepEqual(first.privateState.secret, second.privateState.secret);
  assert.notDeepEqual(
    first.privateState.terms.salt,
    second.privateState.terms.salt,
  );
  const contract = new generated.Contract(witnesses);
  const state = contract.initialState(
    createConstructorContext({}, "00".repeat(32)),
    first.configuration,
  );
  assert.equal(
    generated.ledger(state.currentContractState.data).phase,
    generated.Phase.DEPLOYED,
  );
});
test("MID-T02 buyer-only witnesses run generated reserve; other actor cannot supply buyer witness", () => {
  const order = freshOrder();
  const contract = new generated.Contract(witnesses);
  const state = contract.initialState(
    createConstructorContext({}, "00".repeat(32)),
    order.configuration,
  );
  const context = createCircuitContext(
    "00".repeat(32),
    "00".repeat(32),
    state.currentContractState.data,
    order.privateState,
    undefined,
    undefined,
    Math.floor(Date.now() / 1000),
  );
  const result = contract.impureCircuits.reserve(context, 0n);
  assert.equal(
    generated.ledger(result.context.currentQueryContext.state).phase,
    generated.Phase.RESERVED,
  );
  assert.throws(
    () =>
      witnesses.buyerSecret({
        privateState: { actor: "merchant", secret: order.privateState.secret },
      }),
    /Other actor/,
  );
});

test("MID-T01 SDK constructs an unproven deployment with the isolated original artifacts", async () => {
  const { CompiledContract } = await import(
    "@midnight-ntwrk/midnight-js-protocol/compact-js"
  );
  const { sampleSigningKey, ZswapSecretKeys } = await import(
    "@midnight-ntwrk/midnight-js-protocol/ledger"
  );
  const { setNetworkId } = await import(
    "@midnight-ntwrk/midnight-js-network-id"
  );
  const { createUnprovenDeployTxFromVerifierKeys, verifyContractState } =
    await import("@midnight-ntwrk/midnight-js-contracts");
  const { NodeZkConfigProvider } = await import(
    "@midnight-ntwrk/midnight-js-node-zk-config-provider"
  );
  setNetworkId("undeployed");
  const order = freshOrder();
  const zk = new NodeZkConfigProvider(artifacts);
  const compiledContract = CompiledContract.make(
    "milo-order",
    generated.Contract,
  ).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(artifacts),
  );
  const keys = ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(1));
  const deployment = await createUnprovenDeployTxFromVerifierKeys(
    zk,
    keys.coinPublicKey,
    {
      compiledContract,
      signingKey: sampleSigningKey(),
      initialPrivateState: order.privateState,
      args: [order.configuration],
    },
    keys.encryptionPublicKey,
  );
  assert.equal(typeof deployment.public.contractAddress, "string");
  const identifiers = deployment.private.unprovenTx.identifiers();
  assert(identifiers.length > 0);
  for (const identifier of identifiers)
    assert.match(identifier, /^[0-9a-f]{66}$/);
  const initial = deployment.public.initialContractState;
  const circuits = Object.keys(
    new generated.Contract(witnesses).provableCircuits,
  );
  verifyContractState(await zk.getVerifierKeys(circuits), initial);
  assert.equal(generated.ledger(initial.data).phase, generated.Phase.DEPLOYED);
  assert.equal(initial.maintenanceAuthority.threshold, 1);
  assert.equal(initial.maintenanceAuthority.committee.length, 1);
});
