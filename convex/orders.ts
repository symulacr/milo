import {
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  queryGeneric,
} from "convex/server";
import { type Infer, v } from "convex/values";
import {
  MAX_OBSERVATION_AGE_MS,
  type ObservationBinding,
} from "../packages/backend/src/admission-policy";
import { timingSafeEqualHex } from "../packages/backend/src/encoding";
import { inviteUrl } from "../packages/backend/src/invite-link";
import { deadlineStrings } from "../packages/backend/src/order-windows";
import {
  disputesBlockedNotice,
  requireSessionSubject,
} from "../packages/backend/src/session-identity";
import { fail, type ReadContext } from "./admissionContext";
import {
  chainPhaseValidator,
  deadlineStringsValidator,
  quoteTermsValidator,
  stageValidator,
} from "./admissionValidators";
import { authComponent, isOperator as operatorIsOperator } from "./auth";
import { isQuoteBuyer } from "./auth/identity";
import {
  applyChainObservation,
  type ChainObservationDb,
  type ChainObservationResult,
  type ChainOrderRow,
} from "./observationIngest";
import { projectDeliveryPhase } from "./orderProjection";
import { membershipFor } from "./paymentMonitor";

const openSettlementRef = makeFunctionReference<"mutation">(
  "settlement:openFromObservation",
);

const recordObservationArgs = v.object({
  orderId: v.string(),
  address: v.string(),
  nonce: v.string(),
  artifactFingerprint: v.string(),
  phase: v.string(),
  revision: v.number(),
  deliveryManifest: v.optional(v.union(v.string(), v.null())),
  // R25 O-01: optional, so an observer that has not been redeployed still
  // writes a valid row and every existing row still reads.
  evidenceCommitment: v.optional(v.string()),
});

const observationBinding = v.union(
  v.object({
    kind: v.literal("bind"),
    phase: v.string(),
    revision: v.number(),
    orderId: v.string(),
  }),
  v.object({ kind: v.literal("stale"), reason: v.string() }),
  v.object({ kind: v.literal("contradictory"), reason: v.string() }),
  v.object({ kind: v.literal("address-claimed"), reason: v.string() }),
);

const orderPhase = chainPhaseValidator;

const chainOrderRecord = v.object({
  orderId: v.string(),
  network: v.literal("preprod"),
  address: v.string(),
  phase: orderPhase,
  revision: v.number(),
  deliveryManifest: v.union(v.string(), v.null()),
  observedAt: v.union(v.number(), v.null()),
  fresh: v.union(v.boolean(), v.null()),
  fileCount: v.number(),
});

type ChainOrderPhase =
  | "DEPLOYED"
  | "RESERVED"
  | "ACCEPTED"
  | "SUBMITTED"
  | "DISPUTED"
  | "APPROVED"
  | "CANCELLED";

type ChainOrderDocument = Omit<ChainOrderRow, "phase"> & {
  _id: string;
  quoteId: string;
  network: "preprod";
  phase: ChainOrderPhase;
};

function toChainOrderRow(doc: ChainOrderDocument): ChainOrderRow {
  return {
    orderId: doc.orderId,
    address: doc.address,
    nonce: doc.nonce,
    artifactFingerprint: doc.artifactFingerprint,
    phase: doc.phase,
    revision: doc.revision,
    deliveryManifest: doc.deliveryManifest ?? null,
    terminal: doc.terminal,
    merchantActive: doc.merchantActive,
    observedAt: doc.observedAt ?? null,
  };
}

