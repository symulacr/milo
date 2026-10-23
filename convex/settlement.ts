import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { type GenericId, v } from "convex/values";
import type { PaymentAuthorization } from "../packages/backend/src/admission-policy";
import { usableObservation } from "../packages/backend/src/provisioning-policy";
import type { AdmissionContext } from "./admissionContext";
import { invalidatePaymentObservation } from "./paymentMonitor";

export const MAX_SWEEP = 16;
export const SETTLEMENT_LEASE_MS = 60_000;
export const RETRY_BACKOFF_MS = 30_000;

const settleActionRef = makeFunctionReference<"action">("stripeSettlement:run");

export type SettleAction = "capture" | "void";
export type OrderPhase = string;

export function settlementAuthorized(
  action: SettleAction,
  phase: OrderPhase,
): boolean {
  if (action === "capture") return phase === "APPROVED";
  if (action === "void") return phase === "CANCELLED";
  return false;
}

export function settlementIdempotencyKey(
  orderId: string,
  action: SettleAction,
  contractRevision: number,
): string {
  return `milo-${action}:${orderId}:${contractRevision}`;
}

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

export type SettlementOpRow = {
  _id: GenericId<"settlementOps">;
  paymentIntentId: GenericId<"paymentIntents">;
  action: SettleAction;
  orderId: string;
  contractRevision: number;
  state: string;
  generation: number;
  attempt: number;
};

export async function opsForIntent(
  db: OpsDb | AdmissionContext["db"],
  paymentIntentId: GenericId<"paymentIntents">,
): Promise<SettlementOpRow[]> {
  const rows = await (db as OpsDb)
    .query("settlementOps")
    .withIndex("by_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
    .take(64);
  return rows as SettlementOpRow[];
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

const scheduleSettle = (
  ctx: AdmissionContext,
  op: { _id: GenericId<"settlementOps">; generation: number; attempt: number },
) =>
  ctx.scheduler.runAfter(0, settleActionRef, {
    opId: op._id,
    generation: op.generation,
    attempt: op.attempt,
  });

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
    const inboxId = await ctx.db.insert("paymentInbox", {
      provider: args.provider,
      accountId: args.accountId,
      eventId: args.eventId,
      eventType: args.eventType,
      digest: args.digest,
      paymentIntentRef: args.paymentIntentRef,
      receivedAt: Date.now(),
      processedAt: undefined,
    });
    return { isNew: true, inboxId };
  },
});

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
    if (!row || row.processedAt !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { processedAt: now });
    const piRef = row.paymentIntentRef;
    if (!piRef) return null;
    const payments = await ctx.db
      .query("paymentIntents")
      .withIndex("by_provider_intent", (q) =>
        q.eq("stripePaymentIntentId", piRef),
      )
      .take(8);
    for (const payment of payments) {
      for (const op of await opsForIntent(ctx.db, payment._id)) {
        if (op.state !== "reconciliation") continue;
        await ctx.db.patch(op._id, { state: "pending", nextAt: now });
        await scheduleSettle(ctx, op);
      }
    }
    return null;
  },
});

type OpenArgs = {
  orderId: string;
  contractRevision: number;
  phase: string;
  paymentIntentId: GenericId<"paymentIntents">;
  quoteId: string;
  quoteVersion: number;
  amountMinor: number;
  currency: string;
};

const NO_ACTION = {
  kind: "noop" as const,
  reason: "phase does not open a settlement action",
};

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
  handler: async (ctx: AdmissionContext, args) => openSettlement(ctx, args),
});

