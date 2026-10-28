import { v } from "convex/values";
import { CONSTRUCTOR_ENCODING } from "../packages/backend/src/public-constructor.ts";

const s = v.string();
const n = v.number();

/** A union of string literals from a list. Shared by schema and orders. */
export const literals = <T extends string>(...values: T[]) =>
  v.union(...values.map((value) => v.literal(value)));

/** The matching handler-side reject helper. */
export const rejectWith = (reason: string) => ({ ok: false as const, reason });

/** The seven on-chain phases, in contract order. */
export const CHAIN_PHASES = [
  "DEPLOYED",
  "RESERVED",
  "ACCEPTED",
  "SUBMITTED",
  "DISPUTED",
  "APPROVED",
  "CANCELLED",
] as const;

export const chainPhaseValidator = literals(...CHAIN_PHASES);

/** The nine order stages the workspace shows. */
export const STAGES = ["QUOTE", "PAYMENT_HELD", ...CHAIN_PHASES] as const;

export const stageValidator = literals(...STAGES);

/** The six quote terms. One owner; three modules used to declare it. */
export const quoteTermsValidator = v.object({
  unitPrice: s,
  total: s,
  scopeDigest: s,
  rightsDigest: s,
  paymentPolicy: s,
  salt: s,
});

/**
 * The fields a quote draft is written with. `stripeProvisioning`'s public
 * `quoteArgs` and `trustedProvisioning.writeQuoteDraft`'s args were the same
 * nine fields with one difference (`operatorCommitment`, which only the action
 * computes), so the shared part lives here and each caller adds its own.
 */
export const quoteDraftFields = {
  scopeId: s,
  title: s,
  brief: s,
  amountUsd: n,
  clientEmail: s,
  orderNonce: s,
  merchantCommitment: s,
  termsCommitment: s,
  terms: quoteTermsValidator,
};

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

/**
 * R36 R-13: the wire shape of the four order deadlines, declared once for both
 * producers — `orders.order`'s field and `finalizeQuote`'s echo — because the
 * client substitutes one for the other on the first-accept path.
 */
export const deadlineStringsValidator = v.object({
  acceptance: s,
  delivery: s,
  review: s,
  resolution: s,
});

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