type ChainDbCtx = {
  db: {
    query: (table: string) => {
      withIndex: (
        name: string,
        q: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => { unique: () => Promise<unknown> };
    };
    patch: (...args: unknown[]) => Promise<unknown>;
    insert: (table: string, fields: Record<string, unknown>) => unknown;
  };
};

function findChainOrder(
  ctx: ChainDbCtx,
  index: "by_order" | "by_address",
  field: "orderId" | "address",
  value: string,
): Promise<ChainOrderDocument | null> {
  return ctx.db
    .query("chainOrders")
    .withIndex(index, (q) => q.eq(field, value))
    .unique() as Promise<ChainOrderDocument | null>;
}

function chainDb(ctx: ChainDbCtx): ChainObservationDb {
  return {
    async orderById(orderId) {
      const doc = await findChainOrder(ctx, "by_order", "orderId", orderId);
      return doc ? toChainOrderRow(doc) : undefined;
    },
    async addressOwner(address) {
      const doc = await findChainOrder(ctx, "by_address", "address", address);
      return doc ? { orderId: doc.orderId } : undefined;
    },
    async patchOrder(orderId, patch) {
      const doc = await findChainOrder(ctx, "by_order", "orderId", orderId);
      if (!doc) fail("NOT_FOUND", "chain order disappeared mid-observation");
      await ctx.db.patch(doc._id, patch);
    },
    async insertObservation(record) {
      await ctx.db.insert("chainObservations", record);
    },
  };
}

export const recordObservation = internalMutationGeneric({
  args: recordObservationArgs,
  returns: observationBinding,
  handler: async (ctx, args): Promise<ChainObservationResult> => {
    const result = await applyChainObservation(
      chainDb(ctx as unknown as ChainDbCtx),
      {
        orderId: args.orderId,
        address: args.address,
        nonce: args.nonce,
        artifactFingerprint: args.artifactFingerprint,
        phase: args.phase,
        revision: args.revision,
        ...(args.deliveryManifest !== undefined
          ? { deliveryManifest: args.deliveryManifest }
          : {}),
        ...(args.evidenceCommitment !== undefined
          ? { evidenceCommitment: args.evidenceCommitment }
          : {}),
      },
      Date.now(),
    );
    if (result.kind === "bind") {
      await projectDeliveryPhase(ctx, args.orderId, args.phase, args.revision);
      if (args.phase === "APPROVED" || args.phase === "CANCELLED")
        await ctx.scheduler.runAfter(0, openSettlementRef, {
          orderId: args.orderId,
        });
    }
    return result as ChainObservationResult;
  },
});

export const read = internalQueryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(chainOrderRecord, v.null()),
  handler: async (ctx: ReadContext, args) => {
    const quoteId = args.quoteId.trim();
    if (!quoteId) return null;
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const quote = ((await ctx.db
      .query("frozenQuotes")
      .withIndex("by_quote", (q) => q.eq("id", quoteId))
      .unique()) ??
      (await ctx.db
        .query("approvedQuotes")
        .withIndex("by_quote", (q) => q.eq("id", quoteId))
        .unique())) as {
      scopeId: string;
      buyerAccountId: string;
    } | null;
    if (!quote) return null;
    const doc = (await ctx.db
      .query("chainOrders")
      .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
      .unique()) as ChainOrderDocument | null;
    if (!doc) return null;
    const membership = (await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q.eq("privySubject", subject).eq("scopeId", quote.scopeId),
      )
      .unique()) as {
      role: "buyer" | "merchant" | "operator";
      accountId: string;
      status: "active" | "revoked";
    } | null;
    const isBuyer = isQuoteBuyer(membership, quote.buyerAccountId);
    const isMerchant =
      membership?.status === "active" && membership.role === "merchant";
    if (!isBuyer && !isMerchant) return null;
    const observedAt = doc.observedAt ?? null;
    const fresh =
      observedAt === null
        ? null
        : Date.now() - observedAt <= MAX_OBSERVATION_AGE_MS;
    const [deliveries, grants] = await Promise.all([
      ctx.db
        .query("deliveries")
        .withIndex("by_order", (q) => q.eq("orderId", doc.orderId))
        .collect(),
      // R25 AC-01: bounded. Grants are kept forever by design (see
      // `sweepGrants`), and this only feeds a fallback count, so a ceiling far
      // above any real order is enough to keep the transaction bounded.
      ctx.db
        .query("fileGrants")
        .withIndex("by_order", (q) => q.eq("orderId", doc.orderId))
        .take(512),
    ]);
    const lastDelivery = deliveries[deliveries.length - 1] as
      | { files?: unknown[] }
      | undefined;
    const fileCount: number = lastDelivery?.files
      ? lastDelivery.files.length
      : grants.filter((g: { storageId?: string }) => !!g.storageId).length;
    return {
      orderId: doc.orderId,
      network: "preprod" as const,
      address: doc.address,
      phase: doc.phase as ChainOrderDocument["phase"],
      revision: doc.revision,
      deliveryManifest: doc.deliveryManifest ?? null,
      observedAt,
      fresh,
      fileCount,
    };
  },
});

