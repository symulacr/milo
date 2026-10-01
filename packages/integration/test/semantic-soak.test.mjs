import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  createCircuitContext,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import { generated, witnesses } from "../src/order.mjs";

const { Phase, Role, pureCircuits } = generated;
const bytes = () => new Uint8Array(randomBytes(32));

function order() {
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("undeployed"));
  const nonce = bytes();
  const secrets = { buyer: bytes(), merchant: bytes(), operator: bytes() };
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
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    configuration: {
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
    },
    privateStateFor: (actor) => ({
      actor,
      secret: secrets[actor],
      terms,
      limit: 36_000n,
    }),
  };
}

function ctx(o, state, actor, rev) {
  const data = state?.currentContractState?.data ?? state;
  return createCircuitContext(
    "00".repeat(32),
    "00".repeat(32),
    data,
    o.privateStateFor(actor),
    undefined,
    undefined,
    Math.floor(Date.now() / 1000),
    rev,
  );
}

test("soak: 20 reserve→cancel cycles leave no stuck states", () => {
  for (let i = 0; i < 20; i++) {
    const o = order();
    const contract = new generated.Contract(witnesses);
    const initial = contract.initialState(
      createConstructorContext({}, "00".repeat(32)),
      o.configuration,
    );
    const r1 = contract.impureCircuits.reserve(
      ctx(o, initial, "buyer", 0n),
      0n,
    );
    assert.equal(
      generated.ledger(r1.context.currentQueryContext.state).phase,
      Phase.RESERVED,
    );
    const r2 = contract.impureCircuits.cancelReserved(
      ctx(o, r1.context.currentQueryContext.state, "buyer", 1n),
      1n,
    );
    assert.equal(
      generated.ledger(r2.context.currentQueryContext.state).phase,
      Phase.CANCELLED,
    );
  }
});
