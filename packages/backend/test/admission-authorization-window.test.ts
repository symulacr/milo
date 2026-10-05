import { describe, expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import type { AdmissionContext } from "../../../convex/admissionContext";
import { admitCanonical } from "../../../convex/canonicalAdmission";
import {
  type ChainObservationInput,
  type ChainOrderTruth,
  decideObservationBinding,
  PAYMENT_AUTHORIZATION_WINDOW_MS,
  REQUIRED_ENTRYPOINTS,
} from "../src/admission-policy";
import { buildQuote } from "./fixtures";

// The Convex adapter re-checks the payment-authorization window itself before
// it hands anything to the pure policy, using the same shared constant. These
// cases pin that adapter-level staleness gate, which is adjacent to (and
// upstream of) admission-policy validate() without duplicating it.
function databaseDouble() {
  const now = Date.now();
  const hash = "a".repeat(64);
  const quote = buildQuote({
    _id: "quote-row",
    acceptanceDeadlineSeconds: Math.floor(now / 1000) + 60,
    deliveryDeadlineSeconds: Math.floor(now / 1000) + 120,
    reviewDeadlineSeconds: Math.floor(now / 1000) + 180,
    resolutionDeadlineSeconds: Math.floor(now / 1000) + 240,
  });
  const payment = {
    _id: "payment-1",
    quoteId: quote.id,
    quoteVersion: 1,
    buyerAccountId: "buyer-1",
    stripeAccountId: "acct_test",
    stripeCustomerId: "cus_test",
    stripePaymentIntentId: "pi_test",
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    environment: "test",
    network: "preprod",
  };
  const authorization = {
    id: payment._id,
    quoteId: quote.id,
    quoteVersion: 1,
    buyerAccountId: quote.buyerAccountId,
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    usableFrom: now,
    usableUntil: now + PAYMENT_AUTHORIZATION_WINDOW_MS - 1000,
    captureBeforeMs: now + 600_000,
    source: "payment-observer",
    status: "authorized",
    providerReceiptFingerprint: hash,
  };
  const observation = {
    ...quote,
    _id: "observation-row",
    id: "observation-1",
    quoteId: quote.id,
    quoteVersion: 1,
    observationVersion: 2,
    source: "chain-observer",
    address: "1".repeat(64),
    phase: "DEPLOYED",
    revision: 0,
    entrypoints: [...REQUIRED_ENTRYPOINTS],
    maintenancePolicy: "locked",
    maintenanceReceiptFingerprint: hash,
    blockHash: hash,
    blockHeight: 32,
    stateFingerprint: hash,
    observedAt: now,
  };
  const membership = {
    _id: "member-1",
    privySubject: "did:privy:buyer",
    accountId: quote.buyerAccountId,
    scopeId: quote.scopeId,
    role: "buyer",
    status: "active",
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    trustedProvisioning: [],
    frozenQuotes: [quote],
    memberships: [membership],
    stripeCustomers: [
      {
        _id: "customer-row",
        buyerAccountId: "buyer-1",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
      },
    ],
    paymentIntents: [payment],
    paymentObservations: [
      { _id: "current-payment", paymentIntentId: payment._id, authorization },
    ],
    paymentMonitors: [],
    deploymentObservations: [observation],
    admissionTimingPolicies: [
      { network: "preprod", captureSafetyMarginMs: 1000 },
    ],
    canonicalBindings: [],
  };
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        issuer: "privy.io",
        subject: "did:privy:buyer",
      }),
    },
    db: {
      get: async (id: string) =>
        tables.paymentIntents.find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (
          index: string,
          range: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const conditions: [string, unknown][] = [];
          const q = {
            eq: (field: string, value: unknown) => {
              conditions.push([field, value]);
              return q;
            },
          };
          range(q);
          return {
            unique: async () => {
              const rows = tables[table].filter((row) =>
                conditions.every(([field, value]) => row[field] === value),
              );
              if (rows.length > 1)
                throw new Error(`Duplicate ${table}.${index}`);
              return rows[0] ?? null;
            },
          };
        },
      }),
      insert: async (table: string, row: Record<string, unknown>) => {
        tables[table].push({ ...row, _id: "binding-row", _creationTime: now });
        return "binding-row";
      },
    },
  } as unknown as AdmissionContext;
  const input = {
    quoteId: quote.id,
    expectedQuoteVersion: 1,
    observationId: observation.id,
    authorizationId: payment._id as GenericId<"paymentIntents">,
    address: observation.address,
  };
  const setAuthorization = (patch: Record<string, unknown>) =>
    Object.assign(
      tables.paymentObservations[0].authorization as Record<string, unknown>,
      patch,
    );
  return { ctx, input, tables, authorization, setAuthorization };
}

