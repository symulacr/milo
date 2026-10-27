import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
} from "convex/server";
import { type GenericId, type Infer, v } from "convex/values";
import {
  bytesToHex,
  HEX64,
  randomHex,
  timingSafeEqualHex,
} from "../packages/backend/src/encoding";
import { inviteUrl } from "../packages/backend/src/invite-link";
import { deadlines } from "../packages/backend/src/order-windows";
import {
  validateFreeze,
  validateImagePackPolicy,
} from "../packages/backend/src/provisioning-policy";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../packages/backend/src/public-constructor.ts";
import {
  operatorEmails,
  requireSessionSubject,
} from "../packages/backend/src/session-identity";
import {
  canonicalPayload,
  type Provenance,
  validateProvenance,
} from "../packages/backend/src/trusted-provisioning-policy";
import { type AdmissionContext, fail, readEnv } from "./admissionContext";
import {
  frozenQuoteFields,
  imagePackPolicyFields,
  paymentAuthorization,
  quoteDraftFields,
  quoteTermsValidator,
  rejectWith,
} from "./admissionValidators";
import { authComponent, merchantMembershipOf, operatorAllowed } from "./auth";
import { membershipFor, recordObservation } from "./paymentMonitor";

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
      studioName: v.optional(v.string()),
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
    fail("CONFLICT", "Trusted provisioning revoked");
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
    fail("CONFLICT", "Trusted provisioning revoked");
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
      fail("CONFLICT", "Provisioning request conflict");
    await assertActiveBinding(ctx, prior.bindingId);
    return prior.bindingId;
  }
  const existing = await bindingOf(ctx, input.kind, key);
  if (existing)
    fail(
      "CONFLICT",
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
    fail("INVALID_INPUT", "Nonempty bounded binding identifiers required");
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
      fail("UNAUTHENTICATED", "Subject required");
    const row = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q
          .eq("privySubject", input.value.privySubject)
          .eq("scopeId", input.value.scopeId),
      )
      .unique();
    if (row)
      fail("CONFLICT", "Existing membership cannot be adopted or rebound");
    targetId = await ctx.db.insert("memberships", {
      ...input.value,
      status: "active",
    });
  } else if (input.kind === "customer") {
    if (
      !/^acct_[a-zA-Z0-9]+$/.test(input.value.stripeAccountId) ||
      !/^cus_[a-zA-Z0-9]+$/.test(input.value.stripeCustomerId)
    )
      fail("INVALID_INPUT", "Stripe identifiers required");
    const row = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_buyer", (q) =>
        q.eq("buyerAccountId", input.value.buyerAccountId),
      )
      .unique();
    if (row) fail("CONFLICT", "Existing customer cannot be adopted or rebound");
    const other = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_provider_customer", (q) =>
        q
          .eq("stripeAccountId", input.value.stripeAccountId)
          .eq("stripeCustomerId", input.value.stripeCustomerId),
      )
      .unique();
    if (other) fail("CONFLICT", "Stripe customer already bound");
    targetId = await ctx.db.insert("stripeCustomers", input.value);
  } else if (input.kind === "timing") {
    if (
      !Number.isSafeInteger(input.value.captureSafetyMarginMs) ||
      input.value.captureSafetyMarginMs <= 0
    )
      fail("INVALID_INPUT", "Positive capture safety margin required");
    const row = await ctx.db
      .query("admissionTimingPolicies")
      .withIndex("by_network", (q) => q.eq("network", input.value.network))
      .unique();
    if (row)
      fail("CONFLICT", "Existing timing policy cannot be adopted or rebound");
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
      fail("CONFLICT", "Existing quote cannot be adopted or rebound");
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
        fail("CONFLICT", "Provisioning request conflict");
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
        fail("CONFLICT", "Existing timing policy is not provisioned");
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
        fail("CONFLICT", "Provisioning request conflict");
      return null;
    }
    const binding = await ctx.db.get(args.bindingId);
    if (!binding || binding.version !== args.expectedVersion)
      fail("INVALID_INPUT", "Binding version required");
    if (binding.status !== "active")
      fail("CONFLICT", "Binding already revoked; reuse original request");
    if (binding.kind === "membership") {
      const id = ctx.db.normalizeId("memberships", binding.targetId);
      if (!id) fail("CONFLICT", "Membership binding corrupted");
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

export { quoteTermsValidator };

/** The four deadline fields two return validators shared. */
const deadlineFields = {
  acceptance: v.number(),
  delivery: v.number(),
  review: v.number(),
  resolution: v.number(),
};

const boundedText = (value: string, min: number, max: number): boolean =>
  value.trim() === value && value.length >= min && value.length <= max;

/** A quote id is `quote_` + 32 hex; a token is 64 hex. Anything longer is junk. */
const ID_MAX = 64;
const TOKEN_MAX = 64;

/**
 * How long one (merchant, recipient) pair must wait between magic links. Long
 * enough to stop a loop, short enough that a legitimate resend is not blocked
 * for a working session.
 */
export const MAGIC_LINK_COOLDOWN_MS = 10 * 60_000;

/** Bounds the cooldown read even for a merchant with years of history. */
const COOLDOWN_SCAN_LIMIT = 32;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inviteUrlFor = inviteUrl;

const merchantMembership = async (
  ctx: AdmissionContext,
  subject: string,
  scopeId: string,
) => {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_subject_scope", (q) =>
      q.eq("privySubject", subject).eq("scopeId", scopeId),
    )
    .unique();
  if (membership?.status !== "active" || membership.role !== "merchant")
    fail("FORBIDDEN", "Active studio merchant required");
  return membership;
};

