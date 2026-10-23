import type {
  DataModelFromSchemaDefinition,
  GenericQueryCtx,
} from "convex/server";
import type { GenericId } from "convex/values";
import { paymentBindsQuote } from "../packages/backend/src/admission-policy";
import { canonicalPayload } from "../packages/backend/src/trusted-provisioning-policy";
import type { AdmissionContext } from "./admissionContext";
import { isQuoteBuyer } from "./auth/identity";
import type schema from "./schema";

export const MONITOR_DURATION_MS = 5 * 60_000;
export const MONITOR_INTERVAL_MS = 15_000;
export const MONITOR_LEASE_MS = 60_000;

export type MonitorQueryContext = GenericQueryCtx<
  DataModelFromSchemaDefinition<typeof schema>
>;

export type MonitorStatus = {
  quoteVersion: number | null;
  canStart: boolean;
  state: "none" | "waiting" | "running" | "stopped" | "expired" | "unavailable";
  expiresAt: number | null;
  canStop: boolean;
};

type Session = { state: string; consentAt: number; expiresAt: number };

const lifetimeOf = (s: Session) =>
  Number.isSafeInteger(s.consentAt) &&
  s.consentAt >= 0 &&
  Number.isSafeInteger(s.expiresAt) &&
  s.expiresAt === s.consentAt + MONITOR_DURATION_MS;

export function monitorLive(session: Session, now: number) {
  return (
    session.state !== "stopped" &&
    lifetimeOf(session) &&
    Number.isSafeInteger(now) &&
    now >= session.consentAt &&
    now < session.expiresAt
  );
}

export function projectMonitorStatus(
  session: (Session & { state: "waiting" | "running" | "stopped" }) | null,
  bindingCurrent: boolean,
  ownsConsent: boolean,
  now: number,
): Pick<MonitorStatus, "state" | "expiresAt" | "canStop"> {
  if (!session) return { state: "none", expiresAt: null, canStop: false };
  const valid = lifetimeOf(session);
  const expiresAt = valid ? session.expiresAt : null;
  const canStop = ownsConsent && session.state !== "stopped";
  if (session.state === "stopped")
    return { state: "stopped", expiresAt, canStop };
  if (valid && Number.isSafeInteger(now) && now >= session.expiresAt)
    return { state: "expired", expiresAt, canStop };
  return {
    state:
      bindingCurrent && monitorLive(session, now)
        ? session.state
        : "unavailable",
    expiresAt,
    canStop,
  };
}

export const quoteById = (ctx: MonitorQueryContext, quoteId: string) =>
  ctx.db
    .query("frozenQuotes")
    .withIndex("by_quote", (q) => q.eq("id", quoteId))
    .unique();

export const paymentForQuote = (ctx: MonitorQueryContext, quoteId: string) =>
  ctx.db
    .query("paymentIntents")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .unique();

export const membershipFor = (
  ctx: MonitorQueryContext,
  subject: string,
  scopeId: string,
) =>
  ctx.db
    .query("memberships")
    .withIndex("by_subject_scope", (q) =>
      q.eq("privySubject", subject).eq("scopeId", scopeId),
    )
    .unique();

export const authoritiesFor = (
  ctx: MonitorQueryContext,
  entries: readonly (readonly [
    "quote" | "customer" | "membership" | "timing",
    string,
  ])[],
) =>
  Promise.all(
    entries.map(([kind, key]) =>
      ctx.db
        .query("trustedProvisioning")
        .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("key", key))
        .unique(),
    ),
  );

export async function monitorBinding(
  ctx: MonitorQueryContext,
  quoteId: string,
  subject: string,
) {
  const quote = await quoteById(ctx, quoteId);
  if (!quote) return null;
  const [membership, customer, payment, authorities] = await Promise.all([
    membershipFor(ctx, subject, quote.scopeId),
    ctx.db
      .query("stripeCustomers")
      .withIndex("by_buyer", (q) =>
        q.eq("buyerAccountId", quote.buyerAccountId),
      )
      .unique(),
    paymentForQuote(ctx, quoteId),
    authoritiesFor(ctx, [
      ["quote", quoteId],
      ["customer", quote.buyerAccountId],
      ["membership", JSON.stringify([subject, quote.scopeId])],
    ]),
  ]);
  if (
    !isQuoteBuyer(membership, quote.buyerAccountId) ||
    authorities.some((a) => a?.status === "revoked") ||
    !customer ||
    !payment ||
    !paymentBindsQuote(payment, quote) ||
    payment.network !== "preprod" ||
    quote.network !== "preprod" ||
    payment.environment !== "test" ||
    payment.stripeAccountId !== customer.stripeAccountId ||
    payment.stripeCustomerId !== customer.stripeCustomerId
  )
    return null;
  return {
    quote,
    payment,
    binding: canonicalPayload([
      quote,
      membership,
      customer,
      payment,
      authorities,
    ]),
  };
}

export async function monitorReceiptUsable(
  ctx: AdmissionContext,
  id: GenericId<"paymentMonitors">,
  generation: number | undefined,
  now: number,
) {
  const session = await ctx.db.get(id);
  if (
    !session ||
    session.generation !== generation ||
    !monitorLive(session, now)
  )
    return false;
  const current = await monitorBinding(
    ctx,
    session.quoteId,
    session.consentSubject,
  );
  return current?.binding === session.binding;
}

export async function invalidatePaymentObservation(
  ctx: Pick<AdmissionContext, "db">,
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