const staleReason = "current payment observation is stale or mismatched";

describe("canonical admission payment-authorization staleness gate", () => {
  test("the window constant is the shared one minute, not a per-file copy", () => {
    expect(PAYMENT_AUTHORIZATION_WINDOW_MS).toBe(60_000);
  });

  test("a fresh authorization inside the window is admitted", async () => {
    const db = databaseDouble();
    expect(await admitCanonical(db.ctx, db.input)).toMatchObject({
      kind: "bound",
    });
    expect(db.tables.canonicalBindings).toHaveLength(1);
  });

  test("an authorization whose usableFrom is a full window old is stale", async () => {
    const db = databaseDouble();
    db.setAuthorization({
      usableFrom: Date.now() - PAYMENT_AUTHORIZATION_WINDOW_MS,
    });
    expect(await admitCanonical(db.ctx, db.input)).toEqual({
      kind: "rejected",
      reason: staleReason,
    });
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });

  test("an authorization observed a few seconds ago is still fresh", async () => {
    const now = Date.now();
    const usableFrom = now - 5_000;
    const db = databaseDouble();
    db.setAuthorization({
      usableFrom,
      usableUntil: usableFrom + PAYMENT_AUTHORIZATION_WINDOW_MS,
      captureBeforeMs: now + 600_000,
    });
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("bound");
  });

  test("a window wider than the constant is refused even when it is fresh", async () => {
    const now = Date.now();
    for (const width of [
      PAYMENT_AUTHORIZATION_WINDOW_MS + 1,
      PAYMENT_AUTHORIZATION_WINDOW_MS * 2,
    ]) {
      const db = databaseDouble();
      db.setAuthorization({
        usableFrom: now,
        usableUntil: now + width,
        captureBeforeMs: now + 600_000,
      });
      expect(await admitCanonical(db.ctx, db.input)).toEqual({
        kind: "rejected",
        reason: staleReason,
      });
      expect(db.tables.canonicalBindings).toHaveLength(0);
    }
  });

  test("a window exactly the constant wide is accepted", async () => {
    const now = Date.now();
    const db = databaseDouble();
    db.setAuthorization({
      usableFrom: now,
      usableUntil: now + PAYMENT_AUTHORIZATION_WINDOW_MS,
      captureBeforeMs: now + 600_000,
    });
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("bound");
  });

  test("an authorization that does not carry the current payment's own id is refused", async () => {
    const db = databaseDouble();
    db.setAuthorization({ id: "payment-other" });
    expect(await admitCanonical(db.ctx, db.input)).toEqual({
      kind: "rejected",
      reason: staleReason,
    });
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });

  test("the stale gate is read from the current payment observation, not a caller claim", async () => {
    const db = databaseDouble();
    db.setAuthorization({
      usableFrom: Date.now() - PAYMENT_AUTHORIZATION_WINDOW_MS,
    });
    db.tables.paymentObservations = [];
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("rejected");
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });

  test("no stale or mismatched authorization can ever write a binding", async () => {
    const now = Date.now();
    for (const patch of [
      { id: "payment-other" },
      { usableFrom: now - PAYMENT_AUTHORIZATION_WINDOW_MS },
      { usableUntil: now + PAYMENT_AUTHORIZATION_WINDOW_MS + 1 },
      { usableFrom: now, usableUntil: now + 120_000 },
      { usableUntil: now - 1 },
      { captureBeforeMs: 0 },
      { status: "voided" },
      { status: "pending" },
      { status: "captured" },
      { source: "caller-claim" },
    ]) {
      const db = databaseDouble();
      db.setAuthorization(patch);
      const result = await admitCanonical(db.ctx, db.input);
      expect(result.kind).toBe("rejected");
      expect(db.tables.canonicalBindings).toHaveLength(0);
    }
  });
});
const current: ChainOrderTruth = {
  orderId: "order-1",
  address: "1".repeat(64),
  nonce: "nonce-1",
  artifactFingerprint: "b".repeat(64),
  phase: "ACCEPTED",
  revision: 3,
};
const observed: ChainObservationInput = {
  orderId: current.orderId,
  address: current.address,
  nonce: current.nonce,
  artifactFingerprint: current.artifactFingerprint,
  phase: "ACCEPTED",
  revision: 3,
};

