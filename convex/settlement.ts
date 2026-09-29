/**
 * RECONSTRUCTED — Phase 8 W1-A
 * settlementOps lifecycle: inbox dedup, capture/void policy gates,
 * generation/attempt claim fences, bounded sweep.
 *
 * Specs: FINDINGS-LEDGER F-05/F-21, W2-A2, IMPLEMENTATION-WB-stripe,
 * IMPLEMENTATION-WC-security-tests. F-21: by_intent uses .take(64), never .unique().
 */
import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { type GenericId, v } from "convex/values";
import type { PaymentAuthorization } from "../packages/backend/src/admission-policy";
import { usableObservation } from "../packages/backend/src/provisioning-policy";
import type { AdmissionContext } from "./admissionContext";
import { paymentAuthorization } from "./admissionValidators";
import { invalidatePaymentObservation } from "./paymentMonitor";

/** Bounded reclaim/resume scan. */
export const MAX_SWEEP = 16;
/** Lease for a running provider attempt before reclaim. */
export const SETTLEMENT_LEASE_MS = 60_000;

const settleActionRef = makeFunctionReference<"action">("stripeSettlement:run");

export type SettleAction = "capture" | "void";
export type OrderPhase = string;

/** Capture only APPROVED; void only CANCELLED. Everything else refuses both. */
export function settlementAuthorized(
  action: SettleAction,
  phase: OrderPhase,
): boolean {
  if (action === "capture") return phase === "APPROVED";
  if (action === "void") return phase === "CANCELLED";
  return false;
}

/**
 * Stable operation identity across attempts. Business uniqueness is
 * (orderId, action, contractRevision) — never a claimed unique-index feature.
 */
export function settlementIdempotencyKey(
  orderId: string,
  action: SettleAction,
  contractRevision: number,
): string {
  return `milo-${action}:${orderId}:${contractRevision}`;
}

/** Inbox business identity: one durable row per (provider, accountId, eventId). */
export function inboxDedupeKey(
  provider: string,
  accountId: string,
  eventId: string,
): string {
  return `${provider}|${accountId}|${eventId}`;
}

type OpsDb = {
  query: (table: string) => {
    withIndex: (
      name: string,
      range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      take: (n: number) => Promise<unknown[]>;
      unique?: () => Promise<unknown>;
    };
  };
};

/**
 * F-21: one payment intent may carry capture+void rows. A `.unique()` lookup
 * on by_intent throws; every consumer must bound-scan instead.
 */
export async function opsForIntent(
  db: OpsDb | AdmissionContext["db"],
  paymentIntentId: GenericId<"paymentIntents">,
): Promise<
  {
    _id: GenericId<"settlementOps">;
    paymentIntentId: GenericId<"paymentIntents">;
    action: SettleAction;
    orderId: string;
    contractRevision: number;
    state: string;
    generation: number;
    attempt: number;
  }[]
