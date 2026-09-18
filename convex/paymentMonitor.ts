import type {
  DataModelFromSchemaDefinition,
  GenericQueryCtx,
} from "convex/server";
import type { GenericId } from "convex/values";
import { canonicalPayload } from "../packages/backend/src/trusted-provisioning-policy";
import type { AdmissionContext } from "./admissionContext";
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

export function projectMonitorStatus(
  session: {
    state: "waiting" | "running" | "stopped";
    consentAt: number;
    expiresAt: number;
  } | null,
  bindingCurrent: boolean,
  ownsConsent: boolean,
  now: number,
): Pick<MonitorStatus, "state" | "expiresAt" | "canStop"> {
  if (!session) return { state: "none", expiresAt: null, canStop: false };
  const validLifetime =
    Number.isSafeInteger(session.consentAt) &&
    session.consentAt >= 0 &&
    Number.isSafeInteger(session.expiresAt) &&
    session.expiresAt === session.consentAt + MONITOR_DURATION_MS;
  const expiresAt = validLifetime ? session.expiresAt : null;
  const canStop = ownsConsent && session.state !== "stopped";
  if (session.state === "stopped")
    return { state: "stopped", expiresAt, canStop };
  if (validLifetime && Number.isSafeInteger(now) && now >= session.expiresAt)
    return { state: "expired", expiresAt, canStop };
  return {
    state:
      bindingCurrent && validLifetime && monitorLive(session, now)
        ? session.state
        : "unavailable",
    expiresAt,
    canStop,
  };
}

export function monitorLive(
  session: { state: string; consentAt: number; expiresAt: number },
  now: number,
) {
  return (
    session.state !== "stopped" &&
    Number.isSafeInteger(now) &&
    Number.isSafeInteger(session.consentAt) &&
    session.consentAt >= 0 &&
    now >= session.consentAt &&
    session.expiresAt === session.consentAt + MONITOR_DURATION_MS &&
    now < session.expiresAt
  );
}

// Snapshot all authority, including trusted revocation versions, across external I/O.
export async function monitorBinding(
  ctx: MonitorQueryContext,
  quoteId: string,
  subject: string,
) {
  const quote = await ctx.db
    .query("frozenQuotes")
    .withIndex("by_quote", (q) => q.eq("id", quoteId))
    .unique();
  if (!quote) return null;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_subject_scope", (q) =>
      q.eq("privySubject", subject).eq("scopeId", quote.scopeId),
    )
    .unique();
  const customer = await ctx.db
    .query("stripeCustomers")
    .withIndex("by_buyer", (q) => q.eq("buyerAccountId", quote.buyerAccountId))
    .unique();
  const payment = await ctx.db
    .query("paymentIntents")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .unique();
  const authorities = await Promise.all(
    (
      [
        ["quote", quoteId],
        ["customer", quote.buyerAccountId],
        ["membership", JSON.stringify([subject, quote.scopeId])],
      ] as const
    ).map(([kind, key]) =>
      ctx.db
        .query("trustedProvisioning")
        .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("key", key))
        .unique(),
    ),
  );
  if (
    membership?.status !== "active" ||
    membership.role !== "buyer" ||
    membership.accountId !== quote.buyerAccountId ||
    authorities.some((a) => a?.status === "revoked") ||
    !customer ||
    !payment ||
    payment.quoteVersion !== quote.version ||
    payment.buyerAccountId !== quote.buyerAccountId ||
    payment.amountMinor !== quote.amountMinor ||
    payment.currency !== quote.currency ||
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
