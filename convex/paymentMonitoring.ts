import {
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { type GenericId, v } from "convex/values";
import { requirePrivySubject } from "../packages/backend/src/privy-identity";
import { usableObservation } from "../packages/backend/src/provisioning-policy";
import type { AdmissionContext } from "./admissionContext";
import { paymentAuthorization } from "./admissionValidators";
import {
  MONITOR_DURATION_MS,
  MONITOR_INTERVAL_MS,
  MONITOR_LEASE_MS,
  type MonitorQueryContext,
  monitorBinding,
  monitorLive,
  projectMonitorStatus,
} from "./paymentMonitor";

const tickRef = makeFunctionReference<"mutation">("paymentMonitoring:tick");
const runRef = makeFunctionReference<"action">("stripeMonitoring:run");
const fenceArgs = {
  monitorId: v.id("paymentMonitors"),
  generation: v.number(),
  attempt: v.number(),
};

export const status = queryGeneric({
  // A new token bypasses client query caching; it never affects authorization.
  args: { quoteId: v.string(), refreshToken: v.optional(v.string()) },
  returns: v.object({
    state: v.union(
      v.literal("none"),
      v.literal("waiting"),
      v.literal("running"),
      v.literal("stopped"),
      v.literal("expired"),
      v.literal("unavailable"),
    ),
    expiresAt: v.union(v.number(), v.null()),
    canStop: v.boolean(),
    quoteVersion: v.union(v.number(), v.null()),
    canStart: v.boolean(),
  }),
  handler: async (ctx: MonitorQueryContext, args) => {
    const subject = requirePrivySubject(await ctx.auth.getUserIdentity());
    const session = await ctx.db
      .query("paymentMonitors")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    const ownsConsent = session?.consentSubject === subject;
    const current = await monitorBinding(ctx, args.quoteId, subject);
    if (!ownsConsent && !current) {
      // A buyer can inspect an empty/unavailable session before a payment exists.
      const quote = await ctx.db
        .query("frozenQuotes")
        .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
        .unique();
      const membership =
        quote &&
        (await ctx.db
          .query("memberships")
          .withIndex("by_subject_scope", (q) =>
            q.eq("privySubject", subject).eq("scopeId", quote.scopeId),
          )
          .unique());
      const authorities =
        quote &&
        (await Promise.all(
          (
            [
              ["quote", args.quoteId],
              ["membership", JSON.stringify([subject, quote.scopeId])],
            ] as const
          ).map(([kind, key]) =>
            ctx.db
              .query("trustedProvisioning")
              .withIndex("by_kind_key", (q) =>
                q.eq("kind", kind).eq("key", key),
              )
              .unique(),
          ),
        ));
      if (
        !quote ||
        membership?.status !== "active" ||
        membership.role !== "buyer" ||
        membership.accountId !== quote.buyerAccountId ||
        authorities?.some((row) => row?.status === "revoked")
      )
        throw new Error(
          "Authenticated quote buyer or monitoring consent owner required",
        );
    }
    // Different subjects' membership snapshots cannot validate the owner's consent.
    const ownerCurrent =
      session && !ownsConsent
        ? await monitorBinding(ctx, args.quoteId, session.consentSubject)
        : current;
    const now = Date.now();
    const job =
      current &&
      (await ctx.db
        .query("paymentJobs")
        .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
        .unique());
    return {
      ...projectMonitorStatus(
        session,
        !!session && ownerCurrent?.binding === session.binding,
        ownsConsent,
        now,
      ),
      quoteVersion: current?.quote.version ?? null,
      canStart:
        !!current &&
        Number.isSafeInteger(now) &&
        now >= 0 &&
        Number.isSafeInteger(now + MONITOR_DURATION_MS) &&
        (!session ||
          (Number.isSafeInteger(session.generation + 1) &&
            !monitorLive(session, now))) &&
        job?.state !== "queued" &&
        job?.state !== "running",
    };
  },
});

async function invalidate(
  ctx: AdmissionContext,
  paymentIntentId: GenericId<"paymentIntents">,
  monitorId?: GenericId<"paymentMonitors">,
  generation?: number,
) {
  const row = await ctx.db
    .query("paymentObservations")
    .withIndex("by_payment_intent", (q) =>
      q.eq("paymentIntentId", paymentIntentId),
    )
    .unique();
  if (
    row &&
    (!monitorId ||
      (row.monitorId === monitorId && row.monitorGeneration === generation))
  )
    await ctx.db.delete(row._id);
}

export const start = mutationGeneric({
  args: {
    quoteId: v.string(),
    expectedVersion: v.number(),
    consent: v.literal("monitor-test-payment"),
  },
  returns: v.id("paymentMonitors"),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requirePrivySubject(await ctx.auth.getUserIdentity());
    const current = await monitorBinding(ctx, args.quoteId, subject);
    if (!current || current.quote.version !== args.expectedVersion)
      throw new Error("Active immutable payment and quote buyer required");
    const job = await ctx.db
      .query("paymentJobs")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    // A monitor never takes over even an expired creation/one-shot lease.
    if (job && (job.state === "queued" || job.state === "running"))
      throw new Error("Payment job must finish before monitoring");
    const old = await ctx.db
      .query("paymentMonitors")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    const now = Date.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(now + MONITOR_DURATION_MS) ||
      (old && !Number.isSafeInteger(old.generation + 1))
    )
      throw new Error("Invalid monitoring clock or generation");
    if (old && monitorLive(old, now))
      throw new Error("Stop existing monitoring before starting a new session");
    const value = {
      quoteId: args.quoteId,
      paymentIntentId: current.payment._id,
      consentSubject: subject,
      binding: current.binding,
      generation: (old?.generation ?? 0) + 1,
      attempt: 0,
      consentAt: now,
      expiresAt: now + MONITOR_DURATION_MS,
      nextAt: now,
      startedAt: now,
      state: "waiting" as const,
    };
    const id = old?._id ?? (await ctx.db.insert("paymentMonitors", value));
    if (old) await ctx.db.patch(id, value);
    await invalidate(ctx, current.payment._id);
    await ctx.scheduler.runAfter(0, tickRef, {
      monitorId: id,
      generation: value.generation,
      attempt: 0,
    });
    return id;
  },
});

