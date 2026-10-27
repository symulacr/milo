import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  bindingFields,
  chainPhaseValidator,
  deploymentObservationFields,
  frozenQuoteFields,
  imagePackPolicyFields,
  literals,
  paymentAuthorization,
} from "./admissionValidators";

const s = v.string();
const n = v.number();
const b = v.boolean();
const optS = v.optional(s);
const optN = v.optional(n);

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
    phase: chainPhaseValidator,
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
    .index("by_terminal", ["terminal"])
    // The operator's dispute queue asks for non-terminal DISPUTED rows. Without
    // this, `by_terminal` narrows to every live order and the phase is filtered
    // in the range.
    .index("by_terminal_phase", ["terminal", "phase"])
    // R22 I-04: the retention cron walks terminal orders oldest-first to find
    // the ones past the promised window. Without this the sweep is a scan.
    .index("by_terminal_observed", ["terminal", "observedAt"]),
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
    studioName: optS,
  })
    .index("by_subject_scope", ["privySubject", "scopeId"])
    .index("by_subject", ["privySubject"])
    .index("by_scope_role", ["scopeId", "role"]),
  quoteDrafts: defineTable({
    id: s,
    scopeId: s,
    studioName: s,
    merchantSubject: s,
    merchantAccountId: s,
    title: s,
    brief: s,
    clientEmail: s,
    amountUsd: n,
    amountMinor: n,
    currency: v.literal("USD"),
    orderNonce: s,
    merchantCommitment: s,
    operatorCommitment: optS,
    /**
     * R22 I-01: the operator signing secret for this order, generated at
     * creation. Server-only: it is never in a `returns` validator, never in a
     * public projection, and `operatorSecret` is the one action that reads it.
     * Optional because orders created before this field fall back to the legacy
     * `HMAC(MILO_OPERATOR_SECRET, nonce)` derivation.
     */
    operatorSecret: optS,
    termsCommitment: s,
    terms: v.object({
      unitPrice: s,
      total: s,
      scopeDigest: s,
      rightsDigest: s,
      paymentPolicy: s,
      salt: s,
    }),
    inviteToken: s,
    buyerSubject: optS,
    buyerAccountId: optS,
    buyerCommitment: optS,
    finalizedAt: optN,
    createdAt: n,
    updatedAt: n,
  })
    .index("by_quote", ["id"])
    .index("by_merchant", ["merchantSubject"])
    .index("by_merchant_nonce", ["merchantSubject", "orderNonce"])
    .index("by_buyer", ["buyerSubject"])
    // I-02: the per-(merchant, recipient) magic-link cooldown reads the newest
    // draft for that pair. Without this index the check is a table scan.
    .index("by_merchant_email", [
      "merchantSubject",
      "clientEmail",
      "createdAt",
    ]),
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
    .index("by_storage", ["storageId"])
    // The grant sweep asks only for grants past the grace window.
    .index("by_expiry", ["expiresAt"]),
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
    /**
     * Which Stripe mode the intent was created in. Widened from the `"test"`
     * literal so a live intent *can* be stored — the schema was the last
     * deploy-blocking literal — but nothing enables live mode: `stripeMode()`
     * refuses a live key in `holdPayment` before any write, and the webhook
     * refuses a live event against a test key. The union is storage, not a
     * permission.
     */
    environment: literals("test", "live"),
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
    /**
     * `PaymentIntent.cancellation_reason` for a `payment_intent.canceled`
     * event. Stripe distinguishes `expired` (the authorization lapsed on its
     * own) from `requested_by_customer`/`abandoned`/`automatic` (a deliberate
     * void), and those are different facts about the order: an expiry released
     * nothing, a void gave the hold back. Stored so the distinction survives
     * the request that observed it.
     */
    cancellationReason: optS,
    receivedAt: n,
    processedAt: optN,
  })
    .index("by_provider_event", ["provider", "accountId", "eventId"])
    .index("by_account", ["accountId"])
    .index("by_received", ["receivedAt"])
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
    .index("by_intent_state", ["paymentIntentId", "state"])
    .index("by_identity", ["orderId", "action", "contractRevision"])
    .index("by_due", ["state", "nextAt"]),
});
