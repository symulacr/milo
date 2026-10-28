import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { type GenericId, v } from "convex/values";
import type { PaymentAuthorization } from "../packages/backend/src/admission-policy";
import {
  capturableHold,
  captureCoversResolution,
} from "../packages/backend/src/provisioning-policy";
import { type AdmissionContext, fail, type ReadDb } from "./admissionContext";
import { invalidatePaymentObservation } from "./paymentMonitor";

export const MAX_SWEEP = 16;
const SETTLEMENT_LEASE_MS = 60_000;
const RETRY_BACKOFF_MS = 30_000;
/** How many times a parked (`ambiguous`) op is re-queued before it stays blocked. */
export const MAX_RECONCILE_ATTEMPTS = 5;
/** How long a processed inbox row is kept for the audit trail. */
export const INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const settleActionRef = makeFunctionReference<"action">("stripeSettlement:run");

type SettleAction = "capture" | "void";

export function settlementAuthorized(
  action: SettleAction,
  phase: string,
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

type SettlementOpRow = {
  _id: GenericId<"settlementOps">;
  paymentIntentId: GenericId<"paymentIntents">;
  action: SettleAction;
  orderId: string;
  contractRevision: number;
  state: string;
  generation: number;
  attempt: number;
  startedAt?: number;
};

export async function opsForIntent(
  db: ReadDb,
  paymentIntentId: GenericId<"paymentIntents">,
): Promise<SettlementOpRow[]> {
  const rows = await db
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
    cancellationReason: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    isNew: v.boolean(),
    inboxId: v.id("paymentInbox"),
    digestMatches: v.boolean(),
  }),
  handler: async (ctx: AdmissionContext, args) => {
    const existing = await inboxExists(
      ctx.db,
      args.provider,
      args.accountId,
      args.eventId,
    );
    if (existing)
      return {
        isNew: false,
        inboxId: existing._id,
        // A replay of the same event id must carry the same body. A mismatch is
        // not a duplicate: it is a different payload wearing a known id, and the
        // caller has to refuse it rather than silently drop it.
        digestMatches: existing.digest === args.digest,
      };
    const inboxId = await ctx.db.insert("paymentInbox", {
      provider: args.provider,
      accountId: args.accountId,
      eventId: args.eventId,
      eventType: args.eventType,
      digest: args.digest,
      paymentIntentRef: args.paymentIntentRef,
      cancellationReason: args.cancellationReason ?? undefined,
      receivedAt: Date.now(),
      processedAt: undefined,
    });
    return { isNew: true, inboxId, digestMatches: true };
  },
});

