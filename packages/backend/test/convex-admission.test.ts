import { describe, expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import type { AdmissionContext } from "../../../convex/admissionContext";
import { admitCanonical } from "../../../convex/canonicalAdmission";
import {
  MONITOR_DURATION_MS,
  type MonitorQueryContext,
  monitorBinding,
} from "../../../convex/paymentMonitor";
import { REQUIRED_ENTRYPOINTS } from "../src/admission-policy";
import { buildQuote } from "./fixtures";

// Explicit DB double: verifies adapter reads/writes, not Convex transaction/OCC behavior.
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
    usableFrom: now - 1000,
    usableUntil: now + 59000,
    captureBeforeMs: now + 600000,
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
  const reads: string[] = [];
  let beforeInsert = async () => {};
  let identity: { issuer: string; subject: string } | null = {
    issuer: "privy.io",
    subject: "did:privy:buyer",
  };
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    db: {
      get: async (id: string) =>
        tables.paymentIntents.find((row) => row._id === id) ??
        tables.paymentMonitors.find((row) => row._id === id) ??
        null,
      query: (table: string) => ({
        withIndex: (
          index: string,
          range: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          reads.push(`${table}.${index}`);
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
        await beforeInsert();
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
  return {
    ctx,
    input,
    tables,
    reads,
    quote,
    payment,
    authorization,
    observation,
    membership,
    setIdentity: (value: typeof identity) => {
      identity = value;
    },
    onInsert: (fn: () => Promise<void>) => {
      beforeInsert = fn;
    },
    // Snapshots the binding through the real monitorBinding read path so the
    // gate compares exactly what production recomputes at admission time.
    withMonitor: async (
      sessionPatch: Record<string, unknown> = {},
      monitorGeneration = 3,
    ) => {
      const current = await monitorBinding(
        ctx as unknown as MonitorQueryContext,
        quote.id,
        "did:privy:buyer",
      );
      if (!current) throw new Error("double must yield a monitor binding");
      tables.paymentMonitors.push({
        _id: "mon-1",
        quoteId: quote.id,
        paymentIntentId: payment._id,
        consentSubject: "did:privy:buyer",
        binding: current.binding,
        generation: 3,
        attempt: 0,
        consentAt: now - 1000,
        expiresAt: now - 1000 + MONITOR_DURATION_MS,
        nextAt: now,
        startedAt: now - 1000,
        state: "waiting",
        ...sessionPatch,
      });
      tables.paymentObservations[0].monitorId = "mon-1";
      tables.paymentObservations[0].monitorGeneration = monitorGeneration;
    },
  };
}

describe("Convex admission adapter — explicit DB double, not hosted OCC evidence", () => {
  for (const kind of ["quote", "customer"] as const) {
    test(`${kind} revocation also rejects an already-bound admission retry`, async () => {
      const db = databaseDouble();
      expect((await admitCanonical(db.ctx, db.input)).kind).toBe("bound");
      db.tables.trustedProvisioning.push({
        kind,
        key: kind === "quote" ? db.quote.id : db.quote.buyerAccountId,
        status: "revoked",
      });
      await expect(admitCanonical(db.ctx, db.input)).rejects.toThrow("revoked");
      expect(db.tables.canonicalBindings).toHaveLength(1);
    });
  }
  test("reads every canonical uniqueness index and returns a clean idempotent binding", async () => {
    const db = databaseDouble();
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("bound");
    expect(db.reads).toEqual(
      expect.arrayContaining([
        "canonicalBindings.by_network_nonce",
        "canonicalBindings.by_address",
        "canonicalBindings.by_quote",
        "paymentObservations.by_payment_intent",
        "paymentIntents.by_quote",
        "paymentIntents.by_provider_intent",
      ]),
    );
    const result = await admitCanonical(db.ctx, db.input);
    expect(result.kind).toBe("already-bound");
    expect(db.tables.canonicalBindings).toHaveLength(1);
    if (result.kind !== "rejected")
      expect(Object.keys(result.binding)).not.toContain("_id");
  });
  test("awaits insertion and propagates database write failure", async () => {
    const db = databaseDouble();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.onInsert(() => blocked);
    let done = false;
    const work = admitCanonical(db.ctx, db.input).then((result) => {
      done = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);
    release();
    expect((await work).kind).toBe("bound");
    const failed = databaseDouble();
    failed.onInsert(async () => {
      throw new Error("write failed");
    });
    await expect(admitCanonical(failed.ctx, failed.input)).rejects.toThrow(
      "write failed",
    );
    expect(failed.tables.canonicalBindings).toHaveLength(0);
  });
  test("current payment state is reread, including after a previously successful binding", async () => {
    const db = databaseDouble();
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("bound");
    db.authorization.status = "voided";
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("rejected");
  });
  test("a changed quote version fails the race guard", async () => {
    const db = databaseDouble();
    db.quote.version++;
    expect(await admitCanonical(db.ctx, db.input)).toEqual({
      kind: "rejected",
      reason: "frozen quote version changed",
    });
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });
  test("provider intent reuse on a different quote fails its independent index", async () => {
    const db = databaseDouble();
    db.tables.paymentIntents.push({
      ...db.payment,
      _id: "other-payment",
      quoteId: "other-quote",
    });
    await expect(admitCanonical(db.ctx, db.input)).rejects.toThrow(
      "Duplicate paymentIntents.by_provider_intent",
    );
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });
  for (const index of ["nonce", "address", "quoteId"] as const) {
    test(`a competing binding seen on retry conflicts by ${index} (no race simulation)`, async () => {
      const db = databaseDouble();
      db.tables.canonicalBindings.push({
        network: "preprod",
        nonce: "other",
        address: "2".repeat(64),
        quoteId: "other",
        observationId: "other",
        authorizationId: "other",
        boundAt: 1,
        [index]:
          index === "nonce"
            ? db.quote.nonce
            : index === "address"
              ? db.input.address
              : db.quote.id,
      });
      expect((await admitCanonical(db.ctx, db.input)).kind).toBe("rejected");
      expect(db.tables.canonicalBindings).toHaveLength(1);
    });
  }
  for (const table of [
    "frozenQuotes",
    "memberships",
    "deploymentObservations",
    "paymentIntents",
    "paymentObservations",
    "admissionTimingPolicies",
    "canonicalBindings",
  ]) {
    test(`duplicate ${table} index rows fail closed`, async () => {
      const db = databaseDouble();
      if (table === "canonicalBindings") await admitCanonical(db.ctx, db.input);
      db.tables[table].push({ ...db.tables[table][0] });
      await expect(admitCanonical(db.ctx, db.input)).rejects.toThrow(
        "Duplicate",
      );
    });
  }
  for (const change of [
    (db: ReturnType<typeof databaseDouble>) => {
      db.observation.quoteVersion++;
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.observation.quoteId = "other";
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.authorization.usableFrom -= 60001;
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.authorization.usableUntil += 1;
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.authorization.id = "other";
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.payment.quoteVersion++;
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.tables.paymentObservations = [];
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.tables.admissionTimingPolicies = [];
    },
  ]) {
    test("rejects mismatched provenance, stale/current payment, or missing server policy", async () => {
      const db = databaseDouble();
      change(db);
      expect((await admitCanonical(db.ctx, db.input)).kind).toBe("rejected");
      expect(db.tables.canonicalBindings).toHaveLength(0);
    });
  }
  for (const change of [
    (db: ReturnType<typeof databaseDouble>) => {
      db.setIdentity(null);
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.membership.status = "revoked";
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.membership.role = "merchant";
    },
    (db: ReturnType<typeof databaseDouble>) => {
      db.membership.accountId = "other";
    },
  ]) {
    test("requires verified identity and current active buyer membership", async () => {
      const db = databaseDouble();
      change(db);
      await expect(admitCanonical(db.ctx, db.input)).rejects.toThrow();
      expect(db.tables.canonicalBindings).toHaveLength(0);
    });
  }
});

describe("monitored receipt gate (DEBT-021 / C-B-14)", () => {
  const monitorRejected = {
    kind: "rejected",
    reason: "active payment monitoring consent required",
  } as const;
  test("usable monitored receipt admits and binds", async () => {
    const db = databaseDouble();
    await db.withMonitor();
    expect((await admitCanonical(db.ctx, db.input)).kind).toBe("bound");
    expect(db.tables.canonicalBindings).toHaveLength(1);
  });
  test("stopped monitor session rejects the receipt", async () => {
    const db = databaseDouble();
    await db.withMonitor({ state: "stopped" });
    expect(await admitCanonical(db.ctx, db.input)).toEqual(monitorRejected);
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });
  test("superseded monitor generation rejects the receipt", async () => {
    const db = databaseDouble();
    await db.withMonitor({}, 99);
    expect(await admitCanonical(db.ctx, db.input)).toEqual(monitorRejected);
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });
  test("revoked authority changes the binding and rejects the receipt", async () => {
    const db = databaseDouble();
    await db.withMonitor();
    db.tables.trustedProvisioning.push({
      kind: "membership",
      key: JSON.stringify(["did:privy:buyer", db.quote.scopeId]),
      status: "revoked",
    });
    expect(await admitCanonical(db.ctx, db.input)).toEqual(monitorRejected);
    expect(db.tables.canonicalBindings).toHaveLength(0);
  });
});