describe("chain observation binding verdicts", () => {
  test("no admitted order is contradictory, and a null owner does not change that", () => {
    for (const missing of [null, undefined]) {
      expect(decideObservationBinding(missing, observed)).toEqual({
        kind: "contradictory",
        reason: "observation does not match the admitted order",
      });
      expect(
        decideObservationBinding(missing, observed, { orderId: "order-other" }),
      ).toEqual({
        kind: "contradictory",
        reason: "observation does not match the admitted order",
      });
    }
  });

  test("an address owned by a third order is refused before identity is checked", () => {
    expect(
      decideObservationBinding(current, observed, { orderId: "order-third" }),
    ).toEqual({
      kind: "address-claimed",
      reason: "the observed address is already bound to a different order",
    });
  });

  test("an address owned by this order, or by the order being observed, is not a conflict", () => {
    expect(
      decideObservationBinding(current, observed, {
        orderId: current.orderId,
      }),
    ).toEqual({ kind: "bind", phase: "ACCEPTED", revision: 3 });
    expect(
      decideObservationBinding(current, observed, {
        orderId: observed.orderId,
      }),
    ).toEqual({ kind: "bind", phase: "ACCEPTED", revision: 3 });
    expect(decideObservationBinding(current, observed, null)).toEqual({
      kind: "bind",
      phase: "ACCEPTED",
      revision: 3,
    });
  });

  for (const [field, value] of [
    ["orderId", "order-other"],
    ["address", "2".repeat(64)],
    ["nonce", "nonce-other"],
  ] as const) {
    test(`a mismatched ${field} is contradictory`, () => {
      expect(
        decideObservationBinding(current, { ...observed, [field]: value }),
      ).toEqual({
        kind: "contradictory",
        reason: "observation does not match the admitted order",
      });
    });
  }

  test("an artifact fingerprint that does not reproduce is refused by name", () => {
    expect(
      decideObservationBinding(current, {
        ...observed,
        artifactFingerprint: "c".repeat(64),
      }),
    ).toEqual({
      kind: "contradictory",
      reason:
        "observation does not reproduce the admitted artifact fingerprint",
    });
  });

  test("a revision behind the recorded one is stale, never a bind", () => {
    for (const revision of [0, 1, 2]) {
      expect(
        decideObservationBinding(current, { ...observed, revision }),
      ).toEqual({
        kind: "stale",
        reason: "chain observation is behind the recorded revision",
      });
    }
  });

  test("an equal revision binds only when the phase agrees", () => {
    expect(decideObservationBinding(current, observed)).toEqual({
      kind: "bind",
      phase: "ACCEPTED",
      revision: 3,
    });
    for (const phase of ["SUBMITTED", "TERMINAL", "DISPUTED"]) {
      expect(decideObservationBinding(current, { ...observed, phase })).toEqual(
        {
          kind: "contradictory",
          reason: "observation does not match the admitted order",
        },
      );
    }
  });

  test("a higher revision binds and adopts the observed phase", () => {
    expect(
      decideObservationBinding(current, {
        ...observed,
        revision: 4,
        phase: "SUBMITTED",
      }),
    ).toEqual({ kind: "bind", phase: "SUBMITTED", revision: 4 });
  });
});
