import {
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { type GenericId, v } from "convex/values";
import { paymentBindsQuote } from "../packages/backend/src/admission-policy";
import { usableObservation } from "../packages/backend/src/provisioning-policy";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import type { AdmissionContext } from "./admissionContext";
import { paymentAuthorization } from "./admissionValidators";
import { isQuoteBuyer } from "./auth/identity";
import {
  authoritiesFor,
  invalidatePaymentObservation,
  MONITOR_DURATION_MS,
  MONITOR_INTERVAL_MS,
  MONITOR_LEASE_MS,
  type MonitorQueryContext,
  monitorBinding,
  monitorLive,
  projectMonitorStatus,
  quoteById,
} from "./paymentMonitor";

const tickRef = makeFunctionReference<"mutation">("paymentMonitoring:tick");
const runRef = makeFunctionReference<"action">("stripeMonitoring:run");
const fenceArgs = {
  monitorId: v.id("paymentMonitors"),
  generation: v.number(),
  attempt: v.number(),
};

const monitorFor = (ctx: AdmissionContext, quoteId: string) =>
  ctx.db
    .query("paymentMonitors")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .unique();

const jobFor = (ctx: AdmissionContext, quoteId: string) =>
  ctx.db
    .query("paymentJobs")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .unique();

const jobBlocked = (job: { state: string } | null | undefined) =>
  job?.state === "queued" || job?.state === "running";

const clockOk = (now: number) =>
  Number.isSafeInteger(now) &&
  now >= 0 &&
  Number.isSafeInteger(now + MONITOR_DURATION_MS);

const rebind = (
  ctx: AdmissionContext,
  session: { quoteId: string; consentSubject: string },
) => monitorBinding(ctx, session.quoteId, session.consentSubject);

const stopSession = async (
  ctx: AdmissionContext,
  session: {
    _id: GenericId<"paymentMonitors">;
    paymentIntentId: GenericId<"paymentIntents">;
    generation: number;
  },
) => {
  await invalidatePaymentObservation(
    ctx,
    session.paymentIntentId,
    session._id,
    session.generation,
  );
  await ctx.db.patch(session._id, { state: "stopped" });
};

export const status = queryGeneric({
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
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const session = await ctx.db
      .query("paymentMonitors")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    const ownsConsent = session?.consentSubject === subject;
    const current = await monitorBinding(ctx, args.quoteId, subject);
    if (!ownsConsent && !current) {
      const quote = await quoteById(ctx, args.quoteId);
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
        (await authoritiesFor(ctx, [
          ["quote", args.quoteId],
          ["membership", JSON.stringify([subject, quote.scopeId])],
        ]));
      if (
        !quote ||
        !isQuoteBuyer(membership, quote.buyerAccountId) ||
        authorities?.some((row) => row?.status === "revoked")
      )
        throw new Error(
          "Authenticated quote buyer or monitoring consent owner required",
        );
    }
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
        clockOk(now) &&
        (!session ||
          (Number.isSafeInteger(session.generation + 1) &&
            !monitorLive(session, now))) &&
        !jobBlocked(job),
    };
  },
});

export const start = mutationGeneric({
  args: {
    quoteId: v.string(),
    expectedVersion: v.number(),
    consent: v.literal("monitor-test-payment"),
  },
  returns: v.id("paymentMonitors"),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const current = await monitorBinding(ctx, args.quoteId, subject);
    if (!current || current.quote.version !== args.expectedVersion)
      throw new Error("Active immutable payment and quote buyer required");
    if (jobBlocked(await jobFor(ctx, args.quoteId)))
      throw new Error("Payment job must finish before monitoring");
    const old = await monitorFor(ctx, args.quoteId);
    const now = Date.now();
    if (!clockOk(now) || (old && !Number.isSafeInteger(old.generation + 1)))
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
    await invalidatePaymentObservation(ctx, current.payment._id);
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
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const session = await monitorFor(ctx, args.quoteId);
    if (session && session.consentSubject !== subject)
      throw new Error("Monitoring consent owner required");
    if (session && session.state !== "stopped") {
      await invalidatePaymentObservation(
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
    const current = await rebind(ctx, session);
    if (!monitorLive(session, now) || current?.binding !== session.binding) {
      await stopSession(ctx, session);
      return null;
    }
    const due =
      session.state === "running"
        ? session.startedAt + MONITOR_LEASE_MS
        : session.nextAt;
    if (now < due) return null;
    const attempt = session.attempt + 1;
    await invalidatePaymentObservation(
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
      session.attempt !== args.attempt ||
      session.claimed
    )
      return null;
    const now = Date.now();
    const current = await rebind(ctx, session);
    if (
      !monitorLive(session, now) ||
      now >= session.startedAt + MONITOR_LEASE_MS ||
      current?.binding !== session.binding
    ) {
      await stopSession(ctx, session);
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
      session.attempt !== args.attempt ||
      !session.claimed
    )
      return null;
    const now = Date.now();
    const current = await rebind(ctx, session);
    await invalidatePaymentObservation(
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
      paymentBindsQuote(auth, current.quote) &&
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
