import { v } from "convex/values";
import { CONSTRUCTOR_ENCODING } from "../packages/backend/src/public-constructor.mjs";

export const publicConstructorFields = {
  constructorVersion: v.literal(1),
  constructorEncoding: v.literal(CONSTRUCTOR_ENCODING),
  buyerCommitment: v.string(),
  merchantCommitment: v.string(),
  operatorCommitment: v.string(),
};

const deadlines = {
  acceptanceDeadlineSeconds: v.number(),
  deliveryDeadlineSeconds: v.number(),
  reviewDeadlineSeconds: v.number(),
  resolutionDeadlineSeconds: v.number(),
};
const fingerprints = {
  termsCommitment: v.string(),
  artifactFingerprint: v.string(),
  keySetFingerprint: v.string(),
  rolesFingerprint: v.string(),
  initialStateFingerprint: v.string(),
  genesisHash: v.string(),
};
export const frozenQuoteFields = {
  ...publicConstructorFields,
  id: v.string(),
  scopeId: v.string(),
  network: v.literal("preprod"),
  nonce: v.string(),
  version: v.number(),
  amountMinor: v.number(),
  currency: v.string(),
  buyerAccountId: v.string(),
  ...fingerprints,
  ...deadlines,
};
export const deploymentObservationFields = {
  ...publicConstructorFields,
  id: v.string(),
  quoteId: v.string(),
  quoteVersion: v.number(),
  observationVersion: v.literal(2),
  source: v.literal("chain-observer"),
  network: v.literal("preprod"),
  nonce: v.string(),
  address: v.string(),
  phase: v.literal("DEPLOYED"),
  revision: v.literal(0),
  ...fingerprints,
  ...deadlines,
  entrypoints: v.array(v.string()),
  maintenancePolicy: v.literal("locked"),
  maintenanceReceiptFingerprint: v.string(),
  blockHash: v.string(),
  blockHeight: v.number(),
  stateFingerprint: v.string(),
  observedAt: v.number(),
};
export const paymentAuthorization = v.object({
  id: v.string(),
  quoteId: v.string(),
  quoteVersion: v.number(),
  buyerAccountId: v.string(),
  amountMinor: v.number(),
  currency: v.string(),
  usableFrom: v.number(),
  usableUntil: v.number(),
  captureBeforeMs: v.number(),
  source: v.literal("payment-observer"),
  status: v.union(
    v.literal("pending"),
    v.literal("authorized"),
    v.literal("captured"),
    v.literal("voided"),
    v.literal("failed"),
  ),
  providerReceiptFingerprint: v.string(),
});
export const bindingFields = {
  network: v.string(),
  nonce: v.string(),
  address: v.string(),
  quoteId: v.string(),
  observationId: v.string(),
  authorizationId: v.string(),
  boundAt: v.number(),
};
export const admissionArgs = {
  quoteId: v.string(),
  expectedQuoteVersion: v.number(),
  observationId: v.string(),
  authorizationId: v.id("paymentIntents"),
  address: v.string(),
};
export const admissionResult = v.union(
  v.object({ kind: v.literal("bound"), binding: v.object(bindingFields) }),
  v.object({
    kind: v.literal("already-bound"),
    binding: v.object(bindingFields),
  }),
  v.object({ kind: v.literal("rejected"), reason: v.string() }),
);
