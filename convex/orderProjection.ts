import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { AdmissionContext } from "./admissionContext";

/**
 * Order creation: one durable `chainOrders` row (the phase authority) and one
 * `orders` row (the delivery projection read by `files.*`) for a quote that has
 * just been canonically admitted. Called inside the `admission.bind` mutation so
 * the binding, the chain projection and the delivery projection commit together.
 */

const deliveryPhase = v.union(
  v.literal("ACCEPTED"),
  v.literal("SUBMITTED"),
  v.literal("DISPUTED"),
  v.literal("TERMINAL"),
);

const createOrderArgs = v.object({
  quoteId: v.string(),
  scopeId: v.string(),
  buyerId: v.string(),
  merchantId: v.string(),
  address: v.string(),
  nonce: v.string(),
  artifactFingerprint: v.string(),
});

export type CreateOrderInput = Infer<typeof createOrderArgs>;

export type DeliveryPhase = Infer<typeof deliveryPhase>;

/**
 * The delivery projection only distinguishes the phases `files.*` acts on:
 * uploads are permitted in ACCEPTED, reads continue through SUBMITTED and
 * DISPUTED, and both terminal phases collapse to TERMINAL.
 */
export function deliveryPhaseFor(phase: string): DeliveryPhase {
  if (phase === "ACCEPTED") return "ACCEPTED";
  if (phase === "SUBMITTED") return "SUBMITTED";
  if (phase === "DISPUTED") return "DISPUTED";
  return "TERMINAL";
}

/**
 * The dispute operator is the scope's operator membership, resolved once here so
 * `files.*` and `delivery-policy` can name it without a second authority lookup.
 * A missing or revoked operator is not an admission failure: the order is created
 * with no operator, and the dispute read branch stays closed until one exists.
 */
async function resolveDisputeOperatorId(
  ctx: AdmissionContext,
  scopeId: string,
): Promise<string | undefined> {
  const operator = await ctx.db
    .query("memberships")
    .withIndex("by_scope_role", (q) =>
      q.eq("scopeId", scopeId).eq("role", "operator"),
    )
    .unique();
  return operator?.status === "active" ? operator.accountId : undefined;
}

export async function createOrder(
  ctx: AdmissionContext,
  input: CreateOrderInput,
): Promise<{ orderId: string; created: boolean }> {
  const disputeOperatorId = await resolveDisputeOperatorId(ctx, input.scopeId);
  const existing = await ctx.db
    .query("chainOrders")
    .withIndex("by_order", (q) => q.eq("orderId", input.quoteId))
    .unique();
  if (existing) {
    if (
      existing.quoteId !== input.quoteId ||
      existing.address !== input.address ||
      existing.nonce !== input.nonce
    )
      throw new Error("Existing order cannot be adopted or rebound");
    // A chain row without its delivery projection would strand `files.*` on an
    // order that exists on chain. Backfill rather than assume the pair is intact.
    const projection = await ctx.db
      .query("orders")
      .withIndex("by_order", (q) => q.eq("id", input.quoteId))
      .unique();
    if (!projection) {
      await ctx.db.insert("orders", {
        id: input.quoteId,
        buyerId: input.buyerId,
        merchantId: input.merchantId,
        ...(disputeOperatorId === undefined ? {} : { disputeOperatorId }),
        scopeId: input.scopeId,
        profile: "image-pack-v1",
        outputCount: 3,
        phase: deliveryPhaseFor(existing.phase),
        revision: existing.revision,
      });
      return { orderId: existing.orderId, created: true };
    }
    return { orderId: existing.orderId, created: false };
  }
  const claimed = await ctx.db
    .query("chainOrders")
    .withIndex("by_address", (q) => q.eq("address", input.address))
    .unique();
  if (claimed) throw new Error("Contract address is already claimed");
  const now = Date.now();
  await ctx.db.insert("chainOrders", {
    orderId: input.quoteId,
    quoteId: input.quoteId,
    network: "preprod",
    address: input.address,
    nonce: input.nonce,
    artifactFingerprint: input.artifactFingerprint,
    phase: "DEPLOYED",
    revision: 0,
    deliveryManifest: null,
    terminal: false,
    merchantActive: true,
    observedAt: now,
  });
  await ctx.db.insert("orders", {
    id: input.quoteId,
    buyerId: input.buyerId,
    merchantId: input.merchantId,
    ...(disputeOperatorId === undefined ? {} : { disputeOperatorId }),
    scopeId: input.scopeId,
    profile: "image-pack-v1",
    outputCount: 3,
    phase: deliveryPhaseFor("DEPLOYED"),
    revision: 0,
  });
  return { orderId: input.quoteId, created: true };
}

/**
 * Mirror one observed chain phase into the delivery projection. `chainOrders`
 * stays the authority; this only keeps `files.*` aligned with it.
 */
export async function projectDeliveryPhase(
  ctx: AdmissionContext,
  orderId: string,
  phase: string,
  revision: number,
): Promise<void> {
  const order = await ctx.db
    .query("orders")
    .withIndex("by_order", (q) => q.eq("id", orderId))
    .unique();
  if (!order) throw new Error("Order projection is missing");
  const next = deliveryPhaseFor(phase);
  if (order.phase === next && order.revision === revision) return;
  await ctx.db.patch(order._id, { phase: next, revision });
}
