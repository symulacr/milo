import { internalMutationGeneric } from "convex/server";
import { type GenericId, type Infer, v } from "convex/values";
import {
  validateFreeze,
  validateImagePackPolicy,
} from "../packages/backend/src/provisioning-policy";
import {
  canonicalPayload,
  type Provenance,
  validateProvenance,
} from "../packages/backend/src/trusted-provisioning-policy";
import type { AdmissionContext } from "./admissionContext";
import {
  frozenQuoteFields,
  imagePackPolicyFields,
} from "./admissionValidators";

const provenance = v.object({
  operatorId: v.string(),
  sourceId: v.string(),
  evidenceFingerprint: v.string(),
});
const payload = v.union(
  v.object({
    kind: v.literal("membership"),
    value: v.object({
      privySubject: v.string(),
      accountId: v.string(),
      scopeId: v.string(),
      role: v.union(
        v.literal("buyer"),
        v.literal("merchant"),
        v.literal("operator"),
      ),
    }),
  }),
  v.object({
    kind: v.literal("customer"),
    value: v.object({
      buyerAccountId: v.string(),
      stripeAccountId: v.string(),
      stripeCustomerId: v.string(),
    }),
  }),
  v.object({
    kind: v.literal("quote"),
    value: v.object({
      ...frozenQuoteFields,
      expiresAt: v.number(),
      imagePackPolicy: v.object(imagePackPolicyFields),
    }),
  }),
  v.object({
    kind: v.literal("timing"),
    value: v.object({
      network: v.literal("preprod"),
      captureSafetyMarginMs: v.number(),
    }),
  }),
);
type Input = Infer<typeof payload>;

const bindingKey = (input: Input): string =>
  input.kind === "membership"
    ? JSON.stringify([input.value.privySubject, input.value.scopeId])
    : input.kind === "timing"
      ? input.value.network
      : input.kind === "quote"
        ? input.value.id
        : input.value.buyerAccountId;

const requireAuthority = (requestId: string, proof: Provenance) =>
  validateProvenance(
    proof,
    requestId,
    process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES,
  );

const auditOf = (ctx: AdmissionContext, requestId: string) =>
  ctx.db
    .query("trustedProvisioningAudit")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .unique();

const bindingOf = (ctx: AdmissionContext, kind: Input["kind"], key: string) =>
  ctx.db
    .query("trustedProvisioning")
    .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("key", key))
    .unique();

const assertActiveBinding = async (
  ctx: AdmissionContext,
  bindingId: GenericId<"trustedProvisioning">,
) => {
  const binding = await ctx.db.get(bindingId);
  if (binding?.status !== "active")
    throw new Error("Trusted provisioning revoked");
};

export async function assertProvisioningActive(
  ctx: Pick<AdmissionContext, "db">,
  kind: "quote" | "customer",
  key: string,
) {
  const binding = await ctx.db
    .query("trustedProvisioning")
    .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("key", key))
    .unique();
  if (binding?.status === "revoked")
    throw new Error("Trusted provisioning revoked");
}

export const provision = internalMutationGeneric({
  args: { requestId: v.string(), provenance, payload },
  handler: async (ctx: AdmissionContext, args) => {
    requireAuthority(args.requestId, args.provenance);
    return provisionBinding(ctx, args);
  },
});

