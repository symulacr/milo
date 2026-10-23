import { v } from "convex/values";
import { CONSTRUCTOR_ENCODING } from "../packages/backend/src/public-constructor.ts";

const s = v.string();
const n = v.number();

export const publicConstructorFields = {
  constructorVersion: v.literal(1),
  constructorEncoding: v.literal(CONSTRUCTOR_ENCODING),
  buyerCommitment: s,
  merchantCommitment: s,
  operatorCommitment: s,
};

const sharedQuoteObservationFields = {
  termsCommitment: s,
  artifactFingerprint: s,
  keySetFingerprint: s,
  rolesFingerprint: s,
  initialStateFingerprint: s,
  genesisHash: s,
  acceptanceDeadlineSeconds: n,
  deliveryDeadlineSeconds: n,
  reviewDeadlineSeconds: n,
  resolutionDeadlineSeconds: n,
};

export const frozenQuoteFields = {
  ...publicConstructorFields,
  id: s,
  scopeId: s,
  network: v.literal("preprod"),
  nonce: s,
  version: n,
  amountMinor: n,
  currency: s,
  buyerAccountId: s,
  ...sharedQuoteObservationFields,
};

export const imagePackPolicyFields = {
  serviceVersion: v.literal(1),
  packQuantity: v.literal(1),
  outputCount: v.literal(3),
  unitPriceMinor: n,
};

export const deploymentObservationFields = {
  ...publicConstructorFields,
  id: s,
  quoteId: s,
  quoteVersion: n,
  observationVersion: v.literal(2),
  source: v.literal("chain-observer"),
  network: v.literal("preprod"),
  nonce: s,
  address: s,
  phase: v.literal("DEPLOYED"),
  revision: v.literal(0),
  ...sharedQuoteObservationFields,
  entrypoints: v.array(s),
  maintenancePolicy: v.literal("locked"),
  maintenanceReceiptFingerprint: s,
  blockHash: s,
  blockHeight: n,
  stateFingerprint: s,
  observedAt: n,
};

export const paymentAuthorization = v.object({
  id: s,
  quoteId: s,
  quoteVersion: n,
  buyerAccountId: s,
  amountMinor: n,
  currency: s,
  usableFrom: n,
  usableUntil: n,
  captureBeforeMs: n,
  source: v.literal("payment-observer"),
  status: v.union(
    v.literal("pending"),
    v.literal("authorized"),
    v.literal("captured"),
    v.literal("voided"),
    v.literal("failed"),
  ),
  providerReceiptFingerprint: s,
});

export const bindingFields = {
  network: s,
  nonce: s,
  address: s,
  quoteId: s,
  observationId: s,
  authorizationId: s,
  boundAt: n,
};

export const admissionArgs = {
  quoteId: s,
  expectedQuoteVersion: n,
  observationId: s,
  authorizationId: v.id("paymentIntents"),
  address: s,
};

export const admissionResult = v.union(
  v.object({ kind: v.literal("bound"), binding: v.object(bindingFields) }),
  v.object({
    kind: v.literal("already-bound"),
    binding: v.object(bindingFields),
  }),
  v.object({ kind: v.literal("rejected"), reason: s }),
);