export const stop = mutationGeneric({
  args: { quoteId: v.string() },
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requirePrivySubject(await ctx.auth.getUserIdentity());
    const session = await ctx.db
      .query("paymentMonitors")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    if (session && session.consentSubject !== subject)
      throw new Error("Monitoring consent owner required");
    // Withdrawing consent remains possible after membership or quote revocation.
    if (session && session.state !== "stopped") {
      await invalidate(
        ctx,
        session.paymentIntentId,
        session._id,
        session.generation,
      );
      await ctx.db.patch(session._id, {
        state: "stopped",
        generation: session.generation + 1,
      });
    }
    return null;
  },
});

// The watchdog uses the same attempt fence, recovering only this session's read lease.
export const tick = internalMutationGeneric({
  args: fenceArgs,
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    const session = await ctx.db.get(args.monitorId);
    if (
      !session ||
      session.state === "stopped" ||
      session.generation !== args.generation ||
      session.attempt !== args.attempt
    )
      return null;
    const now = Date.now();
    const current = await monitorBinding(
      ctx,
      session.quoteId,
      session.consentSubject,
    );
    if (!monitorLive(session, now) || current?.binding !== session.binding) {
      await invalidate(
        ctx,
        session.paymentIntentId,
        session._id,
        session.generation,
      );
      await ctx.db.patch(session._id, { state: "stopped" });
      return null;
    }
    const due =
      session.state === "running"
        ? session.startedAt + MONITOR_LEASE_MS
        : session.nextAt;
    if (now < due) return null;
    const attempt = session.attempt + 1;
    await invalidate(
      ctx,
      session.paymentIntentId,
      session._id,
      session.generation,
    );
    await ctx.db.patch(session._id, {
      state: "running",
      attempt,
      startedAt: now,
      claimed: false,
    });
    const fence = {
      monitorId: session._id,
      generation: session.generation,
      attempt,
    };
    await ctx.scheduler.runAfter(0, runRef, fence);
    await ctx.scheduler.runAfter(
      Math.min(MONITOR_LEASE_MS, session.expiresAt - now),
      tickRef,
      fence,
    );
    return null;
  },
});

export const begin = internalMutationGeneric({
  args: fenceArgs,
  handler: async (ctx: AdmissionContext, args) => {
    const session = await ctx.db.get(args.monitorId);
    if (
      session?.state !== "running" ||
      session.generation !== args.generation ||
      session.attempt !== args.attempt
    )
      return null;
    if (session.claimed) return null;
    const current = await monitorBinding(
      ctx,
      session.quoteId,
      session.consentSubject,
    );
    if (
      !monitorLive(session, Date.now()) ||
      Date.now() >= session.startedAt + MONITOR_LEASE_MS ||
      current?.binding !== session.binding
    ) {
      await invalidate(
        ctx,
        session.paymentIntentId,
        session._id,
        session.generation,
      );
      await ctx.db.patch(session._id, { state: "stopped" });
      return null;
    }
    await ctx.db.patch(session._id, { claimed: true });
    return current.payment;
  },
});

export const finish = internalMutationGeneric({
  args: { ...fenceArgs, authorization: v.optional(paymentAuthorization) },
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    const session = await ctx.db.get(args.monitorId);
    if (
      session?.state !== "running" ||
      session.generation !== args.generation ||
      session.attempt !== args.attempt
    )
      return null;
    // An unclaimed attempt never passed begin's lease/binding re-check; refuse to complete it.
    if (!session.claimed) return null;
    const now = Date.now();
    const current = await monitorBinding(
      ctx,
      session.quoteId,
      session.consentSubject,
    );
    await invalidate(
      ctx,
      session.paymentIntentId,
      session._id,
      session.generation,
    );
    if (
      !monitorLive(session, now) ||
      current?.binding !== session.binding ||
      now >= session.startedAt + MONITOR_LEASE_MS
    ) {
      await ctx.db.patch(session._id, { state: "stopped" });
      return null;
    }
    const auth = args.authorization;
    const payment = current.payment;
    if (
      auth &&
      auth.id === payment._id &&
      auth.quoteId === payment.quoteId &&
      auth.quoteVersion === payment.quoteVersion &&
      auth.buyerAccountId === payment.buyerAccountId &&
      auth.amountMinor === payment.amountMinor &&
      auth.currency === payment.currency &&
      usableObservation(auth, now, session.startedAt)
    ) {
      await ctx.db.insert("paymentObservations", {
        paymentIntentId: payment._id,
        authorization: {
          ...auth,
          usableUntil: Math.min(auth.usableUntil, session.expiresAt),
        },
        monitorId: session._id,
        monitorGeneration: session.generation,
      });
    }
    const nextAt = Math.min(now + MONITOR_INTERVAL_MS, session.expiresAt);
    await ctx.db.patch(session._id, { state: "waiting", nextAt });
    await ctx.scheduler.runAfter(nextAt - now, tickRef, {
      monitorId: args.monitorId,
      generation: args.generation,
      attempt: args.attempt,
    });
    return null;
  },
});