async function provisionBinding(
  ctx: AdmissionContext,
  args: { requestId: string; provenance: Provenance; payload: Input },
): Promise<GenericId<"trustedProvisioning">> {
  const input = args.payload;
  const key = bindingKey(input);
  const serialized = canonicalPayload(input);
  const operation = canonicalPayload({
    action: "provision",
    payload: input,
    provenance: args.provenance,
  });
  const prior = await auditOf(ctx, args.requestId);
  if (prior) {
    if (prior.operation !== operation)
      throw new Error("Provisioning request conflict");
    await assertActiveBinding(ctx, prior.bindingId);
    return prior.bindingId;
  }
  const existing = await bindingOf(ctx, input.kind, key);
  if (existing)
    throw new Error(
      existing.payload === serialized
        ? "Binding already provisioned; reuse original request"
        : "Immutable binding conflict",
    );
  if (
    !Object.values(input.value).every(
      (value) =>
        typeof value !== "string" ||
        (value.trim() === value && value.length > 0 && value.length <= 512),
    )
  )
    throw new Error("Nonempty bounded binding identifiers required");
  let targetId:
    | GenericId<"memberships">
    | GenericId<"approvedQuotes">
    | GenericId<"stripeCustomers">
    | GenericId<"admissionTimingPolicies">;
  if (input.kind === "membership") {
    if (
      !/^(?:[A-Za-z0-9_-]{16,}|did:privy:[a-zA-Z0-9_-]+)$/.test(
        input.value.privySubject,
      )
    )
      throw new Error("Subject required");
    const row = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q
          .eq("privySubject", input.value.privySubject)
          .eq("scopeId", input.value.scopeId),
      )
      .unique();
    if (row)
      throw new Error("Existing membership cannot be adopted or rebound");
    targetId = await ctx.db.insert("memberships", {
      ...input.value,
      status: "active",
    });
  } else if (input.kind === "customer") {
    if (
      !/^acct_[a-zA-Z0-9]+$/.test(input.value.stripeAccountId) ||
      !/^cus_[a-zA-Z0-9]+$/.test(input.value.stripeCustomerId)
    )
      throw new Error("Stripe identifiers required");
    const row = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_buyer", (q) =>
        q.eq("buyerAccountId", input.value.buyerAccountId),
      )
      .unique();
    if (row) throw new Error("Existing customer cannot be adopted or rebound");
    const other = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_provider_customer", (q) =>
        q
          .eq("stripeAccountId", input.value.stripeAccountId)
          .eq("stripeCustomerId", input.value.stripeCustomerId),
      )
      .unique();
    if (other) throw new Error("Stripe customer already bound");
    targetId = await ctx.db.insert("stripeCustomers", input.value);
  } else if (input.kind === "timing") {
    if (
      !Number.isSafeInteger(input.value.captureSafetyMarginMs) ||
      input.value.captureSafetyMarginMs <= 0
    )
      throw new Error("Positive capture safety margin required");
    const row = await ctx.db
      .query("admissionTimingPolicies")
      .withIndex("by_network", (q) => q.eq("network", input.value.network))
      .unique();
    if (row)
      throw new Error("Existing timing policy cannot be adopted or rebound");
    targetId = await ctx.db.insert("admissionTimingPolicies", input.value);
  } else {
    validateFreeze(input.value, input.value.expiresAt, Date.now());
    validateImagePackPolicy(input.value, input.value.imagePackPolicy);
    const row = await ctx.db
      .query("approvedQuotes")
      .withIndex("by_quote", (q) => q.eq("id", input.value.id))
      .unique();
    const frozen = await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", input.value.id))
      .unique();
    if (row || frozen)
      throw new Error("Existing quote cannot be adopted or rebound");
    targetId = await ctx.db.insert("approvedQuotes", input.value);
  }
  const bindingId = await ctx.db.insert("trustedProvisioning", {
    kind: input.kind,
    key,
    version: input.kind === "quote" ? input.value.version : 1,
    payload: serialized,
    targetId,
    status: "active",
  });
  await ctx.db.insert("trustedProvisioningAudit", {
    requestId: args.requestId,
    operation,
    ...args.provenance,
    recordedAt: Date.now(),
    bindingId,
  });
  return bindingId;
}

const TIMING_PAYLOAD: Input = {
  kind: "timing",
  value: { network: "preprod", captureSafetyMarginMs: 1000 },
};

export const ensurePreprodTimingPolicy = internalMutationGeneric({
  args: { requestId: v.string(), provenance },
  handler: async (ctx: AdmissionContext, args) => {
    requireAuthority(args.requestId, args.provenance);
    const prior = await auditOf(ctx, args.requestId);
    if (prior) {
      const operation = canonicalPayload({
        action: "provision",
        payload: TIMING_PAYLOAD,
        provenance: args.provenance,
      });
      if (prior.operation !== operation)
        throw new Error("Provisioning request conflict");
      await assertActiveBinding(ctx, prior.bindingId);
      return prior.bindingId;
    }
    const existing = await ctx.db
      .query("admissionTimingPolicies")
      .withIndex("by_network", (q) => q.eq("network", "preprod"))
      .unique();
    if (existing) {
      const binding = await bindingOf(ctx, "timing", "preprod");
      if (binding?.status !== "active")
        throw new Error("Existing timing policy is not provisioned");
      return binding._id;
    }
    return provisionBinding(ctx, {
      requestId: args.requestId,
      provenance: args.provenance,
      payload: TIMING_PAYLOAD,
    });
  },
});

export const revoke = internalMutationGeneric({
  args: {
    requestId: v.string(),
    provenance,
    bindingId: v.id("trustedProvisioning"),
    expectedVersion: v.number(),
  },
  handler: async (ctx: AdmissionContext, args) => {
    requireAuthority(args.requestId, args.provenance);
    const operation = canonicalPayload({
      action: "revoke",
      bindingId: args.bindingId,
      expectedVersion: args.expectedVersion,
      provenance: args.provenance,
    });
    const prior = await auditOf(ctx, args.requestId);
    if (prior) {
      if (prior.operation !== operation)
        throw new Error("Provisioning request conflict");
      return null;
    }
    const binding = await ctx.db.get(args.bindingId);
    if (!binding || binding.version !== args.expectedVersion)
      throw new Error("Binding version required");
    if (binding.status !== "active")
      throw new Error("Binding already revoked; reuse original request");
    if (binding.kind === "membership") {
      const id = ctx.db.normalizeId("memberships", binding.targetId);
      if (!id) throw new Error("Membership binding corrupted");
      await ctx.db.patch(id, { status: "revoked" });
    }
    await ctx.db.patch(binding._id, { status: "revoked" });
    await ctx.db.insert("trustedProvisioningAudit", {
      requestId: args.requestId,
      operation,
      ...args.provenance,
      recordedAt: Date.now(),
      bindingId: binding._id,
    });
    return null;
  },
});