export const orders = {
  recordObservation,
  read,
};

export type { ChainObservationResult, ObservationBinding };

type Stage = Infer<typeof stageValidator>;

const STAGE = stageValidator;

const ROLE = v.union(
  v.literal("buyer"),
  v.literal("merchant"),
  v.literal("operator"),
);

const NETWORK_HEX =
  "70726570726f6400000000000000000000000000000000000000000000000000";

type Authorization = { authorization: { status: string } };

export type PaymentState =
  | "none"
  | "pending"
  | "held"
  | "captured"
  | "released"
  | "failed"
  | "needs-card";

const stageOf = (
  observation: Authorization | null,
  chainOrder: { phase: Stage } | null,
): Stage => {
  if (chainOrder) return chainOrder.phase;
  // A hold is only real when the provider authorized or captured it; a frozen
  // quote or a pending intent is not money, so it stays QUOTE.
  const status = observation?.authorization.status;
  return status === "authorized" || status === "captured"
    ? "PAYMENT_HELD"
    : "QUOTE";
};

/**
 * The label follows the provider. A settlement op deletes the observation, so
 * the receipt on the completed op is the only surviving record of a capture or
 * a release. `phase` is the tie-breaker: a cancelled order cannot show
 * Captured, nor an approved one Released, so a stale status yields to the chain.
 */
export const paymentStateOf = (
  payment: unknown,
  observation: Authorization | null,
  settlement: { action: "capture" | "void"; state: string } | null,
  phase?: string | null,
): PaymentState => {
  if (!payment) return "none";
  const settle = (state: PaymentState): PaymentState =>
    (phase === "CANCELLED" && state === "captured") ||
    (phase === "APPROVED" && state === "released")
      ? "pending"
      : state;
  if (settlement?.state === "complete")
    return settle(settlement.action === "capture" ? "captured" : "released");
  const status = observation?.authorization.status;
  if (status === "captured") return settle("captured");
  if (status === "voided") return settle("released");
  if (status === "failed") return "failed";
  return status === "authorized" ? "held" : "pending";
};

/**
 * R37: delegates to `auth.ts`. It used to be a second copy that tested the
 * allowlist length itself, so `orders.order` could disagree with
 * `diagnostics.read` about whether an operator exists.
 */
const isOperator = (ctx: ReadContext) => operatorIsOperator(ctx);

