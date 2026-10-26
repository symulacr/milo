/**
 * Cross-behaviour scenario for the order projection: one order walks the whole
 * phase ladder from deploy to terminal, and each step asserts what the buyer,
 * the merchant and the operator may see at that moment. Uses a handler double;
 * no hosted Convex, no network.
 */
import { describe, expect, test } from "bun:test";
import {
  createOrder,
  deliveryPhaseFor,
  projectDeliveryPhase,
} from "../convex/orderProjection";
import { databaseDouble } from "../convex/orderProjection.double";

const HEX = (c: string) => c.repeat(64);

const input = {
  quoteId: "quote-1",
  scopeId: "scope-1",
  buyerId: "buyer-1",
  merchantId: "merchant-1",
  address: HEX("a"),
  nonce: HEX("b"),
  artifactFingerprint: HEX("c"),
};

describe("scenario: one order walks the phase ladder", () => {
  test("deploy writes the chain row and the projection together, then follows every phase", async () => {
    const f = databaseDouble({ memberships: [] });
    expect(await createOrder(f.ctx, input)).toEqual({
      orderId: "quote-1",
      created: true,
    });
    expect(f.tables.chainOrders).toHaveLength(1);
    expect(f.tables.chainOrders[0]).toMatchObject({
      quoteId: "quote-1",
      address: HEX("a"),
      phase: "DEPLOYED",
      revision: 0,
      terminal: false,
    });
    expect(f.tables.orders[0]).toMatchObject({
      id: "quote-1",
      phase: "TERMINAL",
      revision: 0,
      profile: "image-pack-v1",
      outputCount: 3,
    });
    for (const [phase, revision] of [
      ["ACCEPTED", 1],
      ["SUBMITTED", 2],
      ["DISPUTED", 3],
      ["TERMINAL", 4],
    ] as const) {
      await projectDeliveryPhase(f.ctx, "quote-1", phase, revision);
      expect(f.tables.orders[0]).toMatchObject({ phase, revision });
    }
  });

  test("an unknown chain phase projects to terminal, never to an open phase", () => {
    for (const phase of ["RESERVED", "DEPLOYED", "CANCELLED", "", "garbage"]) {
      expect(deliveryPhaseFor(phase)).toBe("TERMINAL");
    }
    for (const phase of ["ACCEPTED", "SUBMITTED", "DISPUTED"] as const) {
      expect(deliveryPhaseFor(phase)).toBe(phase);
    }
  });

  test("replaying the same phase and revision is a no-op, not a second write", async () => {
    const f = databaseDouble({ memberships: [] });
    await createOrder(f.ctx, input);
    await projectDeliveryPhase(f.ctx, "quote-1", "ACCEPTED", 1);
    const before = { ...f.tables.orders[0] };
    await projectDeliveryPhase(f.ctx, "quote-1", "ACCEPTED", 1);
    expect(f.tables.orders[0]).toEqual(before);
  });

  test("a redeploy is not a second order, and neither a rebind nor a stolen address is allowed", async () => {
    const f = databaseDouble({ memberships: [] });
    await createOrder(f.ctx, input);
    expect(await createOrder(f.ctx, input)).toEqual({
      orderId: "quote-1",
      created: false,
    });
    expect(f.tables.chainOrders).toHaveLength(1);
    expect(f.tables.orders).toHaveLength(1);
    await expect(
      createOrder(f.ctx, { ...input, address: HEX("d") }),
    ).rejects.toThrow(/adopted or rebound/);
    await expect(
      createOrder(f.ctx, { ...input, quoteId: "quote-2" }),
    ).rejects.toThrow(/already claimed/);
  });

  test("a dispute operator is recorded only when the scope's operator is active", async () => {
    for (const status of ["active", "revoked"] as const) {
      const f = databaseDouble({ memberships: [] });
      f.tables.memberships.push({
        _id: "m1",
        scopeId: "scope-1",
        role: "operator",
        status,
        accountId: "operator-1",
        privySubject: "did:privy:operator",
      });
      await createOrder(f.ctx, input);
      if (status === "active")
        expect(f.tables.orders[0]).toMatchObject({
          disputeOperatorId: "operator-1",
        });
      else expect(f.tables.orders[0]).not.toHaveProperty("disputeOperatorId");
    }
  });

  test("projecting a phase for an order that does not exist fails loudly", async () => {
    const f = databaseDouble({ memberships: [] });
    await expect(
      projectDeliveryPhase(f.ctx, "quote-absent", "ACCEPTED", 1),
    ).rejects.toThrow(/missing/);
  });
});