export const reconcile = internalMutationGeneric({
  args: {
    provider: v.literal("stripe"),
    accountId: v.string(),
    eventId: v.string(),
    /**
     * R39 D5: the amount and currency the event asserts, when the event carries
     * them. Optional so an event type without money fields (a dispute) still
     * reconciles; when present, a disagreement with the bound payment is a
     * refusal, not a silent accept.
     */
    amountMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    /** R39 D5: the session id, so a `cs_pending:` row can be resolved. */
    checkoutSessionId: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.object({ refused: v.string() })),
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
    // R39 D1/D5: a live Checkout hold binds a row keyed by the session id,
    // because the intent does not exist until the buyer pays. This is where the
    // two are joined: the first event carrying the real intent id adopts the
    // pending row, so the rest of the chain (settlementOps, capture, void) has a
    // payment to work with.
    if (payments.length === 0 && args.checkoutSessionId) {
      const pending = await ctx.db
        .query("paymentIntents")
        .withIndex("by_provider_intent", (q) =>
          q.eq("stripePaymentIntentId", `cs_pending:${args.checkoutSessionId}`),
        )
        .take(1);
      const rowToAdopt = pending[0];
      if (rowToAdopt) {
        // D5: the money must agree before the row is adopted. A session whose
        // amount drifted from the frozen quote is refused here rather than
        // captured later against the wrong total.
        if (
          args.amountMinor !== undefined &&
          args.amountMinor !== rowToAdopt.amountMinor
        )
          return { refused: "Authorized amount does not match the order." };
        if (
          args.currency !== undefined &&
          args.currency.toLowerCase() !== rowToAdopt.currency.toLowerCase()
        )
          return { refused: "Authorized currency does not match the order." };
        await ctx.db.patch(rowToAdopt._id, {
          stripePaymentIntentId: piRef,
        });
        payments.push({ ...rowToAdopt, stripePaymentIntentId: piRef });
      }
    }
    for (const payment of payments) {
      for (const op of await opsForIntent(ctx.db, payment._id)) {
        if (op.state !== "reconciliation") continue;
        await ctx.db.patch(op._id, { state: "pending", nextAt: now });
        await scheduleSettle(ctx, op);
      }
      // R39 D4: a hold that landed on an order which is no longer payable must
      // be released. This lives here rather than as a third mutation on the
      // webhook path because `reconcile` already has the payment and the chain
      // row open, and the webhook's contract is one record plus one reconcile
      // per delivery.
      //
      // `openSettlement` is idempotent on (orderId, action, contractRevision),
      // so a retried delivery finds the existing void instead of opening a
      // second one.
      const chain = await ctx.db
        .query("chainOrders")
        .withIndex("by_quote", (q) => q.eq("quoteId", payment.quoteId))
        .unique();
      if (chain?.phase === "CANCELLED")
        await openSettlement(ctx, {
          orderId: chain.orderId,
          contractRevision: chain.revision,
          phase: chain.phase,
          paymentIntentId: payment._id,
          quoteId: payment.quoteId,
          quoteVersion: payment.quoteVersion,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        });
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

const noop = (reason: string) => ({ kind: "noop" as const, reason });

const NO_ACTION = noop("phase does not open a settlement action");

const noopResult = v.object({ kind: v.literal("noop"), reason: v.string() });
const openedResult = v.object({
  kind: v.literal("opened"),
  opId: v.id("settlementOps"),
  action: v.union(v.literal("capture"), v.literal("void")),
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
  if (!payment) fail("CONFLICT", "Unbound payment refused");
  if (
    payment.quoteId !== args.quoteId ||
    payment.quoteVersion !== args.quoteVersion ||
    payment.amountMinor !== args.amountMinor ||
    payment.currency !== args.currency
  )
    fail("CONFLICT", "Payment/quote binding drift refused");

  const now = Date.now();
  if (action === "capture") {
    const observation = await ctx.db
      .query("paymentObservations")
      .withIndex("by_payment_intent", (q) =>
        q.eq("paymentIntentId", args.paymentIntentId),
      )
      .unique();
    const auth: PaymentAuthorization | undefined = observation?.authorization;
    if (!auth || !capturableHold(auth, now))
      fail("WRONG_STATE", "Capture requires a capturable hold");
    // Admission refuses a hold that expires before the resolution window plus
    // the safety margin; capture asks the same question.
    const quote = await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    const timing = quote
      ? await ctx.db
          .query("admissionTimingPolicies")
          .withIndex("by_network", (q) => q.eq("network", quote.network))
          .unique()
      : null;
    if (
      !quote ||
      !timing ||
      !captureCoversResolution(
        auth,
        quote.resolutionDeadlineSeconds,
        timing.captureSafetyMarginMs,
      )
    )
      fail("WRONG_STATE", "Capture window closed before the resolution margin");
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
  returns: v.union(openedResult, noopResult),
  handler: async (ctx: AdmissionContext, args) => {
    const chain = await ctx.db
      .query("chainOrders")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .unique();
    if (!chain) return noop("no chain order is bound to this order");
    if (
      !settlementAuthorized(
        chain.phase === "APPROVED" ? "capture" : "void",
        chain.phase,
      )
    )
      return noop("observed phase opens no settlement action");
    const payment = await ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", chain.quoteId))
      .unique();
    if (!payment) return noop("no authorized payment is bound to this quote");
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
    if (opened.kind === "noop") return noop(opened.reason);
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
    const armed = new Set<string>();
    let scheduled = 0;
    // Recovery first, then fresh work. `running` past its lease and
    // `reconciliation` past its attempt budget are the two states no webhook
    // will revisit, so both are re-armed before a backlog of due pending ops can
    // consume the whole budget.
    for (const [state, due] of [
      [
        "running",
        (op: SettlementOpRow) =>
          now >= (op.startedAt ?? 0) + SETTLEMENT_LEASE_MS,
      ],
      [
        "reconciliation",
        (op: SettlementOpRow) => op.attempt < MAX_RECONCILE_ATTEMPTS,
      ],
    ] as const)
      for (const op of await ctx.db
        .query("settlementOps")
        .withIndex("by_due", (q) => q.eq("state", state))
        .take(MAX_SWEEP)) {
        if (scheduled >= MAX_SWEEP || !due(op as SettlementOpRow)) continue;
        const attempt = op.attempt + 1;
        await ctx.db.patch(op._id, { state: "pending", attempt, nextAt: now });
        await scheduleSettle(ctx, { ...op, attempt });
        armed.add(op._id);
        scheduled += 1;
      }
    for (const op of await ctx.db
      .query("settlementOps")
      .withIndex("by_due", (q) => q.eq("state", "pending"))
      .take(MAX_SWEEP)) {
      if (scheduled >= MAX_SWEEP) break;
      if (armed.has(op._id) || op.nextAt > now) continue;
      await scheduleSettle(ctx, op);
      scheduled += 1;
    }
    // The inbox is an audit trail, not a permanent log: prune processed rows
    // past the retention window, bounded so one run never scans the table.
    for (const row of await ctx.db
      .query("paymentInbox")
      .withIndex("by_received", (q) =>
        q.lt("receivedAt", now - INBOX_RETENTION_MS),
      )
      .take(MAX_SWEEP))
      if (row.processedAt !== undefined) await ctx.db.delete(row._id);
    return scheduled;
  },
});