const orderDetailValidator = v.object({
  quoteId: v.string(),
  orderId: v.union(v.string(), v.null()),
  title: v.string(),
  brief: v.string(),
  amountUsd: v.number(),
  studioName: v.string(),
  role: ROLE,
  stage: STAGE,
  version: v.number(),
  clientEmail: v.union(v.string(), v.null()),
  inviteUrl: v.union(v.string(), v.null()),
  inviteClaimed: v.boolean(),
  /**
   * G-04: the server's own clock, in the same epoch milliseconds as the
   * deadlines. The client compares `now` against server-issued deadlines, and
   * `Date.now()` is the device's clock: a phone 10 minutes fast was offered the
   * expiry action while the server still accepted the normal one. Carrying the
   * server's value lets the client apply an offset instead of trusting the
   * device.
   *
   * Convex has no public server-time API — `clientClockSkewMs` exists inside
   * the client but is not exported and covers only token refresh — so this is
   * the cheapest correct source: one number on a payload that is already sent.
   */
  serverNow: v.number(),
  deadlines: v.union(deadlineStringsValidator, v.null()),
  /**
   * R37: what a dispute would actually do here, or `null` when it would work.
   * The page renders the button either way — the circuit is on the chain — but
   * it can now warn before the buyer commits a note and a transaction.
   */
  disputes: v.union(v.string(), v.null()),
  chain: v.object({
    network: v.string(),
    orderNonce: v.string(),
    termsCommitment: v.string(),
    buyerCommitment: v.union(v.string(), v.null()),
    merchantCommitment: v.string(),
    operatorCommitment: v.string(),
  }),
  terms: quoteTermsValidator,
  payment: v.object({
    state: v.union(
      v.literal("none"),
      v.literal("pending"),
      v.literal("held"),
      v.literal("captured"),
      v.literal("released"),
      v.literal("failed"),
      v.literal("needs-card"),
    ),
    mode: v.union(v.literal("test"), v.literal("live"), v.null()),
  }),
  contract: v.union(
    v.object({
      address: v.string(),
      phase: v.string(),
      revision: v.number(),
      fresh: v.union(v.boolean(), v.null()),
      observedAt: v.union(v.number(), v.null()),
      /**
       * R25 O-01: the dispute evidence the chain committed, so a resolved
       * dispute is auditable. `null` for a row observed before this field
       * existed, and for an order that never disputed — the read path must not
       * pretend "not recorded" is "no evidence".
       */
      evidenceCommitment: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  delivery: v.object({
    manifest: v.union(v.string(), v.null()),
    files: v.array(
      v.object({
        index: v.number(),
        sha256: v.string(),
        contentType: v.string(),
        byteLength: v.number(),
      }),
    ),
  }),
});

export type OrderDetail = Infer<typeof orderDetailValidator>;

export const order = queryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(orderDetailValidator, v.null()),
  handler: async (ctx: ReadContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    if (!draft) return null;
    // Everything below the draft is keyed by the draft's own scope or id, so it
    // is independent and runs in one batch. These used to be six sequential
    // awaits: on a cold read that is six serial dependency chains for a page the
    // user is staring at.
    const [membership, chainOrder, frozen, payment] = await Promise.all([
      membershipFor(ctx, subject, draft.scopeId),
      ctx.db
        .query("chainOrders")
        .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
        .unique(),
      ctx.db
        .query("frozenQuotes")
        .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
        .unique(),
      ctx.db
        .query("paymentIntents")
        .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
        .unique(),
    ]);
    const disputed = chainOrder?.phase === "DISPUTED";
    // The allowlist is the only source of operator rights (`auth.ts`). A stored
    // `operator` membership row used to be a second source here, but the
    // `!disputed` refusal below made it unreachable, so it was removed rather
    // than left looking load-bearing.
    const operator = disputed && (await isOperator(ctx));
    if (!operator && membership?.status !== "active") return null;
    const role: "buyer" | "merchant" | "operator" = operator
      ? "operator"
      : membership?.role === "merchant"
        ? "merchant"
        : "buyer";
    const [observation, delivery, settlement, latestObservation] =
      await Promise.all([
        payment
          ? ctx.db
              .query("paymentObservations")
              .withIndex("by_payment_intent", (q) =>
                q.eq("paymentIntentId", payment._id),
              )
              .unique()
          : null,
        chainOrder
          ? ctx.db
              .query("deliveries")
              .withIndex("by_order", (q) => q.eq("orderId", chainOrder.orderId))
              .first()
          : null,
        payment
          ? ctx.db
              .query("settlementOps")
              .withIndex("by_intent_state", (q) =>
                q.eq("paymentIntentId", payment._id).eq("state", "complete"),
              )
              .first()
          : null,
        // R25 O-01: the newest observation row carries the evidence the chain
        // committed at that revision. Indexed by order and read as the tail of
        // the range, so this is one bounded read, not a scan.
        chainOrder
          ? ctx.db
              .query("chainObservations")
              .withIndex("by_order", (q) => q.eq("orderId", chainOrder.orderId))
              .order("desc")
              .first()
          : null,
      ]);
    const merchant = role === "merchant";
    return {
      quoteId: draft.id,
      orderId: chainOrder?.orderId ?? null,
      title: draft.title,
      brief: draft.brief,
      amountUsd: draft.amountUsd,
      studioName: draft.studioName,
      role,
      stage: stageOf(observation, chainOrder as { phase: Stage } | null),
      version: frozen?.version ?? 1,
      clientEmail: merchant ? draft.clientEmail : null,
      inviteUrl:
        merchant && !draft.buyerSubject
          ? inviteUrl(draft.id, draft.inviteToken)
          : null,
      inviteClaimed: Boolean(draft.buyerSubject),
      // G-04: read once, so every field below it is consistent with the same
      // instant. The client turns this into an offset (`serverNow - Date.now()`)
      // and applies it to its own ticker.
      serverNow: Date.now(),
      deadlines: frozen ? deadlineStrings(frozen) : null,
      disputes: disputesBlockedNotice(),
      chain: {
        network: NETWORK_HEX,
        orderNonce: draft.orderNonce,
        termsCommitment: draft.termsCommitment,
        buyerCommitment: draft.buyerCommitment ?? null,
        merchantCommitment: draft.merchantCommitment,
        operatorCommitment: draft.operatorCommitment ?? "",
      },
      terms: draft.terms,
      payment: {
        state: paymentStateOf(
          payment,
          observation,
          settlement,
          chainOrder?.phase,
        ),
        mode: payment ? ("test" as const) : null,
      },
      contract: chainOrder
        ? {
            address: chainOrder.address,
            phase: chainOrder.phase,
            revision: chainOrder.revision,
            fresh:
              chainOrder.observedAt == null
                ? null
                : Date.now() - chainOrder.observedAt <= MAX_OBSERVATION_AGE_MS,
            observedAt: chainOrder.observedAt ?? null,
            evidenceCommitment: latestObservation?.evidenceCommitment ?? null,
          }
        : null,
      delivery: {
        manifest: chainOrder?.deliveryManifest ?? null,
        files: (delivery?.files ?? []).map((file, index) => ({
          index,
          sha256: file.sha256,
          contentType: file.contentType,
          byteLength: file.byteLength,
        })),
      },
    };
  },
});

const listRowValidator = v.object({
  quoteId: v.string(),
  title: v.string(),
  studioName: v.string(),
  role: ROLE,
  amountUsd: v.number(),
  stage: STAGE,
  lastActivityAt: v.number(),
  updatedAt: v.number(),
});

/**
 * How many drafts one list request will consider, per source. This is a product
 * bound, not an implementation detail: the list is a dashboard, and a user with
 * more than this many open orders needs the paged view rather than a longer
 * page. It is stated once so the join below is bounded by the same number the
 * draft read is — the previous shape capped the *join* at 512 rows instead,
 * which dropped chain rows for drafts the user could still see.
 */
const LIST_DRAFT_LIMIT = 64;

export const list = queryGeneric({
  args: {},
  returns: v.array(listRowValidator),
  handler: async (ctx: ReadContext) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const [memberships, mine, buying] = await Promise.all([
      ctx.db
        .query("memberships")
        .withIndex("by_subject", (q) => q.eq("privySubject", subject))
        .take(LIST_DRAFT_LIMIT),
      ctx.db
        .query("quoteDrafts")
        .withIndex("by_merchant", (q) => q.eq("merchantSubject", subject))
        .take(LIST_DRAFT_LIMIT),
      ctx.db
        .query("quoteDrafts")
        .withIndex("by_buyer", (q) => q.eq("buyerSubject", subject))
        .take(LIST_DRAFT_LIMIT),
    ]);
    const active = memberships.filter((row) => row.status === "active");
    const drafts = [...mine, ...buying];

    const operator = await isOperator(ctx);
    const disputed = operator
      ? await ctx.db
          .query("chainOrders")
          .withIndex("by_terminal_phase", (q) =>
            q.eq("terminal", false).eq("phase", "DISPUTED"),
          )
          .take(LIST_DRAFT_LIMIT)
      : [];
    const wanted = new Set([
      ...drafts.map((d) => d.id),
      ...disputed.map((c) => c.quoteId),
    ]);

    // Index-backed per-draft lookups, in parallel. A full-table scan with a cap
    // silently dropped any row past the cap, which showed a live order as QUOTE;
    // `by_quote` cannot. The draft set is already bounded, so this is bounded
    // too, and it all runs inside one query — the client still makes one call.
    const ids = [...wanted];
    /** One index read per key, all in flight at once. */
    const byKey = async <T>(
      read: (id: string) => Promise<T | null>,
      keys: string[],
    ): Promise<Map<string, T | null>> =>
      new Map(
        await Promise.all(
          keys.map(async (id) => [id, await read(id)] as const),
        ),
      );
    // The draft shape the operator branch joins onto; stated once so the map is
    // typed rather than `unknown`.
    type ListedDraft = {
      id: string;
      scopeId: string;
      title: string;
      studioName: string;
      amountUsd: number;
      updatedAt: number;
    };
    const [chainByQuote, paymentByQuote, draftById] = await Promise.all([
      byKey(
        (id) =>
          ctx.db
            .query("chainOrders")
            .withIndex("by_quote", (q) => q.eq("quoteId", id))
            .unique(),
        ids,
      ),
      byKey(
        (id) =>
          ctx.db
            .query("paymentIntents")
            .withIndex("by_quote", (q) => q.eq("quoteId", id))
            .unique(),
        ids,
      ),
      byKey(
        (id) =>
          ctx.db
            .query("quoteDrafts")
            .withIndex("by_quote", (q) => q.eq("id", id))
            .unique(),
        // Empty for a non-operator: the same typed call, no branch to type.
        operator ? disputed.map((chain) => chain.quoteId) : [],
      ),
    ]);
    // One observation per payment intent; fetch them for the payments we found.
    const observationByIntent = await byKey(
      (id) =>
        ctx.db
          .query("paymentObservations")
          .withIndex("by_payment_intent", (q) =>
            q.eq("paymentIntentId", id as never),
          )
          .unique(),
      [...paymentByQuote.values()].flatMap((p) => (p ? [String(p._id)] : [])),
    );

    const rows: Infer<typeof listRowValidator>[] = [];
    const seen = new Set<string>();
    const add = (
      draft: ListedDraft,
      role: "buyer" | "merchant" | "operator",
    ) => {
      if (seen.has(draft.id)) return;
      seen.add(draft.id);
      const chainOrder = chainByQuote.get(draft.id) ?? null;
      const payment = paymentByQuote.get(draft.id);
      const observation = payment
        ? (observationByIntent.get(String(payment._id)) ?? null)
        : null;
      const stage = stageOf(observation, chainOrder as { phase: Stage } | null);
      const lastActivityAt = Math.max(
        draft.updatedAt,
        chainOrder?.observedAt ?? 0,
        observation?.authorization.usableFrom ?? 0,
      );
      rows.push({
        quoteId: draft.id,
        title: draft.title,
        studioName: draft.studioName,
        role,
        amountUsd: draft.amountUsd,
        stage,
        lastActivityAt,
        updatedAt: lastActivityAt,
      });
    };

    for (const draft of drafts) {
      const membership = active.find((row) => row.scopeId === draft.scopeId);
      if (membership) add(draft, membership.role);
    }
    for (const chain of disputed) {
      const draft = draftById.get(chain.quoteId);
      if (draft) add(draft, "operator");
    }
    return rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  },
});

