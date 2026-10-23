import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  bindingFields,
  deploymentObservationFields,
  frozenQuoteFields,
  imagePackPolicyFields,
  paymentAuthorization,
} from "./admissionValidators";

const s = v.string();
const n = v.number();
const b = v.boolean();
const optS = v.optional(s);
const optN = v.optional(n);

const literals = <T extends string>(...values: T[]) =>
  v.union(...values.map((value) => v.literal(value)));

const PREPROD = v.literal("preprod");
const ACTIVE_REVOKED = literals("active", "revoked");
const NULLABLE_S = v.union(s, v.null());

export default defineSchema({
  trustedProvisioning: defineTable({
    kind: literals("membership", "quote", "customer", "timing"),
    key: s,
    version: n,
    payload: s,
    targetId: v.union(
      v.id("memberships"),
      v.id("approvedQuotes"),
      v.id("stripeCustomers"),
      v.id("admissionTimingPolicies"),
    ),
    status: ACTIVE_REVOKED,
  }).index("by_kind_key", ["kind", "key"]),
  trustedProvisioningAudit: defineTable({
    requestId: s,
    operation: s,
    operatorId: s,
    sourceId: s,
    evidenceFingerprint: s,
    recordedAt: n,
    bindingId: v.id("trustedProvisioning"),
  }).index("by_request", ["requestId"]),
  approvedQuotes: defineTable({
    ...frozenQuoteFields,
    imagePackPolicy: v.object(imagePackPolicyFields),
    expiresAt: n,
  }).index("by_quote", ["id"]),
  stripeCustomers: defineTable({
    buyerAccountId: s,
    stripeAccountId: s,
    stripeCustomerId: s,
  })
    .index("by_buyer", ["buyerAccountId"])
    .index("by_provider_customer", ["stripeAccountId", "stripeCustomerId"]),
  paymentJobs: defineTable({
    quoteId: s,
    stripeAccountId: s,
    stripeCustomerId: s,
    consentSubject: s,
    consentAt: n,
    generation: n,
    startedAt: n,
    firstAttemptAt: optN,
    mode: v.optional(literals("create", "observe")),
    state: literals("queued", "running", "complete", "blocked"),
  }).index("by_quote", ["quoteId"]),
  frozenQuotes: defineTable(frozenQuoteFields).index("by_quote", ["id"]),
  paymentMonitors: defineTable({
    claimed: v.optional(b),
    quoteId: s,
    paymentIntentId: v.id("paymentIntents"),
    consentSubject: s,
    binding: s,
    generation: n,
    attempt: n,
    consentAt: n,
    expiresAt: n,
    nextAt: n,
    startedAt: n,
    state: literals("waiting", "running", "stopped"),
  }).index("by_quote", ["quoteId"]),
  deploymentObservations: defineTable(deploymentObservationFields)
    .index("by_observation", ["id"])
    .index("by_address", ["address"]),
  paymentObservations: defineTable({
    paymentIntentId: v.id("paymentIntents"),
    authorization: paymentAuthorization,
    monitorId: v.optional(v.id("paymentMonitors")),
    monitorGeneration: optN,
  }).index("by_payment_intent", ["paymentIntentId"]),
  admissionTimingPolicies: defineTable({
    network: PREPROD,
    captureSafetyMarginMs: n,
  }).index("by_network", ["network"]),
  canonicalBindings: defineTable(bindingFields)
    .index("by_network_nonce", ["network", "nonce"])
    .index("by_address", ["address"])
    .index("by_quote", ["quoteId"]),
  chainOrders: defineTable({
    orderId: s,
    quoteId: s,
    network: PREPROD,
    address: s,
    nonce: s,
    artifactFingerprint: s,
    phase: literals(
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
      "APPROVED",
      "CANCELLED",
    ),
    revision: n,
    deliveryManifest: v.optional(NULLABLE_S),
    terminal: b,
    merchantActive: b,
    observedAt: optN,
    lastStateHex: optS,
    blockHeight: optN,
    blockHash: optS,
  })
    .index("by_order", ["orderId"])
    .index("by_address", ["address"])
    .index("by_quote", ["quoteId"])
    .index("by_terminal", ["terminal"]),
  chainObservations: defineTable({
    orderId: s,
    phase: s,
    revision: n,
    observedAt: n,
    kind: s,
  }).index("by_order", ["orderId"]),
  memberships: defineTable({
    privySubject: s,
    accountId: s,
    scopeId: s,
    role: literals("buyer", "merchant", "operator"),
    status: ACTIVE_REVOKED,
  })
    .index("by_subject_scope", ["privySubject", "scopeId"])
    .index("by_scope_role", ["scopeId", "role"]),
  orders: defineTable({
    id: s,
    buyerId: s,
    merchantId: s,
    disputeOperatorId: optS,
    scopeId: s,
    profile: v.literal("image-pack-v1"),
    outputCount: v.literal(3),
    phase: literals("ACCEPTED", "SUBMITTED", "DISPUTED", "TERMINAL"),
    revision: n,
  }).index("by_order", ["id"]),
  fileGrants: defineTable({
    orderId: s,
    uploaderId: s,
    expiresAt: n,
    consumed: b,
    uploadTicket: optS,
    storageId: optS,
    inspected: v.optional(
      v.object({ storageId: s, sha256: s, contentType: s, byteLength: n }),
    ),
  })
    .index("by_order", ["orderId"])
    .index("by_storage", ["storageId"]),
  deliveries: defineTable({
    orderId: s,
    merchantId: s,
    revision: n,
    files: v.array(
      v.object({
        grantId: s,
        storageId: s,
        sha256: s,
        contentType: s,
        byteLength: n,
      }),
    ),
    manifest: s,
  }).index("by_order", ["orderId"]),
  paymentIntents: defineTable({
    quoteId: s,
    quoteVersion: n,
    buyerAccountId: s,
    stripeAccountId: s,
    stripeCustomerId: s,
    stripePaymentIntentId: s,
    amountMinor: n,
    currency: s,
    environment: v.literal("test"),
    network: PREPROD,
  })
    .index("by_quote", ["quoteId"])
    .index("by_provider_intent", ["stripePaymentIntentId"])
    .index("by_buyer", ["buyerAccountId"]),
  paymentInbox: defineTable({
    provider: v.literal("stripe"),
    accountId: s,
    eventId: s,
    eventType: s,
    digest: s,
    paymentIntentRef: NULLABLE_S,
    receivedAt: n,
    processedAt: optN,
  })
    .index("by_provider_event", ["provider", "accountId", "eventId"])
    .index("by_account", ["accountId"])
    .index("by_intent", ["paymentIntentRef"]),
  settlementOps: defineTable({
    orderId: s,
    action: literals("capture", "void"),
    contractRevision: n,
    paymentIntentId: v.id("paymentIntents"),
    quoteId: s,
    quoteVersion: n,
    amountMinor: n,
    currency: s,
    idempotencyKey: s,
    phase: s,
    generation: n,
    attempt: n,
    state: literals(
      "pending",
      "running",
      "complete",
      "blocked",
      "reconciliation",
    ),
    nextAt: n,
    startedAt: optN,
    finishedAt: optN,
    receipt: v.optional(
      v.object({ providerStatus: s, amountCaptured: n, observedAt: n }),
    ),
    lastReason: optS,
  })
    .index("by_intent", ["paymentIntentId"])
    .index("by_identity", ["orderId", "action", "contractRevision"])
    .index("by_due", ["state", "nextAt"]),
});