export const createStudio = mutationGeneric({
  args: { name: v.string() },
  returns: v.object({ scopeId: v.string() }),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    return ensureStudio(ctx, subject, args.name);
  },
});

/**
 * One studio per subject. A second call returns the first scope, so the action
 * below can call it unconditionally instead of racing a read against a create.
 *
 * The scope id is derived from the subject, so it is known *before* the read.
 * Looking it up by that exact key — rather than by "any merchant membership" —
 * makes the check and the insert agree on one row: a concurrent second call
 * either sees the row or inserts the same key, and the caller's transaction
 * retry then finds it. A duplicate would break every `.unique()` read of
 * `by_subject_scope`, of which there are dozens.
 */
async function ensureStudio(
  ctx: AdmissionContext,
  subject: string,
  name: string,
): Promise<{ scopeId: string }> {
  if (!boundedText(name, 2, 60))
    fail("INVALID_INPUT", "Studio name must be 2 to 60 characters");
  const scopeId = `studio_${bytesToHex(sha256(utf8ToBytes(subject))).slice(0, 32)}`;
  const existing = await membershipFor(ctx, subject, scopeId);
  if (existing) return { scopeId: existing.scopeId };
  await ctx.db.insert("memberships", {
    privySubject: subject,
    accountId: subject,
    scopeId,
    role: "merchant",
    status: "active",
    studioName: name,
  });
  return { scopeId };
}

/** The studio for the current subject, or null. Used by the combined action. */
export const studioFor = internalQueryGeneric({
  args: {},
  returns: v.union(v.object({ scopeId: v.string() }), v.null()),
  handler: async (ctx) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const existing = await merchantMembershipOf(ctx, subject);
    return existing ? { scopeId: existing.scopeId } : null;
  },
});