> {
  const rows = await (db as OpsDb)
    .query("settlementOps")
    .withIndex("by_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
    .take(64);
  return rows as never;
}

function inboxExists(
  db: AdmissionContext["db"],
  provider: "stripe",
  accountId: string,
  eventId: string,
) {
  return db
    .query("paymentInbox")
    .withIndex("by_provider_event", (q) =>
      q
        .eq("provider", provider)
        .eq("accountId", accountId)
        .eq("eventId", eventId),
    )
    .unique();
}

/**
 * Durable inbox receipt. Dedup by (provider, accountId, eventId).
 * Duplicates acknowledge against the earlier acceptance (isNew: false).
 */
export const recordEvent = internalMutationGeneric({
  args: {
    provider: v.literal("stripe"),
    accountId: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    digest: v.string(),
    paymentIntentRef: v.union(v.string(), v.null()),
  },
  returns: v.object({ isNew: v.boolean(), inboxId: v.id("paymentInbox") }),
  handler: async (ctx: AdmissionContext, args) => {
    const existing = await inboxExists(
      ctx.db,
      args.provider,
      args.accountId,
      args.eventId,
    );
    if (existing) return { isNew: false, inboxId: existing._id };
    const now = Date.now();
    const inboxId = await ctx.db.insert("paymentInbox", {
      provider: args.provider,
      accountId: args.accountId,
      eventId: args.eventId,
      eventType: args.eventType,
      digest: args.digest,
      paymentIntentRef: args.paymentIntentRef,
      receivedAt: now,
      processedAt: undefined,
    });
    return { isNew: true, inboxId };
  },
});

/**
 * Mark the inbox row processed and nudge matching settlementOps in
 * `reconciliation` back to `pending`. Unmapped intents still close the inbox.
 * Event is evidence to re-fetch — never phase authority.
 */
export const reconcile = internalMutationGeneric({
  args: {
    provider: v.literal("stripe"),
    accountId: v.string(),
    eventId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    const row = await inboxExists(
      ctx.db,
      args.provider,
      args.accountId,
      args.eventId,
    );
    if (!row) return null;
    if (row.processedAt !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { processedAt: now });
    const paymentIntentRef = row.paymentIntentRef;
    if (!paymentIntentRef) return null;
    const payments = await ctx.db
      .query("paymentIntents")
      .withIndex("by_provider_intent", (q) =>
        q.eq("stripePaymentIntentId", paymentIntentRef),
      )
      .take(8);
    for (const payment of payments) {
      // F-21: bound-scan, never .unique()
      const ops = await opsForIntent(ctx.db, payment._id);
      for (const op of ops) {
        if (op.state !== "reconciliation") continue;
        await ctx.db.patch(op._id, { state: "pending", nextAt: now });
        await ctx.scheduler.runAfter(0, settleActionRef, {
          opId: op._id,
          generation: op.generation,
          attempt: op.attempt,
        });
      }
    }
    return null;
  },
});

/**
 * Open one settlement operation per (orderId, action, contractRevision).
 * Capture requires a fresh usable bound hold; the observation is invalidated
 * BEFORE any provider I/O is scheduled.
 */
export const request = internalMutationGeneric({
  args: {
    orderId: v.string(),
    contractRevision: v.number(),
    phase: v.string(),
    paymentIntentId: v.id("paymentIntents"),
    quoteId: v.string(),
    quoteVersion: v.number(),
    amountMinor: v.number(),
    currency: v.string(),
  },
  returns: v.union(
    v.object({
      kind: v.literal("opened"),
      opId: v.id("settlementOps"),
      action: v.union(v.literal("capture"), v.literal("void")),
      idempotencyKey: v.string(),
    }),
    v.object({ kind: v.literal("noop"), reason: v.string() }),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    let action: SettleAction | null = null;
    if (args.phase === "APPROVED") action = "capture";
    else if (args.phase === "CANCELLED") action = "void";
    if (!action || !settlementAuthorized(action, args.phase))
      return {
        kind: "noop" as const,
        reason: "phase does not open a settlement action",
      };

    const payment = await ctx.db.get(args.paymentIntentId);
    if (!payment) throw new Error("Unbound payment refused");
    if (
      payment.quoteId !== args.quoteId ||
      payment.quoteVersion !== args.quoteVersion ||
      payment.amountMinor !== args.amountMinor ||
      payment.currency !== args.currency
    ) {
      throw new Error("Payment/quote binding drift refused");
    }

    if (action === "capture") {
      const observation = await ctx.db
        .query("paymentObservations")
        .withIndex("by_payment_intent", (q) =>
          q.eq("paymentIntentId", args.paymentIntentId),
        )
        .unique();
      const now = Date.now();
      const auth: PaymentAuthorization | undefined = observation?.authorization;
      if (!auth || auth.status !== "authorized") {
        throw new Error("Capture requires a fresh usable bound hold");
      }
      if (!usableObservation(auth, now, auth.usableFrom)) {
        throw new Error("Capture requires a fresh usable bound hold");
      }
    }

    const idempotencyKey = settlementIdempotencyKey(
      args.orderId,
      action,
      args.contractRevision,
    );
    const existing = await ctx.db
      .query("settlementOps")
      .withIndex("by_identity", (q) =>
        q
          .eq("orderId", args.orderId)
          .eq("action", action)
          .eq("contractRevision", args.contractRevision),
      )
      .unique();
    if (existing) {
      // Same (order, action, revision) is one operation — never a second charge.
      return {
        kind: "opened" as const,
        opId: existing._id,
        action: existing.action,
        idempotencyKey: existing.idempotencyKey,
      };
    }

    // Invalidate the payment observation BEFORE scheduling provider I/O.
    await invalidatePaymentObservation(ctx, args.paymentIntentId);

    const now = Date.now();
    const opId = await ctx.db.insert("settlementOps", {
      orderId: args.orderId,
      action,
      contractRevision: args.contractRevision,
      paymentIntentId: args.paymentIntentId,
      quoteId: args.quoteId,
      quoteVersion: args.quoteVersion,
      amountMinor: args.amountMinor,
      currency: args.currency,
      idempotencyKey,
      phase: args.phase,
      generation: 1,
      attempt: 0,
      state: "pending",
      nextAt: now,
      startedAt: undefined,
      finishedAt: undefined,
      receipt: undefined,
      lastReason: undefined,
    });
    await ctx.scheduler.runAfter(0, settleActionRef, {
      opId,
      generation: 1,
      attempt: 0,
    });
    return { kind: "opened" as const, opId, action, idempotencyKey };
  },
});

export const fenceArgs = {
  opId: v.id("settlementOps"),
  generation: v.number(),
  attempt: v.number(),
};

/**
 * Claim fence. Matching pending claim → running + operation identity.
 * Generation/attempt mismatch, non-pending, phase drift, or binding drift refuse.
 */
export const begin = internalMutationGeneric({
  args: fenceArgs,
  returns: v.union(
    v.object({
      action: v.union(v.literal("capture"), v.literal("void")),
      idempotencyKey: v.string(),
      payment: v.id("paymentIntents"),
      quoteId: v.string(),
      quoteVersion: v.number(),
      amountMinor: v.number(),
      currency: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    const op = await ctx.db.get(args.opId);
    if (!op) return null;
    if (op.generation !== args.generation || op.attempt !== args.attempt)
      return null;
    if (op.state !== "pending") return null;
    // Phase drift: the terminal order phase must still authorize this action.
    if (!settlementAuthorized(op.action, op.phase)) return null;
    const payment = await ctx.db.get(op.paymentIntentId);
    if (
      !payment ||
      payment.quoteId !== op.quoteId ||
      payment.quoteVersion !== op.quoteVersion ||
      payment.amountMinor !== op.amountMinor ||
      payment.currency !== op.currency
    )
      return null;
    const now = Date.now();
    await ctx.db.patch(op._id, {
      state: "running",
      startedAt: now,
    });
    return {
      action: op.action,
      idempotencyKey: op.idempotencyKey,
      payment: op.paymentIntentId,
      quoteId: op.quoteId,
      quoteVersion: op.quoteVersion,
      amountMinor: op.amountMinor,
      currency: op.currency,
    };
  },
});

/**
 * Completion fence. Ambiguous results go to `reconciliation`, never a silent
 * complete. Void is not completed by a captured status. Stale fences refuse.
 */
export const finish = internalMutationGeneric({
  args: {
    ...fenceArgs,
    outcome: v.union(
      v.literal("captured"),
      v.literal("voided"),
      v.literal("ambiguous"),
      v.literal("failed"),
    ),
    receipt: v.optional(
      v.object({
        providerStatus: v.string(),
        amountCaptured: v.number(),
        observedAt: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx: AdmissionContext, args) => {
    const op = await ctx.db.get(args.opId);
    if (!op) return null;
    if (op.generation !== args.generation || op.attempt !== args.attempt)
      return null;
    if (op.state !== "running") return null;
    const now = Date.now();
    if (args.outcome === "ambiguous") {
      await ctx.db.patch(op._id, {
        state: "reconciliation",
        finishedAt: now,
        lastReason: "ambiguous provider result",
      });
      return null;
    }
    if (args.outcome === "failed") {
      await ctx.db.patch(op._id, {
        state: "blocked",
        finishedAt: now,
        lastReason: "provider reported a definite non-effect",
      });
      return null;
    }
    if (op.action === "capture" && args.outcome !== "captured") {
      await ctx.db.patch(op._id, {
        state: "blocked",
        finishedAt: now,
        lastReason: "capture op is not completed by a non-captured status",
      });
      return null;
    }
    if (op.action === "void" && args.outcome !== "voided") {
      await ctx.db.patch(op._id, {
        state: "blocked",
        finishedAt: now,
        lastReason: "void op is not completed by a captured status",
      });
      return null;
    }
    await ctx.db.patch(op._id, {
      state: "complete",
      finishedAt: now,
      receipt: args.receipt,
      lastReason: undefined,
    });
    return null;
  },
});

/**
 * Bounded sweeper: resume due pending with generation preserved; reclaim
 * stale running (attempt+1); ignore not-due rows. MAX_SWEEP bound.
 */
export const sweep = internalMutationGeneric({
  args: {},
  returns: v.number(),
  handler: async (ctx: AdmissionContext) => {
    const now = Date.now();
    const due = await ctx.db
      .query("settlementOps")
      .withIndex("by_due", (q) => q.eq("state", "pending"))
      .take(MAX_SWEEP);
    let scheduled = 0;
    for (const op of due) {
      if (op.nextAt > now) continue;
      await ctx.scheduler.runAfter(0, settleActionRef, {
        opId: op._id,
        generation: op.generation,
        attempt: op.attempt,
      });
      scheduled += 1;
      if (scheduled >= MAX_SWEEP) return scheduled;
    }
    const running = await ctx.db
      .query("settlementOps")
      .withIndex("by_due", (q) => q.eq("state", "running"))
      .take(MAX_SWEEP);
    for (const op of running) {
      if (scheduled >= MAX_SWEEP) break;
      const startedAt = op.startedAt ?? 0;
      if (now < startedAt + SETTLEMENT_LEASE_MS) continue;
      // Stale running reclaimed: state pending, attempt+1, generation preserved.
      const attempt = op.attempt + 1;
      await ctx.db.patch(op._id, {
        state: "pending",
        attempt,
        nextAt: now,
      });
      await ctx.scheduler.runAfter(0, settleActionRef, {
        opId: op._id,
        generation: op.generation,
        attempt,
      });
      scheduled += 1;
    }
    return scheduled;
  },
});

/** Diagnostic projection of ops for one intent (F-21 safe). */
export const opsForPaymentIntent = internalMutationGeneric({
  args: { paymentIntentId: v.id("paymentIntents") },
  returns: v.array(
    v.object({
      id: v.id("settlementOps"),
      action: v.union(v.literal("capture"), v.literal("void")),
      state: v.string(),
      generation: v.number(),
      attempt: v.number(),
    }),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    const ops = await opsForIntent(ctx.db, args.paymentIntentId);
    return ops.map((op) => ({
      id: op._id,
      action: op.action,
      state: op.state,
      generation: op.generation,
      attempt: op.attempt,
    })) as {
      id: GenericId<"settlementOps">;
      action: SettleAction;
      state: string;
      generation: number;
      attempt: number;
    }[];
  },
});
