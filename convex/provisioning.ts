import {
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import type { AdmissionContext } from "./admissionContext";
import { requirePrivySubject } from "../packages/backend/src/privy-identity";
import {
  PROVIDER_LEASE_MS,
  PROVIDER_RETRY_WINDOW_MS,
  usableObservation,
  validateFreeze,
  validateImagePackPolicy,
  validJobClock,
} from "../packages/backend/src/provisioning-policy";
import { validPublicConstructor } from "../packages/backend/src/public-constructor.mjs";
import { frozenQuoteFields, paymentAuthorization } from "./admissionValidators";
import { requireMembership } from "./auth/identity";
import { assertProvisioningActive } from "./trustedProvisioning";

export async function freezeApprovedQuote(
  ctx: AdmissionContext,
  input: { quoteId: string; expectedVersion: number },
) {
  requirePrivySubject(await ctx.auth.getUserIdentity());
  const approved = await ctx.db
    .query("approvedQuotes")
    .withIndex("by_quote", (q) => q.eq("id", input.quoteId))
    .unique();
  if (!approved) throw new Error("Approved quote required");
  await assertProvisioningActive(ctx, "quote", input.quoteId);
  const membership = await requireMembership(ctx, approved.scopeId);
  if (
    membership.role !== "buyer" ||
    membership.accountId !== approved.buyerAccountId
  )
    throw new Error("Quote buyer required");
  if (approved.version !== input.expectedVersion)
    throw new Error("Quote version changed");
  const frozen = await ctx.db
    .query("frozenQuotes")
    .withIndex("by_quote", (q) => q.eq("id", input.quoteId))
    .unique();
  const { _id, _creationTime, expiresAt, imagePackPolicy, ...quote } = approved;
  validateImagePackPolicy(quote, imagePackPolicy);
  if (!validPublicConstructor(quote))
    throw new Error("Invalid versioned public constructor inputs");
  if (frozen) {
    if (
      Object.keys(frozenQuoteFields).some(
        (key) =>
          frozen[key as keyof typeof quote] !==
          quote[key as keyof typeof quote],
      )
    )
      throw new Error("Frozen quote is immutable");
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
  const subject = requirePrivySubject(await ctx.auth.getUserIdentity());
  const quote = await ctx.db
    .query("frozenQuotes")
    .withIndex("by_quote", (q) => q.eq("id", input.quoteId))
    .unique();
  if (!quote || quote.version !== input.expectedVersion)
    throw new Error("Frozen quote version required");
  await assertProvisioningActive(ctx, "quote", quote.id);
  await assertProvisioningActive(ctx, "customer", quote.buyerAccountId);
  const membership = await requireMembership(ctx, quote.scopeId);
  if (
    membership.role !== "buyer" ||
    membership.accountId !== quote.buyerAccountId
  )
    throw new Error("Quote buyer required");
  const now = Date.now();
  const monitor = await ctx.db
    .query("paymentMonitors")
    .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
    .unique();
  if (monitor && monitor.state !== "stopped" && now < monitor.expiresAt)
    throw new Error("Stop monitoring before requesting a payment job");
  const payment = await ctx.db
    .query("paymentIntents")
    .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
    .unique();
  if (observationOnly && !payment)
    throw new Error("Existing immutable payment required for observation");
  const mode = payment || observationOnly ? "observe" : "create";
  if (!payment && quote.acceptanceDeadlineSeconds * 1000 <= now)
    throw new Error("Quote expired");
  const customer = await ctx.db
    .query("stripeCustomers")
    .withIndex("by_buyer", (q) => q.eq("buyerAccountId", quote.buyerAccountId))
    .unique();
  if (!customer) throw new Error("Trusted Stripe customer binding required");
  if (
    payment &&
    (payment.quoteVersion !== quote.version ||
      payment.buyerAccountId !== quote.buyerAccountId ||
      payment.amountMinor !== quote.amountMinor ||
      payment.currency !== quote.currency ||
      payment.stripeAccountId !== customer.stripeAccountId ||
      payment.stripeCustomerId !== customer.stripeCustomerId ||
      payment.environment !== "test" ||
      payment.network !== "preprod")
  )
    throw new Error("Immutable payment binding mismatch");
  const job = await ctx.db
    .query("paymentJobs")
    .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
    .unique();
  if (job && !validJobClock(job, now))
    throw new Error("Invalid provisioning job clock");
  if (
    job &&
    (job.stripeAccountId !== customer.stripeAccountId ||
      job.stripeCustomerId !== customer.stripeCustomerId)
  )
    throw new Error("Immutable customer binding changed");
  if (
    job &&
    (job.state === "queued" || job.state === "running") &&
    now - job.startedAt < PROVIDER_LEASE_MS
  ) {
    if (observationOnly && job.mode !== "observe")
      throw new Error("Creation job must finish before observation");
    return job._id;
  }
  const generation = (job?.generation ?? 0) + 1;
  const id =
    job?._id ??
    (await ctx.db.insert("paymentJobs", {
      quoteId: quote.id,
      stripeAccountId: customer.stripeAccountId,
      stripeCustomerId: customer.stripeCustomerId,
      consentSubject: subject,
      consentAt: now,
      generation,
      mode,
      startedAt: now,
      state: "queued",
    }));
  if (job)
    await ctx.db.patch(id, {
      generation,
      mode,
      startedAt: now,
      state: "queued",
      consentSubject: subject,
      consentAt: now,
    });
  // Invalidate before external I/O: failed refreshes must not retain a usable authorization.
  if (payment) {
    const observation = await ctx.db
      .query("paymentObservations")
      .withIndex("by_payment_intent", (q) =>
        q.eq("paymentIntentId", payment._id),
      )
      .unique();
    if (observation) await ctx.db.delete(observation._id);
  }
  await ctx.scheduler.runAfter(
    0,
    makeFunctionReference<"action">("stripeProvisioning:run"),
    { jobId: id, generation },
  );
  return id;
}

export const requestPayment = mutationGeneric({
  args: {
    quoteId: v.string(),
    expectedVersion: v.number(),
    consent: v.literal("create-test-payment"),
  },
  returns: v.id("paymentJobs"),
  handler: (ctx: AdmissionContext, input) =>
    requestPaymentJob(ctx, input, false),
});

export const requestObservation = mutationGeneric({
  args: {
    quoteId: v.string(),
    expectedVersion: v.number(),
    consent: v.literal("observe-test-payment"),
  },
  returns: v.id("paymentJobs"),
  handler: (ctx: AdmissionContext, input) =>
    requestPaymentJob(ctx, input, true),
});

export const begin = internalMutationGeneric({
  args: { jobId: v.id("paymentJobs"), generation: v.number() },
  handler: async (ctx: AdmissionContext, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.generation !== args.generation || job.state !== "queued")
      return null;
    const quote = await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", job.quoteId))
      .unique();
    const membership =
      quote &&
      (await ctx.db
        .query("memberships")
        .withIndex("by_subject_scope", (q) =>
          q.eq("privySubject", job.consentSubject).eq("scopeId", quote.scopeId),
        )
        .unique());
    const payment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", job.quoteId))
      .unique();
    const now = Date.now();
    if (
      !quote ||
      (job.mode === "observe" && !payment) ||
      !validJobClock(job, now) ||
      !membership ||
      membership.status !== "active" ||
      membership.role !== "buyer" ||
      membership.accountId !== quote.buyerAccountId ||
      (!payment && quote.acceptanceDeadlineSeconds * 1000 <= now) ||
      (!payment &&
        job.firstAttemptAt !== undefined &&
        now - job.firstAttemptAt >= PROVIDER_RETRY_WINDOW_MS)
    ) {
      await ctx.db.patch(job._id, { state: "blocked" });
      return null;
    }
    await assertProvisioningActive(ctx, "quote", quote.id);
    await assertProvisioningActive(ctx, "customer", quote.buyerAccountId);
    await ctx.db.patch(job._id, {
      state: "running",
      firstAttemptAt: job.firstAttemptAt ?? now,
      startedAt: now,
    });
    return {
      job: {
        ...job,
        firstAttemptAt: job.firstAttemptAt ?? now,
        startedAt: now,
      },
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
    const quote = await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", job.quoteId))
      .unique();
    if (!quote) throw new Error("Frozen quote missing");
    await assertProvisioningActive(ctx, "quote", quote.id);
    await assertProvisioningActive(ctx, "customer", quote.buyerAccountId);
    // Recheck consent authority after provider I/O, not only before it.
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q.eq("privySubject", job.consentSubject).eq("scopeId", quote.scopeId),
      )
      .unique();
    if (
      !membership ||
      membership.status !== "active" ||
      membership.role !== "buyer" ||
      membership.accountId !== quote.buyerAccountId
    ) {
      await ctx.db.patch(job._id, { state: "blocked" });
      return null;
    }
    let payment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
      .unique();
    const providerId = args.stripePaymentIntentId;
    if (providerId && job.mode === "observe")
      throw new Error("Observation jobs cannot create payment bindings");
    if (providerId) {
      if (!/^pi_[a-zA-Z0-9]+$/.test(providerId))
        throw new Error("Invalid provider intent");
      const other = await ctx.db
        .query("paymentIntents")
        .withIndex("by_provider_intent", (q) =>
          q.eq("stripePaymentIntentId", providerId),
        )
        .unique();
      if (
        (other && other._id !== payment?._id) ||
        (payment &&
          payment.stripePaymentIntentId !== args.stripePaymentIntentId)
      )
        throw new Error("Provider intent replay or rebinding");
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
      throw new Error("Immutable payment binding required");
    if (authorization && payment) {
      if (
        payment.quoteVersion !== quote.version ||
        payment.buyerAccountId !== quote.buyerAccountId ||
        payment.amountMinor !== quote.amountMinor ||
        payment.currency !== quote.currency ||
        payment.stripeAccountId !== job.stripeAccountId ||
        payment.stripeCustomerId !== job.stripeCustomerId ||
        payment.environment !== "test" ||
        payment.network !== "preprod"
      )
        throw new Error("Immutable payment binding mismatch");
      if (
        authorization.id !== payment._id ||
        authorization.quoteId !== quote.id ||
        authorization.quoteVersion !== quote.version ||
        authorization.buyerAccountId !== quote.buyerAccountId ||
        authorization.amountMinor !== quote.amountMinor ||
        authorization.currency !== quote.currency ||
        !usableObservation(authorization, now, job.startedAt)
      )
        throw new Error("Invalid or stale trusted observation");
      const current = await ctx.db
        .query("paymentObservations")
        .withIndex("by_payment_intent", (q) =>
          q.eq("paymentIntentId", payment._id),
        )
        .unique();
      if (current) await ctx.db.delete(current._id);
      await ctx.db.insert("paymentObservations", {
        paymentIntentId: payment._id,
        authorization,
      });
    }
    await ctx.db.patch(job._id, {
      state:
        args.stripePaymentIntentId || authorization ? "complete" : "blocked",
    });
    return null;
  },
});