export const invite = queryGeneric({
  args: { quoteId: v.string(), token: v.string() },
  returns: v.union(
    v.object({
      title: v.string(),
      brief: v.string(),
      amountUsd: v.number(),
      studioName: v.string(),
      claimed: v.boolean(),
      network: v.string(),
      orderNonce: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx: ReadContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    // `v.string()` accepts a megabyte; a quote id is `quote_` + 32 hex and a
    // token is 64, so anything longer is refused before the query.
    if (args.quoteId.length > 64 || args.token.length > 64) return null;
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    // One refusal for "no such quote" and "wrong token": the token is a bearer
    // secret, so the two must be indistinguishable. Constant-time compare keeps
    // the prefix length out of the response time.
    if (!draft || !timingSafeEqualHex(draft.inviteToken, args.token))
      return null;
    // Holding the link is not enough: the reader must be the invited person or
    // already in the studio. Without this any signed-in user who sees the URL
    // (it carries the token in a query string) reads the brief and the amount.
    const membership = await membershipFor(ctx, subject, draft.scopeId);
    if (membership?.status !== "active") {
      const user = await authComponent.safeGetAuthUser(ctx);
      if ((user?.email ?? "").toLowerCase() !== draft.clientEmail) return null;
    }
    return {
      title: draft.title,
      brief: draft.brief,
      amountUsd: draft.amountUsd,
      studioName: draft.studioName,
      claimed: Boolean(draft.buyerSubject),
      network: NETWORK_HEX,
      orderNonce: draft.orderNonce,
    };
  },
});
