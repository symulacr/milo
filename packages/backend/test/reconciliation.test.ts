import { describe, expect, test } from "bun:test";
import {
  createAttempt,
  emptyReconciliationState,
  markOutcomeUnknown,
  type PaymentEvent,
  type ReconciliationState,
  receivePaymentEvent,
  reconciliationKey,
} from "../src/reconciliation";

const identity = {
  operationId: "capture/order-1/v1",
  operation: "capture" as const,
  orderId: "order-1",
  version: 1,
  idempotencyKey: "key-1",
};
const event = {
  providerEventId: "evt-1",
  ...identity,
  occurredAt: 20,
  status: "captured" as const,
};

describe("payment inbox and reconciliation primitives", () => {
  test("keeps authorize, capture and void identities distinct at the same order version", () => {
    let state = emptyReconciliationState();
    for (const operation of ["authorize", "capture", "void"] as const) {
      state = createAttempt(state, {
        ...identity,
        operation,
        operationId: `${operation}/order-1/v1`,
        idempotencyKey: `${operation}-key`,
      });
    }
    expect(Object.keys(state.attempts)).toHaveLength(3);
  });

  test("rejects invalid runtime states and detaches retained inbox data from caller mutation", () => {
    const state = createAttempt(emptyReconciliationState(), identity);
    for (const status of ["pending", "unknown", "__proto__", "", null]) {
      expect(() =>
        receivePaymentEvent(state, {
          ...event,
          status,
        } as unknown as PaymentEvent),
      ).toThrow();
    }
    expect(() =>
      receivePaymentEvent(state, { ...event, occurredAt: -1 }),
    ).toThrow();
    expect(() =>
      receivePaymentEvent(state, {
        ...event,
        secret: "not permitted",
      } as PaymentEvent),
    ).toThrow();
    const mutable = { ...event };
    const result = receivePaymentEvent(emptyReconciliationState(), mutable);
    mutable.orderId = "different-order";
    expect(result.state.inbox[event.providerEventId]?.event.orderId).toBe(
      "order-1",
    );
  });
  test("keeps immutable operation identity and the original reconciliation key", () => {
    const state = markOutcomeUnknown(
      createAttempt(emptyReconciliationState(), identity),
      identity.idempotencyKey,
    );
    expect(reconciliationKey(state, identity.idempotencyKey)).toBe(
      identity.idempotencyKey,
    );
    expect(createAttempt(state, identity)).toBe(state);
    expect(() =>
      createAttempt(state, { ...identity, idempotencyKey: "new-key" }),
    ).toThrow("original");
    expect(() =>
      createAttempt(state, { ...identity, orderId: "order-2" }),
    ).toThrow("another operation");
    expect(() =>
      createAttempt(state, {
        ...identity,
        operationId: "capture/order-1/retry",
        idempotencyKey: "new-key",
      }),
    ).toThrow("order version");
  });
  test("deduplicates exact payloads, refuses event-id mismatches, and protects terminal outcomes", () => {
    let state = createAttempt(emptyReconciliationState(), identity);
    ({ state } = receivePaymentEvent(state, event));
    expect(receivePaymentEvent(state, event).result).toBe("duplicate");
    expect(() =>
      receivePaymentEvent(state, { ...event, status: "failed" }),
    ).toThrow("payload mismatch");
    expect(
      receivePaymentEvent(state, {
        ...event,
        providerEventId: "evt-2",
        occurredAt: 21,
        status: "voided",
      }).result,
    ).toBe("out-of-order");
    expect(
      receivePaymentEvent(state, {
        ...event,
        providerEventId: "evt-3",
        occurredAt: 20,
        status: "authorized",
      }).result,
    ).toBe("out-of-order");
  });
  test("retains unmatched payloads and applies them after the matching attempt exists", () => {
    const unmatched = receivePaymentEvent(emptyReconciliationState(), event);
    expect(unmatched.result).toBe("unmatched");
    const reconciled = createAttempt(unmatched.state, identity);
    expect(reconciled.attempts[identity.idempotencyKey]?.status).toBe(
      "captured",
    );
    expect(reconciled.inbox[event.providerEventId]?.matched).toBe(true);
  });
  test("does not match an event with a swapped operation or version", () => {
    const unmatched = receivePaymentEvent(emptyReconciliationState(), {
      ...event,
      operationId: "other",
      version: 2,
    });
    const state = createAttempt(unmatched.state, identity);
    expect(state.attempts[identity.idempotencyKey]?.status).toBe("pending");
    expect(state.inbox[event.providerEventId]?.matched).toBe(false);
  });
  test("does not let prototype-like IDs bypass state lookups", () => {
    let state: ReconciliationState = emptyReconciliationState();
    state = createAttempt(state, {
      ...identity,
      operationId: "__proto__",
      idempotencyKey: "constructor",
    });
    const prototypeLikeKey = "constructor";
    expect(state.attempts[prototypeLikeKey]?.status).toBe("pending");
    expect(
      receivePaymentEvent(state, {
        ...event,
        providerEventId: "toString",
        operationId: "__proto__",
        idempotencyKey: "constructor",
      }).result,
    ).toBe("accepted");
  });
});
