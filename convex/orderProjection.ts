import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { AdmissionContext } from "./admissionContext";

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

const PHASES: Partial<Record<string, DeliveryPhase>> = {
  ACCEPTED: "ACCEPTED",
  SUBMITTED: "SUBMITTED",
  DISPUTED: "DISPUTED",
};

export function deliveryPhaseFor(phase: string): DeliveryPhase {
  return PHASES[phase] ?? "TERMINAL";
}

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

function findOrder(ctx: AdmissionContext, orderId: string) {
  return ctx.db
    .query("orders")
    .withIndex("by_order", (q) => q.eq("id", orderId))
    .unique();
}

function orderRow(
  input: CreateOrderInput,
  disputeOperatorId: string | undefined,
  phase: DeliveryPhase,
  revision: number,
) {
  return {
    id: input.quoteId,
    buyerId: input.buyerId,
    merchantId: input.merchantId,
    ...(disputeOperatorId === undefined ? {} : { disputeOperatorId }),
    scopeId: input.scopeId,
    profile: "image-pack-v1" as const,
    outputCount: 3 as const,
    phase,
    revision,
  };
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
    const projection = await findOrder(ctx, input.quoteId);
    if (!projection) {
      await ctx.db.insert(
        "orders",
        orderRow(
          input,
          disputeOperatorId,
          deliveryPhaseFor(existing.phase),
          existing.revision,
        ),
      );
      return { orderId: existing.orderId, created: true };
    }
    return { orderId: existing.orderId, created: false };
  }
  const claimed = await ctx.db
    .query("chainOrders")
    .withIndex("by_address", (q) => q.eq("address", input.address))
    .unique();
  if (claimed) throw new Error("Contract address is already claimed");
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
    observedAt: Date.now(),
  });
  await ctx.db.insert(
    "orders",
    orderRow(input, disputeOperatorId, deliveryPhaseFor("DEPLOYED"), 0),
  );
  return { orderId: input.quoteId, created: true };
}

export async function projectDeliveryPhase(
  ctx: AdmissionContext,
  orderId: string,
  phase: string,
  revision: number,
): Promise<void> {
  const order = await findOrder(ctx, orderId);
  if (!order) throw new Error("Order projection is missing");
  const next = deliveryPhaseFor(phase);
  if (order.phase === next && order.revision === revision) return;
  await ctx.db.patch(order._id, { phase: next, revision });
}
