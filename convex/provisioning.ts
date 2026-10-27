import {
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { paymentBindsQuote } from "../packages/backend/src/admission-policy";
import {
  imagePackPolicyFor,
  PROVIDER_LEASE_MS,
  PROVIDER_RETRY_WINDOW_MS,
  usableObservation,
  validateFreeze,
  validateImagePackPolicy,
  validJobClock,
} from "../packages/backend/src/provisioning-policy";
import { validPublicConstructor } from "../packages/backend/src/public-constructor.ts";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import { type AdmissionContext, fail } from "./admissionContext";
import { frozenQuoteFields, paymentAuthorization } from "./admissionValidators";
import { isQuoteBuyer, requireMembership } from "./auth/identity";
import {
  invalidatePaymentObservation,
  membershipFor,
  recordObservation,
} from "./paymentMonitor";
import { assertProvisioningActive } from "./trustedProvisioning";

type QuoteRef = { id: string; buyerAccountId: string };
type PaymentRow = Parameters<typeof paymentBindsQuote>[0] & {
  stripeAccountId: string;
  stripeCustomerId: string;
  environment: string;
  network: string;
};

const paymentMismatch = (
  payment: PaymentRow,
  quote: Parameters<typeof paymentBindsQuote>[1],
  accountId: string,
  customerId: string,
): boolean =>
  !paymentBindsQuote(payment, quote) ||
  payment.stripeAccountId !== accountId ||
  payment.stripeCustomerId !== customerId ||
  payment.environment !== "test" ||
  payment.network !== "preprod";

const assertQuoteActive = async (ctx: AdmissionContext, quote: QuoteRef) => {
  await assertProvisioningActive(ctx, "quote", quote.id);
  await assertProvisioningActive(ctx, "customer", quote.buyerAccountId);
};

const frozenQuoteById = (ctx: AdmissionContext, id: string) =>
  ctx.db
    .query("frozenQuotes")
    .withIndex("by_quote", (q) => q.eq("id", id))
    .unique();

const paymentByQuote = (ctx: AdmissionContext, quoteId: string) =>
  ctx.db
    .query("paymentIntents")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .unique();

export async function freezeApprovedQuote(
  ctx: AdmissionContext,
  input: { quoteId: string; expectedVersion: number },
) {
  requireSessionSubject(await ctx.auth.getUserIdentity());
  const approved = await ctx.db
    .query("approvedQuotes")
    .withIndex("by_quote", (q) => q.eq("id", input.quoteId))
    .unique();
  if (!approved) fail("NOT_FOUND", "Approved quote required");
  await assertProvisioningActive(ctx, "quote", input.quoteId);
  const membership = await requireMembership(ctx, approved.scopeId);
  if (!isQuoteBuyer(membership, approved.buyerAccountId))
    fail("FORBIDDEN", "Quote buyer required");
  if (approved.version !== input.expectedVersion)
    fail("WRONG_STATE", "Quote version changed");
  const frozen = await frozenQuoteById(ctx, input.quoteId);
  const { _id, _creationTime, expiresAt, imagePackPolicy, ...quote } = approved;
  // R21 I-05: a quote approved before `imagePackPolicy` existed has no such
  // field, and was permanently unreadable. The policy is derived from the
  // quote's own amount, so defaulting it reconstructs the only value it could
  // ever have had.
  validateImagePackPolicy(quote, imagePackPolicy ?? imagePackPolicyFor(quote));
  if (!validPublicConstructor(quote))
    fail("INVALID_INPUT", "Invalid versioned public constructor inputs");
  if (frozen) {
    if (
      Object.keys(frozenQuoteFields).some(
        (key) =>
          frozen[key as keyof typeof quote] !==
          quote[key as keyof typeof quote],
      )
    )
      fail("CONFLICT", "Frozen quote is immutable");
    return frozen._id;
  }
  validateFreeze(quote, expiresAt, Date.now());
  return await ctx.db.insert("frozenQuotes", quote);
}

export const freeze = mutationGeneric({
  args: { quoteId: v.string(), expectedVersion: v.number() },
  returns: v.id("frozenQuotes"),
  handler: freezeApprovedQuote,
});

export async function requestPaymentJob(
  ctx: AdmissionContext,
  input: { quoteId: string; expectedVersion: number },
  observationOnly: boolean,
) {
  const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
  const quote = await frozenQuoteById(ctx, input.quoteId);
  if (!quote || quote.version !== input.expectedVersion)
    fail("INVALID_INPUT", "Frozen quote version required");
  await assertQuoteActive(ctx, quote);
  const membership = await requireMembership(ctx, quote.scopeId);
  if (!isQuoteBuyer(membership, quote.buyerAccountId))
    fail("FORBIDDEN", "Quote buyer required");
  const now = Date.now();
  const monitor = await ctx.db
    .query("paymentMonitors")
    .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
    .unique();
  if (monitor && monitor.state !== "stopped" && now < monitor.expiresAt)
    fail("WRONG_STATE", "Stop monitoring before requesting a payment job");
  const payment = await paymentByQuote(ctx, quote.id);
  if (observationOnly && !payment)
    fail("CONFLICT", "Existing immutable payment required for observation");
  const mode: "observe" | "create" =
    payment || observationOnly ? "observe" : "create";
  if (!payment && quote.acceptanceDeadlineSeconds * 1000 <= now)
    fail("WRONG_STATE", "Quote expired");
  const customer = await ctx.db
    .query("stripeCustomers")
    .withIndex("by_buyer", (q) => q.eq("buyerAccountId", quote.buyerAccountId))
    .unique();
  if (!customer) fail("CONFLICT", "Trusted Stripe customer binding required");
  if (
    payment &&
    paymentMismatch(
      payment,
      quote,
      customer.stripeAccountId,
      customer.stripeCustomerId,
    )
  )
    fail("CONFLICT", "Immutable payment binding mismatch");
  const job = await ctx.db
    .query("paymentJobs")
    .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
    .unique();
  if (job && !validJobClock(job, now))
    fail("WRONG_STATE", "Invalid provisioning job clock");
  if (
    job &&
    (job.stripeAccountId !== customer.stripeAccountId ||
      job.stripeCustomerId !== customer.stripeCustomerId)
  )
    fail("CONFLICT", "Immutable customer binding changed");
  if (
    job &&
    (job.state === "queued" || job.state === "running") &&
    now - job.startedAt < PROVIDER_LEASE_MS
  ) {
    if (observationOnly && job.mode !== "observe")
      fail("WRONG_STATE", "Creation job must finish before observation");
    return job._id;
  }
  const generation = (job?.generation ?? 0) + 1;
  const queued = {
    quoteId: quote.id,
    stripeAccountId: customer.stripeAccountId,
    stripeCustomerId: customer.stripeCustomerId,
    consentSubject: subject,
    consentAt: now,
    generation,
    mode,
    startedAt: now,
    state: "queued" as const,
  };
  const id = job?._id ?? (await ctx.db.insert("paymentJobs", queued));
  if (job) await ctx.db.patch(id, queued);
  if (payment) await invalidatePaymentObservation(ctx, payment._id);
  await ctx.scheduler.runAfter(
    0,
    makeFunctionReference<"action">("stripeProvisioning:run"),
    { jobId: id, generation },
  );
  return id;
}

/**
 * The two job kinds differ only by the consent literal and whether the job may
 * create a payment. One registration loop replaces two near-identical exports.
 * Both are internal: no client calls them, and the tests drive the handler.
 */
const JOB_KINDS = [
  ["create-test-payment", false],
  ["observe-test-payment", true],
] as const;

export const requestPayment = internalMutationGeneric({
  args: {
    quoteId: v.string(),
    expectedVersion: v.number(),
    consent: v.literal(JOB_KINDS[0][0]),
  },
  returns: v.id("paymentJobs"),
  handler: (ctx: AdmissionContext, input) =>
    requestPaymentJob(ctx, input, JOB_KINDS[0][1]),
});

export const requestObservation = internalMutationGeneric({
  args: {
    quoteId: v.string(),
    expectedVersion: v.number(),
    consent: v.literal(JOB_KINDS[1][0]),
  },
  returns: v.id("paymentJobs"),
  handler: (ctx: AdmissionContext, input) =>
    requestPaymentJob(ctx, input, JOB_KINDS[1][1]),
});

export const begin = internalMutationGeneric({
  args: { jobId: v.id("paymentJobs"), generation: v.number() },
  handler: async (ctx: AdmissionContext, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.generation !== args.generation || job.state !== "queued")
      return null;
    const quote = await frozenQuoteById(ctx, job.quoteId);
    const membership = quote
      ? await membershipFor(ctx, job.consentSubject, quote.scopeId)
      : null;
    const payment = await paymentByQuote(ctx, job.quoteId);
    const now = Date.now();
    if (
      !quote ||
      (job.mode === "observe" && !payment) ||
      !validJobClock(job, now) ||
      !isQuoteBuyer(membership, quote.buyerAccountId) ||
      (!payment && quote.acceptanceDeadlineSeconds * 1000 <= now) ||
      (!payment &&
        job.firstAttemptAt !== undefined &&
        now - job.firstAttemptAt >= PROVIDER_RETRY_WINDOW_MS)
    ) {
      await ctx.db.patch(job._id, { state: "blocked" });
      return null;
    }
    await assertQuoteActive(ctx, quote);
    const firstAttemptAt = job.firstAttemptAt ?? now;
    await ctx.db.patch(job._id, {
      state: "running",
      firstAttemptAt,
      startedAt: now,
    });
    return {
      job: { ...job, firstAttemptAt, startedAt: now },
      quote,
      payment,
    };
  },
});

