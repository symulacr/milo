import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
  type AdmissionBinding,
  type AdmissionDecision,
  decideCanonicalAdmission,
  PAYMENT_AUTHORIZATION_WINDOW_MS,
  paymentBindsQuote,
} from "../packages/backend/src/admission-policy";
import { requirePrivySubject } from "../packages/backend/src/privy-identity";
import type { AdmissionContext } from "./admissionContext";
import { admissionArgs } from "./admissionValidators";
import { requireMembership } from "./auth/identity";
import { monitorReceiptUsable } from "./paymentMonitor";
import { assertProvisioningActive } from "./trustedProvisioning";

const inputValidator = v.object(admissionArgs);
export type AdmissionInput = Infer<typeof inputValidator>;

// Invoke only inside a Convex mutation: its indexed reads and final insert share OCC.
export async function admitCanonical(
  ctx: AdmissionContext,
  input: AdmissionInput,
): Promise<AdmissionDecision> {
  requirePrivySubject(await ctx.auth.getUserIdentity());
  const quote = await ctx.db
    .query("frozenQuotes")
    .withIndex("by_quote", (q) => q.eq("id", input.quoteId))
    .unique();
  if (!quote) throw new Error("Frozen quote required");
  await assertProvisioningActive(ctx, "quote", quote.id);
  await assertProvisioningActive(ctx, "customer", quote.buyerAccountId);
  const membership = await requireMembership(ctx, quote.scopeId);
  if (
    membership.role !== "buyer" ||
    membership.accountId !== quote.buyerAccountId
  )
    throw new Error("Authenticated quote buyer required");
  const reject = (reason: string): AdmissionDecision => ({
    kind: "rejected",
    reason,
  });
  if (
    !Number.isSafeInteger(input.expectedQuoteVersion) ||
    input.expectedQuoteVersion !== quote.version
  )
    return reject("frozen quote version changed");
  const [
    observation,
    payment,
    currentPayment,
    timing,
    nonceBinding,
    addressBinding,
    quoteBinding,
  ] = await Promise.all([
    ctx.db
      .query("deploymentObservations")
      .withIndex("by_observation", (q) => q.eq("id", input.observationId))
      .unique(),
    ctx.db.get(input.authorizationId),
    ctx.db
      .query("paymentObservations")
      .withIndex("by_payment_intent", (q) =>
        q.eq("paymentIntentId", input.authorizationId),
      )
      .unique(),
    ctx.db
      .query("admissionTimingPolicies")
      .withIndex("by_network", (q) => q.eq("network", quote.network))
      .unique(),
    ctx.db
      .query("canonicalBindings")
      .withIndex("by_network_nonce", (q) =>
        q.eq("network", quote.network).eq("nonce", quote.nonce),
      )
      .unique(),
    ctx.db
      .query("canonicalBindings")
      .withIndex("by_address", (q) => q.eq("address", input.address))
      .unique(),
    ctx.db
      .query("canonicalBindings")
      .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
      .unique(),
  ]);
  if (
    !observation ||
    observation.quoteId !== quote.id ||
    observation.quoteVersion !== quote.version
  )
    return reject("deployment observation quote provenance does not match");
  if (!payment || !currentPayment)
    return reject("current payment observation required");
  if (
    currentPayment.monitorId &&
    !(await monitorReceiptUsable(
      ctx,
      currentPayment.monitorId,
      currentPayment.monitorGeneration,
      Date.now(),
    ))
  )
    return reject("active payment monitoring consent required");
  const [quotePayment, providerPayment] = await Promise.all([
    ctx.db
      .query("paymentIntents")
      .withIndex("by_quote", (q) => q.eq("quoteId", quote.id))
      .unique(),
    ctx.db
      .query("paymentIntents")
      .withIndex("by_provider_intent", (q) =>
        q.eq("stripePaymentIntentId", payment.stripePaymentIntentId),
      )
      .unique(),
  ]);
  if (
    quotePayment?._id !== payment._id ||
    providerPayment?._id !== payment._id ||
    !paymentBindsQuote(payment, quote) ||
    payment.network !== quote.network ||
    payment.environment !== "test"
  )
    return reject("payment intent does not match frozen quote");
  const authorization = currentPayment.authorization;
  const now = Date.now();
  if (
    authorization.id !== payment._id ||
    authorization.usableUntil - authorization.usableFrom >
      PAYMENT_AUTHORIZATION_WINDOW_MS ||
    now - authorization.usableFrom >= PAYMENT_AUTHORIZATION_WINDOW_MS
  )
    return reject("current payment observation is stale or mismatched");
  let pending: AdmissionBinding | undefined;
  const decision = decideCanonicalAdmission(
    {
      transact: (operation) =>
        operation({
          authenticatedAccountId: () => membership.accountId,
          serverNow: () => now,
          getFrozenQuote: () => quote,
          getCurrentPaymentAuthorization: () => authorization,
          getObservedDeployment: () => observation,
          getAdmissionTimingPolicy: () => timing ?? undefined,
          getBinding: () => cleanBinding(nonceBinding),
          getBindingByAddress: () => cleanBinding(addressBinding),
          getBindingByQuote: () => cleanBinding(quoteBinding),
          insertBinding: (binding) => {
            pending = binding;
          },
        }),
    },
    {
      quoteId: input.quoteId,
      observationId: input.observationId,
      authorizationId: input.authorizationId,
      address: input.address,
    },
  );
  // Do not return a success before the database write has completed.
  if (pending) await ctx.db.insert("canonicalBindings", pending);
  return decision;
}

function cleanBinding(
  binding: AdmissionBinding | null,
): AdmissionBinding | undefined {
  if (!binding) return undefined;
  const {
    network,
    nonce,
    address,
    quoteId,
    observationId,
    authorizationId,
    boundAt,
  } = binding;
  return {
    network,
    nonce,
    address,
    quoteId,
    observationId,
    authorizationId,
    boundAt,
  };
}