export const writeQuoteDraft = internalMutationGeneric({
  args: {
    ...quoteDraftFields,
    operatorCommitment: v.string(),
    // Present only on the combined first-order path: the action used to call
    // `studioFor` then `createStudio` before this mutation, which was three
    // round-trips for one user action. `ensureStudio` is idempotent and derives
    // the scope from the subject, so doing it here is the same work, one hop
    // earlier, and the action makes a single call.
    studioName: v.optional(v.string()),
  },
  returns: v.object({
    quoteId: v.string(),
    inviteUrl: v.string(),
    emailed: v.boolean(),
  }),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    // The combined path has no scope yet; create or find it here.
    const scopeId = args.studioName
      ? (await ensureStudio(ctx, subject, args.studioName)).scopeId
      : args.scopeId;
    const membership = await merchantMembership(ctx, subject, scopeId);
    if (!boundedText(args.title, 5, 80))
      fail("INVALID_INPUT", "Title must be 5 to 80 characters");
    if (!boundedText(args.brief, 20, 1000))
      fail("INVALID_INPUT", "Brief must be 20 to 1000 characters");
    if (
      !Number.isSafeInteger(args.amountUsd) ||
      args.amountUsd < 1 ||
      args.amountUsd > 5000
    )
      fail("INVALID_INPUT", "Amount must be 1 to 5000 USD");
    const email = args.clientEmail.trim().toLowerCase();
    if (email !== args.clientEmail || !EMAIL.test(email))
      fail("INVALID_INPUT", "Valid client email required");
    const cents = String(args.amountUsd * 100);
    if (args.terms.unitPrice !== cents || args.terms.total !== cents)
      fail("INVALID_INPUT", "Terms must equal the amount in cents");
    if (
      ![
        args.orderNonce,
        args.merchantCommitment,
        args.termsCommitment,
        args.terms.scopeDigest,
        args.terms.rightsDigest,
        args.terms.paymentPolicy,
        args.terms.salt,
      ].every((value) => HEX64.test(value))
    )
      fail("INVALID_INPUT", "Lowercase 64-character hex required");
    const duplicate = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_merchant_nonce", (q) =>
        q.eq("merchantSubject", subject).eq("orderNonce", args.orderNonce),
      )
      .first();
    if (duplicate) fail("CONFLICT", "Order nonce already used");
    // I-02: one magic link per (merchant, recipient) per window. The send is
    // server-side `auth.api.signInMagicLink`, which bypasses Better Auth's HTTP
    // router and so the `/sign-in/magic-link` limiter: without this a merchant
    // can mail any address in a loop. Scoped to the merchant because two
    // studios may legitimately quote one buyer. The index is ascending on
    // `createdAt`, so the newest match is the tail of the range.
    const recentDrafts = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_merchant_email", (q) =>
        q.eq("merchantSubject", subject).eq("clientEmail", email),
      )
      .take(COOLDOWN_SCAN_LIMIT);
    const recent = recentDrafts.at(-1);
    const waitMs = recent
      ? recent.createdAt + MAGIC_LINK_COOLDOWN_MS - Date.now()
      : 0;
    if (waitMs > 0)
      fail(
        "RATE_LIMITED",
        `An invite was already sent to this address. Try again in ${Math.ceil(waitMs / 60_000)} minute(s).`,
      );
    const token = randomHex();
    const quoteId = `quote_${bytesToHex(
      sha256(utf8ToBytes(`${subject}:${args.orderNonce}`)),
    ).slice(0, 32)}`;
    const now = Date.now();
    const studio = membership.studioName ?? "Studio";
    await ctx.db.insert("quoteDrafts", {
      id: quoteId,
      scopeId: scopeId,
      studioName: studio,
      merchantSubject: subject,
      merchantAccountId: membership.accountId,
      title: args.title,
      brief: args.brief,
      clientEmail: email,
      amountUsd: args.amountUsd,
      amountMinor: args.amountUsd * 100,
      currency: "USD",
      orderNonce: args.orderNonce,
      merchantCommitment: args.merchantCommitment,
      operatorCommitment: args.operatorCommitment,
      termsCommitment: args.termsCommitment,
      terms: args.terms,
      inviteToken: token,
      createdAt: now,
      updatedAt: now,
    });
    const inviteUrl = inviteUrlFor(quoteId, token);
    // I-11: the token is a bearer secret — holding it reads the brief and
    // claims the order. It is already inside `inviteUrl`, so returning it
    // separately only put it in the mutation log and in every caller's memory.
    return { quoteId, inviteUrl, emailed: false };
  },
});

