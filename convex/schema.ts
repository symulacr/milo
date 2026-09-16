import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  bindingFields,
  deploymentObservationFields,
  frozenQuoteFields,
  paymentAuthorization,
} from "./admissionValidators";

// Catalog approval and customer linking remain operator-provisioned, never browser-writable.
export default defineSchema({
  trustedProvisioning: defineTable({
    kind: v.union(
      v.literal("membership"),
      v.literal("quote"),
      v.literal("customer"),
    ),
    key: v.string(),
    version: v.number(),
    payload: v.string(),
    targetId: v.union(
      v.id("memberships"),
      v.id("approvedQuotes"),
      v.id("stripeCustomers"),
    ),
    status: v.union(v.literal("active"), v.literal("revoked")),
  }).index("by_kind_key", ["kind", "key"]),
  trustedProvisioningAudit: defineTable({
    requestId: v.string(),
    operation: v.string(),
    operatorId: v.string(),
    sourceId: v.string(),
    evidenceFingerprint: v.string(),
    recordedAt: v.number(),
    bindingId: v.id("trustedProvisioning"),
  }).index("by_request", ["requestId"]),
  approvedQuotes: defineTable({
    ...frozenQuoteFields,
    imagePackPolicy: v.object({
      serviceVersion: v.literal(1),
      packQuantity: v.literal(1),
      outputCount: v.literal(3),
      unitPriceMinor: v.number(),
    }),
    expiresAt: v.number(),
  }).index("by_quote", ["id"]),
  stripeCustomers: defineTable({
    buyerAccountId: v.string(),
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
  })
    .index("by_buyer", ["buyerAccountId"])
    .index("by_provider_customer", ["stripeAccountId", "stripeCustomerId"]),
  paymentJobs: defineTable({
    quoteId: v.string(),
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
    consentSubject: v.string(),
    consentAt: v.number(),
    generation: v.number(),
    startedAt: v.number(),
    firstAttemptAt: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("create"), v.literal("observe"))),
    state: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("blocked"),
    ),
  }).index("by_quote", ["quoteId"]),
  frozenQuotes: defineTable(frozenQuoteFields).index("by_quote", ["id"]),
  paymentMonitors: defineTable({
    claimed: v.optional(v.boolean()),
    quoteId: v.string(),
    paymentIntentId: v.id("paymentIntents"),
    consentSubject: v.string(),
    binding: v.string(),
    generation: v.number(),
    attempt: v.number(),
    consentAt: v.number(),
    expiresAt: v.number(),
    nextAt: v.number(),
    startedAt: v.number(),
    state: v.union(
      v.literal("waiting"),
      v.literal("running"),
      v.literal("stopped"),
    ),
  }).index("by_quote", ["quoteId"]),
  deploymentObservations: defineTable(deploymentObservationFields).index(
    "by_observation",
    ["id"],
  ),
  // One current result per immutable intent; historical receipts belong elsewhere.
  paymentObservations: defineTable({
    paymentIntentId: v.id("paymentIntents"),
    authorization: paymentAuthorization,
    monitorId: v.optional(v.id("paymentMonitors")),
    monitorGeneration: v.optional(v.number()),
  }).index("by_payment_intent", ["paymentIntentId"]),
  admissionTimingPolicies: defineTable({
    network: v.literal("preprod"),
    captureSafetyMarginMs: v.number(),
  }).index("by_network", ["network"]),
  canonicalBindings: defineTable(bindingFields)
    .index("by_network_nonce", ["network", "nonce"])
    .index("by_address", ["address"])
    .index("by_quote", ["quoteId"]),
  memberships: defineTable({
    privySubject: v.string(),
    accountId: v.string(),
    scopeId: v.string(),
    role: v.union(
      v.literal("buyer"),
      v.literal("merchant"),
      v.literal("operator"),
    ),
    status: v.union(v.literal("active"), v.literal("revoked")),
  }).index("by_subject_scope", ["privySubject", "scopeId"]),
  paymentIntents: defineTable({
    quoteId: v.string(),
    quoteVersion: v.number(),
    buyerAccountId: v.string(),
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
    stripePaymentIntentId: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    environment: v.literal("test"),
    network: v.literal("preprod"),
  })
    .index("by_quote", ["quoteId"])
    .index("by_provider_intent", ["stripePaymentIntentId"]),
});