async function openSettlement(ctx: AdmissionContext, args: OpenArgs) {
  const action: SettleAction | null =
    args.phase === "APPROVED"
      ? "capture"
      : args.phase === "CANCELLED"
        ? "void"
        : null;
  if (!action || !settlementAuthorized(action, args.phase)) return NO_ACTION;

  const payment = await ctx.db.get(args.paymentIntentId);
  if (!payment) throw new Error("Unbound payment refused");
  if (
    payment.quoteId !== args.quoteId ||
    payment.quoteVersion !== args.quoteVersion ||
    payment.amountMinor !== args.amountMinor ||
    payment.currency !== args.currency
  )
    throw new Error("Payment/quote binding drift refused");

  if (action === "capture") {
    const observation = await ctx.db
      .query("paymentObservations")
      .withIndex("by_payment_intent", (q) =>
        q.eq("paymentIntentId", args.paymentIntentId),
      )
      .unique();
    const now = Date.now();
    const auth: PaymentAuthorization | undefined = observation?.authorization;
    if (
      auth?.status !== "authorized" ||
      !usableObservation(auth, now, auth.usableFrom)
    )
      throw new Error("Capture requires a fresh usable bound hold");
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
  if (existing)
    return {
      kind: "opened" as const,
      opId: existing._id,
      action: existing.action,
      idempotencyKey: existing.idempotencyKey,
    };

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
}

export const fenceArgs = {
  opId: v.id("settlementOps"),
  generation: v.number(),
  attempt: v.number(),
};

export const openFromObservation = internalMutationGeneric({
  args: { orderId: v.string() },
  returns: v.union(
    v.object({
      kind: v.literal("opened"),
      opId: v.id("settlementOps"),
      action: v.union(v.literal("capture"), v.literal("void")),
    }),
    v.object({ kind: v.literal("noop"), reason: v.string() }),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    const chain = await ctx.db
      .query("chainOrders")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .unique();
    if (!chain)
      return {
        kind: "noop" as const,
        reason: "no chain order is bound to this order",
      };
    if (
      !settlementAuthorized(
        chain.phase === "APPROVED" ? "capture" : "void",
        chain.phase,
      )
    )
      return {
        kind: "noop" as const,
        reason: "observed phase opens no settlement action",
      };
    const payment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", chain.quoteId))
      .unique();
    if (!payment)
      return {
        kind: "noop" as const,
        reason: "no authorized payment is bound to this quote",
      };
    const opened = await openSettlement(ctx, {
      orderId: chain.orderId,
      contractRevision: chain.revision,
      phase: chain.phase,
      paymentIntentId: payment._id,
      quoteId: payment.quoteId,
      quoteVersion: payment.quoteVersion,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });
    if (opened.kind === "noop")
      return { kind: "noop" as const, reason: opened.reason };
    return {
      kind: "opened" as const,
      opId: opened.opId,
      action: opened.action,
    };
  },
});

const bindingDrift = (
  row: {
    quoteId: string;
    quoteVersion: number;
    amountMinor: number;
    currency: string;
  },
  payment: {
    quoteId: string;
    quoteVersion: number;
    amountMinor: number;
    currency: string;
  },
): boolean =>
  payment.quoteId !== row.quoteId ||
  payment.quoteVersion !== row.quoteVersion ||
  payment.amountMinor !== row.amountMinor ||
  payment.currency !== row.currency;

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
    if (!settlementAuthorized(op.action, op.phase)) return null;
    const payment = await ctx.db.get(op.paymentIntentId);
    if (!payment || bindingDrift(op, payment)) return null;
    await ctx.db.patch(op._id, { state: "running", startedAt: Date.now() });
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

const blockOp = (
  ctx: AdmissionContext,
  opId: GenericId<"settlementOps">,
  now: number,
  lastReason: string,
) => ctx.db.patch(opId, { state: "blocked", finishedAt: now, lastReason });

export const finish = internalMutationGeneric({
  args: {
    ...fenceArgs,
    outcome: v.union(
      v.literal("captured"),
      v.literal("voided"),
      v.literal("ambiguous"),
      v.literal("retry"),
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
    if (args.outcome === "retry") {
      await ctx.db.patch(op._id, {
        state: "pending",
        attempt: op.attempt + 1,
        nextAt: now + RETRY_BACKOFF_MS * Math.max(1, op.attempt + 1),
        startedAt: undefined,
        lastReason: "transient provider failure",
      });
      return null;
    }
    if (args.outcome === "failed") {
      await blockOp(
        ctx,
        op._id,
        now,
        "provider reported a definite non-effect",
      );
      return null;
    }
    if (op.action === "capture" && args.outcome !== "captured") {
      await blockOp(
        ctx,
        op._id,
        now,
        "capture op is not completed by a non-captured status",
      );
      return null;
    }
    if (op.action === "void" && args.outcome !== "voided") {
      await blockOp(
        ctx,
        op._id,
        now,
        "void op is not completed by a captured status",
      );
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

export const sweep = internalMutationGeneric({
  args: {},
  returns: v.number(),
  handler: async (ctx: AdmissionContext) => {
    const now = Date.now();
    let scheduled = 0;
    const due = await ctx.db
      .query("settlementOps")
      .withIndex("by_due", (q) => q.eq("state", "pending"))
      .take(MAX_SWEEP);
    for (const op of due) {
      if (op.nextAt > now) continue;
      await scheduleSettle(ctx, op);
      scheduled += 1;
      if (scheduled >= MAX_SWEEP) return scheduled;
    }
    const running = await ctx.db
      .query("settlementOps")
      .withIndex("by_due", (q) => q.eq("state", "running"))
      .take(MAX_SWEEP);
    for (const op of running) {
      if (scheduled >= MAX_SWEEP) break;
      if (now < (op.startedAt ?? 0) + SETTLEMENT_LEASE_MS) continue;
      const attempt = op.attempt + 1;
      await ctx.db.patch(op._id, { state: "pending", attempt, nextAt: now });
      await scheduleSettle(ctx, { ...op, attempt });
      scheduled += 1;
    }
    return scheduled;
  },
});

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
    }));
  },
});