export const acceptInvite = mutationGeneric({
  args: {
    quoteId: v.string(),
    token: v.string(),
    buyerCommitment: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const reject = rejectWith;
    if (!HEX64.test(args.buyerCommitment))
      return reject("Buyer commitment must be 64 lowercase hex characters.");
    // Bounded before any query: `v.string()` accepts a megabyte, and this is a
    // mutation, so an oversized argument would cost a write attempt.
    if (args.quoteId.length > ID_MAX || args.token.length > TOKEN_MAX)
      return reject("This order link does not work.");
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    // One message for a bad token, an expired one and an already-claimed order:
    // the token is a bearer secret, so the caller must not learn which.
    if (!draft || !timingSafeEqualHex(draft.inviteToken, args.token))
      return reject("This order link does not work.");
    if (draft.buyerSubject) return reject("This order link does not work.");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q.eq("privySubject", subject).eq("scopeId", draft.scopeId),
      )
      .unique();
    if (existing) return reject("This account already joined the studio.");
    await ctx.db.insert("memberships", {
      privySubject: subject,
      accountId: subject,
      scopeId: draft.scopeId,
      role: "buyer",
      status: "active",
    });
    await ctx.db.patch(draft._id, {
      buyerSubject: subject,
      buyerAccountId: subject,
      buyerCommitment: args.buyerCommitment,
      // Rotate on claim: the link is also the sign-in callback, so it lives on
      // in mail archives. A used link must stop working, and the fresh value is
      // never returned, so nobody can replay it.
      inviteToken: randomHex(),
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const operatorAccess = internalQueryGeneric({
  args: { quoteId: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    orderNonce: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    if (!draft) return { allowed: false, orderNonce: null };
    if (operatorEmails().length === 0)
      return { allowed: false, orderNonce: draft.orderNonce };
    requireSessionSubject(await ctx.auth.getUserIdentity());
    const user = await authComponent.safeGetAuthUser(ctx);
    return {
      allowed: operatorAllowed(user?.email),
      orderNonce: draft.orderNonce,
    };
  },
});

export const ARTIFACT_FINGERPRINT =
  "8428a3177d719c147c2cb26e97f744b4d01de098a661a49c419693ad37417701";
export const KEY_SET_FINGERPRINT =
  "db2705f6d7625e912c568b0b8a3ddf85944b9a74c5d4bf97c13f9c7099302ee0";

const FINALIZE_PROVENANCE: Provenance = {
  operatorId: "milo-workspace",
  sourceId: "quote-finalization",
  evidenceFingerprint: "0".repeat(64),
};

/**
 * The one field the hold action needs before it can call `finalizeQuote`: the
 * order nonce, which seeds the operator capability. Everything else it used to
 * read here — the acceptance flags, the amount, the customer — is either
 * re-checked by `finalizeQuote` or returned by it, so reading it twice was two
 * wasted document reads on a hop that has to happen anyway.
 */
export const orderNonceFor = internalQueryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(v.object({ orderNonce: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    return draft ? { orderNonce: draft.orderNonce } : null;
  },
});

export const readFrozenQuote = internalQueryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(
    v.object({
      id: v.string(),
      version: v.number(),
      orderNonce: v.string(),
      termsCommitment: v.string(),
      buyerCommitment: v.union(v.string(), v.null()),
      merchantCommitment: v.string(),
      operatorCommitment: v.union(v.string(), v.null()),
      rolesFingerprint: v.string(),
      initialStateFingerprint: v.string(),
      genesisHash: v.string(),
      ...deadlineFields,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const approved = await ctx.db
      .query("approvedQuotes")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    if (!approved || !draft) return null;
    return {
      id: approved.id,
      version: approved.version,
      orderNonce: approved.nonce,
      termsCommitment: approved.termsCommitment,
      buyerCommitment: draft.buyerCommitment ?? null,
      merchantCommitment: approved.merchantCommitment,
      operatorCommitment: draft.operatorCommitment ?? null,
      rolesFingerprint: approved.rolesFingerprint,
      initialStateFingerprint: approved.initialStateFingerprint,
      genesisHash: approved.genesisHash,
      acceptance: approved.acceptanceDeadlineSeconds,
      delivery: approved.deliveryDeadlineSeconds,
      review: approved.reviewDeadlineSeconds,
      resolution: approved.resolutionDeadlineSeconds,
    };
  },
});

export const paymentForQuote = internalQueryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(
    v.object({
      paymentIntentId: v.id("paymentIntents"),
      quoteVersion: v.number(),
      buyerAccountId: v.string(),
      amountMinor: v.number(),
      currency: v.string(),
      stripeAccountId: v.string(),
      stripeCustomerId: v.string(),
      stripePaymentIntentId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    return payment
      ? {
          paymentIntentId: payment._id,
          quoteVersion: payment.quoteVersion,
          buyerAccountId: payment.buyerAccountId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          stripeAccountId: payment.stripeAccountId,
          stripeCustomerId: payment.stripeCustomerId,
          stripePaymentIntentId: payment.stripePaymentIntentId,
        }
      : null;
  },
});

/**
 * Bind the provider hold and record its first observation in one mutation.
 *
 * The action always called these back to back, and the observation is derived
 * from the same provider response that produced the intent id, so nothing could
 * branch between them. Splitting them cost a round-trip and left a window where
 * a bound intent had no observation, which `orders.order` renders as `pending`
 * for a hold that already succeeded. `authorization.id` is rewritten here to the
 * row id this transaction creates, because `canonicalAdmission` requires
 * `authorization.id === payment._id`.
 */
export const bindHeldPayment = internalMutationGeneric({
  args: {
    quoteId: v.string(),
    quoteVersion: v.number(),
    buyerAccountId: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
    stripePaymentIntentId: v.string(),
    authorization: paymentAuthorization,
  },
  returns: v.object({
    paymentIntentId: v.id("paymentIntents"),
    stripeCustomerId: v.string(),
    stripePaymentIntentId: v.string(),
  }),
  handler: async (ctx: AdmissionContext, args) => {
    const existingCustomer = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_buyer", (q) => q.eq("buyerAccountId", args.buyerAccountId))
      .unique();
    if (!existingCustomer) {
      await provisionBinding(ctx, {
        requestId: `customer-${args.buyerAccountId}`,
        provenance: FINALIZE_PROVENANCE,
        payload: {
          kind: "customer",
          value: {
            buyerAccountId: args.buyerAccountId,
            stripeAccountId: args.stripeAccountId,
            stripeCustomerId: args.stripeCustomerId,
          },
        },
      });
    }
    const stripeCustomerId =
      existingCustomer?.stripeCustomerId ?? args.stripeCustomerId;
    const existingPayment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    const paymentIntentId =
      existingPayment?._id ??
      (await ctx.db.insert("paymentIntents", {
        quoteId: args.quoteId,
        quoteVersion: args.quoteVersion,
        buyerAccountId: args.buyerAccountId,
        amountMinor: args.amountMinor,
        currency: args.currency,
        network: "preprod",
        environment: "test",
        stripeAccountId: args.stripeAccountId,
        stripeCustomerId,
        stripePaymentIntentId: args.stripePaymentIntentId,
      }));
    // Same transaction as the bind. On a replay the intent already exists and
    // the fresh observation still supersedes the old one, which is exactly what
    // the separate `observeHeldPayment` call did.
    await recordObservation(ctx, paymentIntentId, {
      ...args.authorization,
      id: paymentIntentId,
    });
    return {
      paymentIntentId,
      stripeCustomerId,
      stripePaymentIntentId:
        existingPayment?.stripePaymentIntentId ?? args.stripePaymentIntentId,
    };
  },
});

export const observeHeldPayment = internalMutationGeneric({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    authorization: paymentAuthorization,
  },
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    await recordObservation(ctx, args.paymentIntentId, args.authorization);
    return null;
  },
});

export const finalizeQuote = internalMutationGeneric({
  args: { quoteId: v.string(), operatorCommitment: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      version: v.number(),
      // Returned rather than re-read by the caller: this mutation already has
      // the draft open, and the hold action needs exactly these four values to
      // build the provider request. A second query for them was a round-trip.
      amountMinor: v.number(),
      currency: v.string(),
      buyerAccountId: v.string(),
      stripeCustomerId: v.union(v.string(), v.null()),
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const reject = rejectWith;
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    if (!draft) return reject("Order not found.");
    if (draft.buyerSubject !== subject)
      return reject("Only the client can hold the payment.");
    if (!draft.buyerAccountId || !draft.buyerCommitment)
      return reject("The client has not accepted this order.");
    const customer = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_buyer", (q) =>
        q.eq("buyerAccountId", draft.buyerAccountId as string),
      )
      .unique();
    const accepted = {
      ok: true as const,
      amountMinor: draft.amountMinor,
      currency: draft.currency,
      buyerAccountId: draft.buyerAccountId,
      stripeCustomerId: customer?.stripeCustomerId ?? null,
    };
    const approved = await ctx.db
      .query("approvedQuotes")
      .withIndex("by_quote", (q) => q.eq("id", draft.id))
      .unique();
    if (approved) return { ...accepted, version: approved.version };
    const genesis = readEnv("MILO_PREPROD_GENESIS_HASH", /^0x[a-f0-9]{64}$/);
    if (!genesis) return reject("The Preprod genesis hash is not configured.");
    const timing = await ctx.db
      .query("admissionTimingPolicies")
      .withIndex("by_network", (q) => q.eq("network", "preprod"))
      .unique();
    if (!timing) {
      await provisionBinding(ctx, {
        requestId: "timing-preprod",
        provenance: FINALIZE_PROVENANCE,
        payload: TIMING_PAYLOAD,
      });
    }
    const now = Date.now();
    const window = deadlines(now);
    const value = {
      constructorVersion: 1 as const,
      constructorEncoding: CONSTRUCTOR_ENCODING,
      buyerCommitment: draft.buyerCommitment,
      merchantCommitment: draft.merchantCommitment,
      operatorCommitment: args.operatorCommitment,
      id: draft.id,
      scopeId: draft.scopeId,
      network: "preprod" as const,
      nonce: draft.orderNonce,
      version: 1,
      amountMinor: draft.amountMinor,
      currency: "USD",
      buyerAccountId: draft.buyerAccountId,
      termsCommitment: draft.termsCommitment,
      artifactFingerprint: ARTIFACT_FINGERPRINT,
      keySetFingerprint: KEY_SET_FINGERPRINT,
      genesisHash: genesis.slice(2),
      acceptanceDeadlineSeconds: window.acceptance,
      deliveryDeadlineSeconds: window.delivery,
      reviewDeadlineSeconds: window.review,
      resolutionDeadlineSeconds: window.resolution,
      expiresAt: window.resolution * 1000,
      imagePackPolicy: {
        serviceVersion: 1 as const,
        packQuantity: 1 as const,
        outputCount: 3 as const,
        unitPriceMinor: draft.amountMinor,
      },
    };
    const fingerprints = publicConstructorFingerprints(value);
    await provisionBinding(ctx, {
      requestId: `finalize-${draft.id}`,
      provenance: FINALIZE_PROVENANCE,
      payload: {
        kind: "quote",
        value: { ...value, ...fingerprints },
      },
    });
    await ctx.db.patch(draft._id, {
      operatorCommitment: args.operatorCommitment,
      finalizedAt: now,
      updatedAt: now,
    });
    return { ...accepted, version: 1 };
  },
});
