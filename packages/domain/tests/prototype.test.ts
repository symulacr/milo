import { describe, expect, test } from "bun:test";
import {
  type Action,
  type ActionPayload,
  availableActions,
  changeRole,
  createScenario,
  type Role,
  type SimState,
  SYNTHETIC_ORDER_FIXTURE,
  transition,
} from "../src/prototype";

const as = (state: SimState, role: Role) => changeRole(state, role);
const act = (state: SimState, action: Action, payload?: ActionPayload) =>
  transition(state, action, payload);

describe("synthetic prototype simulator", () => {
  test("uses a deterministic, explicitly synthetic three-image fixture", () => {
    expect(SYNTHETIC_ORDER_FIXTURE).toEqual({
      quote: { amountMinor: 36_000, currency: "USD", merchant: "North Studio" },
      files: [
        { id: "01", name: "01-still-hero.png" },
        { id: "02", name: "02-still-detail.png" },
        { id: "03", name: "03-still-collection.png" },
      ],
    });
    expect(createScenario("fresh")).toEqual(createScenario("fresh"));
    expect(createScenario("fresh").events[0].detail).toContain(
      "no real order, payment, or chain effect",
    );
  });

  test("creates each documented scenario with review defaults", () => {
    expect(createScenario("review")).toMatchObject({
      phase: "SUBMITTED",
      payment: "authorized",
      role: "buyer",
      filesVerified: false,
    });
    expect(createScenario("dispute")).toMatchObject({
      phase: "DISPUTED",
      role: "operator",
    });
    expect(createScenario("expired").payment).toBe("expired");
    expect(createScenario("pending")).toMatchObject({
      phase: "APPROVED",
      outcomeUnknown: true,
    });
    expect(createScenario("lost-capability").capabilityAvailable).toBe(false);
  });

  test("completes the buyer, merchant, buyer lifecycle and keeps payment separate from approval", () => {
    let state = createScenario("fresh");
    state = act(state, "ready");
    state = act(state, "verify-recovery");
    state = act(state, "authorize");
    state = act(state, "deploy");
    state = act(state, "reserve");
    state = act(as(state, "merchant"), "accept");
    state = act(state, "submit");
    state = act(as(state, "buyer"), "verify", {
      verifiedFileIds: ["01", "02", "03"],
    });
    state = act(state, "approve");
    expect(state).toMatchObject({
      phase: "APPROVED",
      payment: "authorized",
      filesVerified: true,
    });
    expect(state.revision).toBe(11);
    expect(state.events.map((event) => event.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `event-${index}`),
    );
  });

  test("enforces every lifecycle role and precondition with negative controls", () => {
    const fresh = createScenario("fresh");
    expect(() => act(fresh, "ready")).not.toThrow();
    expect(() => act(act(fresh, "ready"), "ready")).toThrow("already ready");
    expect(() => act(fresh, "authorize")).toThrow("prerequisites");
    expect(() => act(fresh, "deploy")).toThrow("prerequisites");
    expect(() => act(fresh, "reserve")).toThrow("DEPLOYED");
    expect(() => act(fresh, "accept")).toThrow("merchant role");
    expect(() => act(fresh, "submit")).toThrow("merchant role");
    expect(() => act(fresh, "approve")).toThrow("SUBMITTED");
    expect(() => act(fresh, "dispute")).toThrow("SUBMITTED");
    expect(() => act(fresh, "resolve-approve")).toThrow("operator role");
    expect(() => act(fresh, "resolve-cancel")).toThrow("operator role");
    expect(() => act(fresh, "cancel")).toThrow("RESERVED");
    expect(() => act(fresh, "capture")).toThrow("operator role");
    expect(() => act(fresh, "void")).toThrow("operator role");
  });

  test("refuses duplicate or stale synthetic authorizations in DRAFT", () => {
    const ready = act(act(createScenario("fresh"), "ready"), "verify-recovery");
    const authorized = act(ready, "authorize");
    expect(() => act(authorized, "authorize")).toThrow("payment hold already");
    for (const payment of ["captured", "expired", "voided"] as const) {
      expect(() => act({ ...ready, payment }, "authorize")).toThrow(
        "payment hold already",
      );
    }
    expect(() =>
      act({ ...ready, capabilityAvailable: false }, "authorize"),
    ).toThrow("unavailable");
    expect(() => act({ ...ready, outcomeUnknown: true }, "authorize")).toThrow(
      "reconciled",
    );
  });

  test("requires all file receipt IDs before buyer approval", () => {
    const review = createScenario("review");
    expect(() =>
      act(review, "verify", { verifiedFileIds: ["01", "02"] }),
    ).toThrow("all three");
    expect(() =>
      act(review, "verify", { verifiedFileIds: ["01", "02", "02"] }),
    ).toThrow("all three");
    expect(() =>
      act(review, "verify", { verifiedFileIds: ["01", "02", "04"] }),
    ).toThrow("all three");
    expect(() => act(review, "approve")).toThrow("verified file receipts");
    const verified = act(review, "verify", {
      verifiedFileIds: ["03", "01", "02"],
    });
    expect(act(verified, "approve").phase).toBe("APPROVED");
  });

  test("allows only buyer cancellation from RESERVED and bounded operator dispute resolutions", () => {
    let reserved = createScenario("fresh");
    for (const action of [
      "ready",
      "verify-recovery",
      "authorize",
      "deploy",
      "reserve",
    ] as const)
      reserved = act(reserved, action);
    expect(() => act(as(reserved, "merchant"), "cancel")).toThrow("buyer role");
    expect(act(reserved, "cancel").phase).toBe("CANCELLED");
    expect(act(as(reserved, "merchant"), "decline").phase).toBe("CANCELLED");
    const dispute = createScenario("dispute");
    expect(act(dispute, "resolve-approve")).toMatchObject({
      phase: "APPROVED",
      payment: "authorized",
    });
    expect(act(dispute, "resolve-cancel")).toMatchObject({
      phase: "CANCELLED",
      payment: "authorized",
    });
  });

  test("opens disputes per the documented caller and phase matrix (01 §4.2)", () => {
    let accepted = createScenario("fresh");
    for (const action of [
      "ready",
      "verify-recovery",
      "authorize",
      "deploy",
      "reserve",
    ] as const)
      accepted = act(accepted, action);
    accepted = act(as(accepted, "merchant"), "accept");
    // Buyer in ACCEPTED may open (01 §4.2: either party in ACCEPTED).
    const buyerDispute = act(as(accepted, "buyer"), "dispute");
    expect(buyerDispute.phase).toBe("DISPUTED");
    // Merchant in ACCEPTED may open; full-approval resolution needs the delivery.
    const merchantDispute = act(accepted, "dispute");
    expect(merchantDispute).toMatchObject({
      phase: "DISPUTED",
      deliverySubmitted: false,
    });
    expect(() =>
      act(as(merchantDispute, "operator"), "resolve-approve"),
    ).toThrow("submitted delivery");
    expect(act(as(merchantDispute, "operator"), "resolve-cancel").phase).toBe(
      "CANCELLED",
    );
    // Merchant in SUBMITTED may not open; buyer in SUBMITTED may.
    const submitted = act(accepted, "submit");
    expect(() => act(submitted, "dispute")).toThrow("ACCEPTED");
    expect(act(as(submitted, "buyer"), "dispute")).toMatchObject({
      phase: "DISPUTED",
      deliverySubmitted: true,
    });
  });

  test("models payment reconciliation, expiry, ambiguity, and synthetic capability without external effects", () => {
    const approved = { ...createScenario("pending"), outcomeUnknown: false };
    expect(() => act(createScenario("pending"), "capture")).toThrow(
      "reconciled",
    );
    expect(
      act(act(createScenario("pending"), "reconcile"), "capture").payment,
    ).toBe("captured");
    expect(act(approved, "expire-hold")).toMatchObject({
      phase: "APPROVED",
      payment: "expired",
    });
    const cancelled = {
      ...createScenario("dispute"),
      phase: "CANCELLED" as const,
    };
    expect(act(cancelled, "void").payment).toBe("voided");
    const lost = createScenario("lost-capability");
    expect(() => act(lost, "reserve")).toThrow("unavailable");
    const restored = act(as(lost, "merchant"), "restore");
    expect(restored.capabilityAvailable).toBe(true);
    expect(act(as(restored, "buyer"), "ready").ready).toBe(true);
    expect(() => act(createScenario("fresh"), "reconcile")).toThrow(
      "already known",
    );
  });

  test("available actions safely reflects guards and role changes clear actor-scoped receipts", () => {
    const review = createScenario("review");
    expect(availableActions(review)).toEqual([
      "verify",
      "dispute",
      "advance-deadline",
      "expire-hold",
      "lose-capability",
      "mark-unknown",
    ]);
    const changed = as({ ...review, filesVerified: true }, "merchant");
    expect(changed).toMatchObject({
      role: "merchant",
      ready: false,
      filesVerified: false,
      phase: "SUBMITTED",
    });
    expect(changed.events.at(-1)?.detail).toContain(
      "does not authenticate a real actor",
    );
    expect(() => changeRole(review, "admin" as Role)).toThrow(
      "unsupported synthetic role",
    );
  });

  test("advances only canonical pending phases without pretending a timer acted", () => {
    expect(
      act(createScenario("lost-capability"), "advance-deadline").phase,
    ).toBe("CANCELLED");
    const reserved = act(
      act(
        act(
          act(act(createScenario("fresh"), "ready"), "verify-recovery"),
          "authorize",
        ),
        "deploy",
      ),
      "reserve",
    );
    expect(act(reserved, "advance-deadline").phase).toBe("CANCELLED");
    expect(
      act(act(as(reserved, "merchant"), "accept"), "advance-deadline").phase,
    ).toBe("CANCELLED");
    expect(act(createScenario("review"), "advance-deadline").phase).toBe(
      "DISPUTED",
    );
    expect(act(createScenario("dispute"), "advance-deadline").phase).toBe(
      "CANCELLED",
    );
    expect(() => act(createScenario("pending"), "advance-deadline")).toThrow(
      "reconciled",
    );
    expect(() =>
      act(act(createScenario("pending"), "reconcile"), "advance-deadline"),
    ).toThrow("no pending deadline");
    expect(() =>
      act(
        { ...createScenario("dispute"), phase: "CANCELLED" as const },
        "advance-deadline",
      ),
    ).toThrow("no pending deadline");
  });
});
