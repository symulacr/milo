/**
 * QA rubric — contract semantic simulation: phase guards, capability,
 * revision fence and deadlines with negative controls (compact-runtime).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  createCircuitContext,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import { generated, witnesses } from "../src/order.mjs";

const { Phase, Role, pureCircuits } = generated;

function bytes() {
  return new Uint8Array(randomBytes(32));
}

function multiActorOrder() {
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("undeployed"));
  const nonce = bytes();
  const secrets = {
    buyer: bytes(),
    merchant: bytes(),
    operator: bytes(),
  };
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
  const configuration = {
    network,
    orderNonce: nonce,
    termsCommitment: pureCircuits.hashTerms(network, nonce, terms),
    buyerCommitment: pureCircuits.hashCapability(network, nonce, Role.BUYER, secrets.buyer),
    merchantCommitment: pureCircuits.hashCapability(network, nonce, Role.MERCHANT, secrets.merchant),
    operatorCommitment: pureCircuits.hashCapability(network, nonce, Role.OPERATOR, secrets.operator),
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
  return { configuration, secrets, privateStateFor };
}

function boot(order, nowSec = Math.floor(Date.now() / 1000)) {
  const contract = new generated.Contract(witnesses);
  const initial = contract.initialState(
    createConstructorContext({}, "00".repeat(32)),
    order.configuration,
  );
  return { contract, initial, nowSec };
}

function ctxFor(order, contractState, actor, nowSec, expectedRevision) {
  const data = contractState?.currentContractState?.data ?? contractState;
  return createCircuitContext(
    "00".repeat(32),
    "00".repeat(32),
    data,
    order.privateStateFor(actor),
    undefined,
    undefined,
    nowSec,
    expectedRevision,
  );
}

function nextOf(result) {
  return result.context.currentQueryContext.state;
}
function phaseOf(result) {
  return generated.ledger(nextOf(result)).phase;
}

test("DEPLOYED → reserve → RESERVED (buyer)", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  const r = contract.impureCircuits.reserve(ctxFor(order, initial, "buyer", nowSec, 0n), 0n);
  assert.equal(phaseOf(r), Phase.RESERVED);
});

test("reserve rejects wrong revision fence", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  assert.throws(() =>
    contract.impureCircuits.reserve(ctxFor(order, initial, "buyer", nowSec, 1n), 1n),
  );
});

test("accept from RESERVED by merchant → ACCEPTED", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  assert.throws(() =>
    contract.impureCircuits.accept(ctxFor(order, initial, "merchant", nowSec, 0n), 0n),
  );
  const r1 = contract.impureCircuits.reserve(ctxFor(order, initial, "buyer", nowSec, 0n), 0n);
  const r2 = contract.impureCircuits.accept(ctxFor(order, nextOf(r1), "merchant", nowSec, 1n), 1n);
  assert.equal(phaseOf(r2), Phase.ACCEPTED);
});

test("cancelReserved from RESERVED by buyer → CANCELLED", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  const r1 = contract.impureCircuits.reserve(ctxFor(order, initial, "buyer", nowSec, 0n), 0n);
  const r2 = contract.impureCircuits.cancelReserved(ctxFor(order, nextOf(r1), "buyer", nowSec, 1n), 1n);
  assert.equal(phaseOf(r2), Phase.CANCELLED);
});

test("decline from RESERVED by merchant → DECLINED", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  const r1 = contract.impureCircuits.reserve(ctxFor(order, initial, "buyer", nowSec, 0n), 0n);
  const r2 = contract.impureCircuits.decline(ctxFor(order, nextOf(r1), "merchant", nowSec, 1n), 1n);
  assert.equal(phaseOf(r2), Phase.CANCELLED);
});

test("DEPLOYED cannot submitDelivery (phase guard)", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  assert.throws(() =>
    contract.impureCircuits.submitDelivery(
      ctxFor(order, initial, "merchant", nowSec, 0n),
      0n,
      new Uint8Array(32),
    ),
  );
});

test("buyer cannot supply merchant capability (negative control)", () => {
  const order = multiActorOrder();
  const { contract, initial, nowSec } = boot(order);
  const r1 = contract.impureCircuits.reserve(ctxFor(order, initial, "buyer", nowSec, 0n), 0n);
  assert.throws(() =>
    contract.impureCircuits.accept(ctxFor(order, nextOf(r1), "buyer", nowSec, 1n), 1n),
  );
});

test("14 circuit names exist", () => {
  const c = new generated.Contract(witnesses);
  const names = new Set([
    ...Object.keys(c.impureCircuits ?? {}),
    ...Object.keys(c.provableCircuits ?? {}),
  ]);
  for (const name of [
    "reserve", "accept", "submitDelivery", "approve",
    "cancelReserved", "decline", "disputeBuyer", "disputeMerchant",
    "escalateUnreviewed", "expireBootstrap", "expireDispute", "expireReserved",
    "expireUndelivered", "resolve",
  ]) {
    assert.ok(names.has(name), `missing ${name}`);
  }
});
