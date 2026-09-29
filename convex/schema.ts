import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  bindingFields,
  deploymentObservationFields,
  frozenQuoteFields,
  imagePackPolicyFields,
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
    imagePackPolicy: v.object(imagePackPolicyFields),
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
  deploymentObservations: defineTable(deploymentObservationFields)
    .index("by_observation", ["id"])
    .index("by_address", ["address"]),
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
  orders: defineTable({
    id: v.string(),
    buyerId: v.string(),
    merchantId: v.string(),
    disputeOperatorId: v.optional(v.string()),
    scopeId: v.string(),
    profile: v.literal("image-pack-v1"),
    outputCount: v.literal(3),
    phase: v.union(
      v.literal("ACCEPTED"),
      v.literal("SUBMITTED"),
      v.literal("DISPUTED"),
      v.literal("TERMINAL"),
    ),
    revision: v.number(),
  }).index("by_order", ["id"]),
  // One-time upload grant; storageId binds only after attachUpload.
  fileGrants: defineTable({
    orderId: v.string(),
    uploaderId: v.string(),
    expiresAt: v.number(),
    consumed: v.boolean(),
    storageId: v.optional(v.string()),
    inspected: v.optional(
      v.object({
        storageId: v.string(),
        sha256: v.string(),
        contentType: v.string(),
        byteLength: v.number(),
      }),
    ),
  })
    .index("by_order", ["orderId"])
    .index("by_storage", ["storageId"]),
  // Immutable frozen delivery manifest; manifest is the digest-bound commitment.
  deliveries: defineTable({
    orderId: v.string(),
    merchantId: v.string(),
    revision: v.number(),
    files: v.array(
      v.object({
        grantId: v.string(),
        storageId: v.string(),
        sha256: v.string(),
        contentType: v.string(),
        byteLength: v.number(),
      }),
    ),
    manifest: v.string(),
  }).index("by_order", ["orderId"]),
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
  // Durable webhook receipt. Business uniqueness is (provider, accountId, eventId).
  paymentInbox: defineTable({
    provider: v.literal("stripe"),
    accountId: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    digest: v.string(),
    paymentIntentRef: v.union(v.string(), v.null()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_provider_event", ["provider", "accountId", "eventId"])
    .index("by_account", ["accountId"]),
  // Settlement outbox. One identity per (orderId, action, contractRevision).
  // by_intent is a bound-scan index (.take(64)); never .unique() — F-21.
  settlementOps: defineTable({
    orderId: v.string(),
    action: v.union(v.literal("capture"), v.literal("void")),
    contractRevision: v.number(),
    paymentIntentId: v.id("paymentIntents"),
    quoteId: v.string(),
    quoteVersion: v.number(),
    amountMinor: v.number(),
    currency: v.string(),
    idempotencyKey: v.string(),
    phase: v.string(),
    generation: v.number(),
    attempt: v.number(),
    state: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("blocked"),
      v.literal("reconciliation"),
    ),
    nextAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    receipt: v.optional(
      v.object({
        providerStatus: v.string(),
        amountCaptured: v.number(),
        observedAt: v.number(),
      }),
    ),
    lastReason: v.optional(v.string()),
  })
    .index("by_intent", ["paymentIntentId"])
    .index("by_identity", ["orderId", "action", "contractRevision"])
    .index("by_due", ["state", "nextAt"]),
});