export const finish = internalMutationGeneric({
  args: {
    jobId: v.id("paymentJobs"),
    generation: v.number(),
    stripePaymentIntentId: v.optional(v.string()),
    authorization: v.optional(paymentAuthorization),
  },
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.generation !== args.generation || job.state !== "running")
      return null;
    const now = Date.now();
    if (!validJobClock(job, now)) {
      await ctx.db.patch(job._id, { state: "blocked" });
      return null;
    }
    const quote = await frozenQuoteById(ctx, job.quoteId);
    if (!quote) fail("NOT_FOUND", "Frozen quote missing");
    await assertQuoteActive(ctx, quote);
    const membership = await membershipFor(
      ctx,
      job.consentSubject,
      quote.scopeId,
    );
    if (!isQuoteBuyer(membership, quote.buyerAccountId)) {
      await ctx.db.patch(job._id, { state: "blocked" });
      return null;
    }
    let payment = await paymentByQuote(ctx, quote.id);
    const providerId = args.stripePaymentIntentId;
    if (providerId && job.mode === "observe")
      fail("WRONG_STATE", "Observation jobs cannot create payment bindings");
    if (providerId) {
      if (!/^pi_[a-zA-Z0-9]+$/.test(providerId))
        fail("INVALID_INPUT", "Invalid provider intent");
      const other = await ctx.db
        .query("paymentIntents")
        .withIndex("by_provider_intent", (q) =>
          q.eq("stripePaymentIntentId", providerId),
        )
        .unique();
      if (
        (other && other._id !== payment?._id) ||
        (payment && payment.stripePaymentIntentId !== providerId)
      )
        fail("CONFLICT", "Provider intent replay or rebinding");
      if (!payment) {
        const id = await ctx.db.insert("paymentIntents", {
          quoteId: quote.id,
          quoteVersion: quote.version,
          buyerAccountId: quote.buyerAccountId,
          amountMinor: quote.amountMinor,
          currency: quote.currency,
          network: "preprod",
          environment: "test",
          stripeAccountId: job.stripeAccountId,
          stripeCustomerId: job.stripeCustomerId,
          stripePaymentIntentId: providerId,
        });
        payment = await ctx.db.get(id);
      }
    }
    const authorization = args.authorization;
    if (authorization && !payment)
      fail("CONFLICT", "Immutable payment binding required");
    if (authorization && payment) {
      if (
        paymentMismatch(
          payment,
          quote,
          job.stripeAccountId,
          job.stripeCustomerId,
        )
      )
        fail("CONFLICT", "Immutable payment binding mismatch");
      if (
        authorization.id !== payment._id ||
        !paymentBindsQuote(authorization, quote) ||
        !usableObservation(authorization, now, job.startedAt)
      )
        fail("WRONG_STATE", "Invalid or stale trusted observation");
      await recordObservation(ctx, payment._id, authorization);
    }
    await ctx.db.patch(job._id, {
      state: providerId || authorization ? "complete" : "blocked",
    });
    return null;
  },
});
