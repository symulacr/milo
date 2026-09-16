import { describe, expect, spyOn, test } from "bun:test";
import type Stripe from "stripe";
import * as monitoring from "../../../convex/paymentMonitoring";
import {
  begin,
  finish,
  freezeApprovedQuote,
  requestObservation,
  requestPayment,
} from "../../../convex/provisioning";
import { run as runPaymentWorker } from "../../../convex/stripeProvisioning";
import type {
  FrozenQuote,
  PaymentAuthorization,
} from "../src/admission-policy";
import type { AdmissionContext } from "../src/convex-admission";
import {
  MONITOR_DURATION_MS,
  MONITOR_INTERVAL_MS,
  MONITOR_LEASE_MS,
  type MonitorStatus,
  monitorLive,
  monitorReceiptUsable,
  projectMonitorStatus,
} from "../src/payment-monitor";
import {
  PROVIDER_LEASE_MS,
  PROVIDER_RETRY_WINDOW_MS,
  usableObservation,
} from "../src/provisioning-policy";
import { provisionTestIntent } from "../src/stripe-provisioning.server";

type Row = Record<string, unknown>;

import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../src/public-constructor.mjs";

// Explicit transaction/provider doubles: not hosted OCC or real Stripe evidence.
function fixture() {
  const now = Date.now();
  const quote = {
    constructorVersion: 1 as const,
    constructorEncoding: CONSTRUCTOR_ENCODING,
    buyerCommitment: "1".repeat(64),
    merchantCommitment: "2".repeat(64),
    operatorCommitment: "3".repeat(64),
    termsCommitment: "a".repeat(64),
    _id: "approved",
    _creationTime: now,
    id: "quote",
    scopeId: "scope",
    network: "preprod",
    nonce: "4".repeat(64),
    version: 1,
    amountMinor: 1200,
    currency: "USD",
    imagePackPolicy: {
      serviceVersion: 1,
      packQuantity: 1,
      outputCount: 3,
      unitPriceMinor: 1200,
    },
    buyerAccountId: "buyer",
    ...Object.fromEntries(
      [
        "termsCommitment",
        "artifactFingerprint",
        "keySetFingerprint",
        "rolesFingerprint",
        "initialStateFingerprint",
        "genesisHash",
      ].map((key) => [key, "a".repeat(64)]),
    ),
    acceptanceDeadlineSeconds: Math.floor(now / 1000) + 600,
    deliveryDeadlineSeconds: Math.floor(now / 1000) + 1200,
    reviewDeadlineSeconds: Math.floor(now / 1000) + 1800,
    resolutionDeadlineSeconds: Math.floor(now / 1000) + 2400,
    expiresAt: now + 300_000,
  };
  Object.assign(quote, publicConstructorFingerprints(quote));
  const tables: Record<string, Row[]> = {
    trustedProvisioning: [],
    approvedQuotes: [quote],
    frozenQuotes: [],
    memberships: [
      {
        _id: "member",
        privySubject: "did:privy:buyer",
        accountId: "buyer",
        scopeId: "scope",
        role: "buyer",
        status: "active",
      },
    ],
    stripeCustomers: [
      {
        buyerAccountId: "buyer",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
      },
    ],
    paymentJobs: [],
    paymentMonitors: [],
    paymentIntents: [],
    paymentObservations: [],
  };
  const scheduled: unknown[] = [];
  let identity: { issuer: string; subject: string } | null = {
    issuer: "privy.io",
    subject: "did:privy:buyer",
  };
  let serial = 0;
  const get = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    scheduler: { runAfter: async (...args: unknown[]) => scheduled.push(args) },
    db: {
      get: async (id: string) => get(id),
      query: (table: string) => ({
        withIndex: (
          _index: string,
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
                conditions.every(([key, value]) => row[key] === value),
              );
              if (rows.length > 1) throw new Error("Duplicate rows");
              return rows[0] ?? null;
            },
          };
        },
      }),
      insert: async (table: string, row: Row) => {
        const _id = `${table}-${++serial}`;
        tables[table].push({ ...row, _id, _creationTime: now });
        return _id;
      },
      patch: async (id: string, patch: Row) =>
        Object.assign(get(id) ?? {}, patch),
      delete: async (id: string) => {
        for (const [table, rows] of Object.entries(tables))
          tables[table] = rows.filter((row) => row._id !== id);
      },
    },
  } as unknown as AdmissionContext;
  return {
    ctx,
    tables,
    quote,
    scheduled,
    identity: (value: typeof identity) => {
      identity = value;
    },
  };
}
function handler<T = unknown>(
  fn: unknown,
): (ctx: AdmissionContext, args: Row) => Promise<T> {
  return (fn as { _handler: (ctx: AdmissionContext, args: Row) => Promise<T> })
    ._handler;
}
const request = handler<string>(requestPayment);
const requestRead = handler<string>(requestObservation);
const start = handler(begin);
const complete = handler(finish);
const consent = {
  quoteId: "quote",
  expectedVersion: 1,
  consent: "create-test-payment",
};
async function queued() {
  const db = fixture();
  await freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 });
  const jobId = await request(db.ctx, consent);
  return { ...db, jobId };
}

describe("Trusted provisioning — explicit doubles", () => {
  test("read-only consent requires an existing payment and never schedules creation", async () => {
    const db = fixture();
    await freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 });
    await expect(
      requestRead(db.ctx, {
        ...consent,
        consent: "observe-test-payment",
      }),
    ).rejects.toThrow("Existing immutable payment");
    expect(db.tables.paymentJobs).toHaveLength(0);
    expect(db.scheduled).toHaveLength(0);
  });

  test("explicit observation invalidates prior authorization and fences missing bindings", async () => {
    const db = await queued();
    await start(db.ctx, { jobId: db.jobId, generation: 1 });
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 1,
      stripePaymentIntentId: "pi_test",
    });
    const payment = db.tables.paymentIntents[0];
    db.tables.paymentObservations.push({
      _id: "old",
      paymentIntentId: payment._id,
    });
    expect(
      await requestRead(db.ctx, {
        ...consent,
        consent: "observe-test-payment",
      }),
    ).toBe(db.jobId);
    expect(db.tables.paymentJobs[0].mode).toBe("observe");
    expect(db.tables.paymentJobs[0].generation).toBe(2);
    expect(db.tables.paymentObservations).toHaveLength(0);
    const schedules = db.scheduled.length;
    await requestRead(db.ctx, { ...consent, consent: "observe-test-payment" });
    expect(db.scheduled).toHaveLength(schedules);
    db.tables.paymentIntents.length = 0;
    expect(await start(db.ctx, { jobId: db.jobId, generation: 2 })).toBeNull();
    expect(db.tables.paymentJobs[0].state).toBe("blocked");
  });

  test("observation cannot reuse an active creation job or insert a provider binding", async () => {
    const db = await queued();
    await start(db.ctx, { jobId: db.jobId, generation: 1 });
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 1,
      stripePaymentIntentId: "pi_test",
    });
    db.tables.paymentJobs[0].state = "running";
    await expect(
      requestRead(db.ctx, { ...consent, consent: "observe-test-payment" }),
    ).rejects.toThrow("Creation job");
    db.tables.paymentJobs[0].state = "complete";
    await requestRead(db.ctx, { ...consent, consent: "observe-test-payment" });
    await start(db.ctx, { jobId: db.jobId, generation: 2 });
    await expect(
      complete(db.ctx, {
        jobId: db.jobId,
        generation: 2,
        stripePaymentIntentId: "pi_other",
      }),
    ).rejects.toThrow("Observation jobs cannot create");
    expect(db.tables.paymentIntents).toHaveLength(1);
    expect(db.tables.paymentIntents[0].stripePaymentIntentId).toBe("pi_test");
  });

  test("worker never falls back to creation for an observation snapshot", async () => {
    const calls: unknown[] = [];
    const worker = runPaymentWorker as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<null>;
    };
    const args = { jobId: "job", generation: 2 };
    const result = await worker._handler(
      {
        runMutation: async (_fn: unknown, input: unknown) => {
          calls.push(input);
          return calls.length === 1
            ? { job: { mode: "observe" }, payment: null }
            : null;
        },
      },
      args,
    );
    expect(result).toBeNull();
    expect(calls).toEqual([args, args]);
  });

  test("observation requests retain authentication, buyer and revocation guards", async () => {
    for (const rejected of [
      "anonymous",
      "other-buyer",
      "revoked-member",
      "revoked-quote",
      "revoked-customer",
    ]) {
      const db = await queued();
      await start(db.ctx, { jobId: db.jobId, generation: 1 });
      await complete(db.ctx, {
        jobId: db.jobId,
        generation: 1,
        stripePaymentIntentId: "pi_test",
      });
      if (rejected === "anonymous") db.identity(null);
      if (rejected === "other-buyer")
        db.identity({ issuer: "privy.io", subject: "did:privy:other" });
      if (rejected === "revoked-member")
        db.tables.memberships[0].status = "revoked";
      if (rejected === "revoked-quote")
        db.tables.trustedProvisioning.push({
          kind: "quote",
          key: "quote",
          status: "revoked",
        });
      if (rejected === "revoked-customer")
        db.tables.trustedProvisioning.push({
          kind: "customer",
          key: "buyer",
          status: "revoked",
        });
      await expect(
        requestRead(db.ctx, { ...consent, consent: "observe-test-payment" }),
      ).rejects.toThrow();
      expect(db.tables.paymentJobs[0].generation).toBe(1);
      expect(db.scheduled).toHaveLength(1);
    }
  });

  test("observation rejects mismatched immutable bindings before scheduling", async () => {
    for (const patch of [
      { quoteVersion: 2 },
      { buyerAccountId: "other" },
      { amountMinor: 1 },
      { currency: "EUR" },
      { stripeAccountId: "acct_other" },
      { stripeCustomerId: "cus_other" },
      { environment: "live" },
      { network: "mainnet" },
    ]) {
      const db = await queued();
      await start(db.ctx, { jobId: db.jobId, generation: 1 });
      await complete(db.ctx, {
        jobId: db.jobId,
        generation: 1,
        stripePaymentIntentId: "pi_test",
      });
      Object.assign(db.tables.paymentIntents[0], patch);
      await expect(
        requestRead(db.ctx, { ...consent, consent: "observe-test-payment" }),
      ).rejects.toThrow("Immutable payment binding mismatch");
      expect(db.scheduled).toHaveLength(1);
      expect(db.tables.paymentJobs[0].generation).toBe(1);
    }
  });

  test("rejects non-USD or unsupported approved pack semantics", async () => {
    for (const patch of [
      { currency: "EUR" },
      { currency: "usd" },
      ...[
        { serviceVersion: 2 },
        { packQuantity: 2 },
        { outputCount: 4 },
        { unitPriceMinor: 1199 },
      ].map((value) => ({
        imagePackPolicy: {
          serviceVersion: 1,
          packQuantity: 1,
          outputCount: 3,
          unitPriceMinor: 1200,
          ...value,
        },
      })),
    ]) {
      const db = fixture();
      Object.assign(db.quote, patch);
      await expect(
        freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
      ).rejects.toThrow("image-pack policy");
      expect(db.tables.frozenQuotes).toHaveLength(0);
    }
  });
  test("another active buyer cannot freeze or provision a buyer's quote", async () => {
    const db = fixture();
    db.tables.memberships.push({
      _id: "other-member",
      privySubject: "did:privy:other",
      scopeId: "scope",
      accountId: "other",
      role: "buyer",
      status: "active",
    });
    db.identity({ issuer: "privy.io", subject: "did:privy:other" });
    await expect(
      freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
    ).rejects.toThrow("buyer");
    db.identity({ issuer: "privy.io", subject: "did:privy:buyer" });
    await freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 });
    db.identity({ issuer: "privy.io", subject: "did:privy:other" });
    await expect(request(db.ctx, consent)).rejects.toThrow("buyer");
    expect(db.tables.paymentJobs).toHaveLength(0);
    expect(db.scheduled).toHaveLength(0);
  });
  test("rejects malformed and future durable worker timestamps", async () => {
    for (const field of ["startedAt", "firstAttemptAt"]) {
      for (const value of [NaN, Infinity, -1, 1.5, Date.now() + 300_000]) {
        const db = await queued();
        db.tables.paymentJobs[0][field] = value;
        await expect(request(db.ctx, consent)).rejects.toThrow("clock");
        expect(
          await start(db.ctx, { jobId: db.jobId, generation: 1 }),
        ).toBeNull();
        expect(db.tables.paymentJobs[0].state).toBe("blocked");
      }
    }
  });
  test("concurrent lease claims have one winner under explicitly serialized transaction model", async () => {
    const db = await queued();
    // Models Convex's serializable result, not an implementation or proof of hosted OCC.
    let tail: Promise<unknown> = Promise.resolve();
    const transact = () => {
      const next = tail.then(() =>
        start(db.ctx, { jobId: db.jobId, generation: 1 }),
      );
      tail = next;
      return next;
    };
    const results = await Promise.all(Array.from({ length: 16 }, transact));
    expect(results.filter((value) => value !== null)).toHaveLength(1);
    expect(db.tables.paymentJobs[0].generation).toBe(1);
  });
  test("freezes only authenticated approved exact version, immutable on replay", async () => {
    const db = fixture();
    db.identity(null);
    await expect(
      freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
    ).rejects.toThrow("Privy");
    db.identity({ issuer: "privy.io", subject: "did:privy:buyer" });
    await expect(
      freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 2 }),
    ).rejects.toThrow("version");
    const id = await freezeApprovedQuote(db.ctx, {
      quoteId: "quote",
      expectedVersion: 1,
    });
    expect(
      await freezeApprovedQuote(db.ctx, {
        quoteId: "quote",
        expectedVersion: 1,
      }),
    ).toBe(id);
    db.quote.amountMinor = 1201;
    db.quote.imagePackPolicy.unitPriceMinor = 1201;
    await expect(
      freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
    ).rejects.toThrow("immutable");
    expect(db.tables.frozenQuotes[0].amountMinor).toBe(1200);
  });
  test("freezes public constructor inputs and rejects valid re-encoded role changes on replay", async () => {
    for (const role of [
      "buyerCommitment",
      "merchantCommitment",
      "operatorCommitment",
    ] as const) {
      const db = fixture();
      await freezeApprovedQuote(db.ctx, {
        quoteId: "quote",
        expectedVersion: 1,
      });
      const frozen = structuredClone(db.tables.frozenQuotes);
      db.quote[role] = "7".repeat(64);
      Object.assign(db.quote, publicConstructorFingerprints(db.quote));
      await expect(
        freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
      ).rejects.toThrow("immutable");
      expect(db.tables.frozenQuotes).toEqual(frozen);
    }
  });
  test("legacy or inconsistent public inputs cannot freeze or replay", async () => {
    for (const replay of [false, true]) {
      const db = fixture();
      if (replay)
        await freezeApprovedQuote(db.ctx, {
          quoteId: "quote",
          expectedVersion: 1,
        });
      delete (db.quote as Partial<typeof db.quote>).operatorCommitment;
      const frozen = structuredClone(db.tables.frozenQuotes);
      await expect(
        freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
      ).rejects.toThrow("public constructor");
      expect(db.tables.frozenQuotes).toEqual(frozen);
    }
  });
  test("every persisted constructor scalar is immutable, including encoding policy", async () => {
    for (const key of [
      "constructorVersion",
      "constructorEncoding",
      "network",
      "nonce",
      "termsCommitment",
      "buyerCommitment",
      "merchantCommitment",
      "operatorCommitment",
      "acceptanceDeadlineSeconds",
      "deliveryDeadlineSeconds",
      "reviewDeadlineSeconds",
      "resolutionDeadlineSeconds",
      "artifactFingerprint",
      "keySetFingerprint",
      "rolesFingerprint",
      "initialStateFingerprint",
      "genesisHash",
    ]) {
      const db = fixture();
      await freezeApprovedQuote(db.ctx, {
        quoteId: "quote",
        expectedVersion: 1,
      });
      const frozen = structuredClone(db.tables.frozenQuotes);
      const approved = db.quote as Record<string, unknown>;
      const value = approved[key];
      approved[key] =
        typeof value === "number"
          ? value + 1
          : typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
            ? "7".repeat(64)
            : `${value}x`;
      if (
        ![
          "constructorVersion",
          "constructorEncoding",
          "network",
          "rolesFingerprint",
          "initialStateFingerprint",
        ].includes(key)
      )
        Object.assign(db.quote, publicConstructorFingerprints(db.quote));
      await expect(
        freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
      ).rejects.toThrow();
      expect(db.tables.frozenQuotes).toEqual(frozen);
    }
  });
  test("rejects revoked buyers, duplicate catalog, invalid approved money and deadlines", async () => {
    for (const mutate of [
      (db: ReturnType<typeof fixture>) => {
        db.tables.memberships[0].status = "revoked";
      },
      (db: ReturnType<typeof fixture>) => {
        db.tables.approvedQuotes.push({ ...db.quote });
      },
      (db: ReturnType<typeof fixture>) => {
        db.quote.amountMinor = 0.5;
      },
      (db: ReturnType<typeof fixture>) => {
        db.quote.deliveryDeadlineSeconds = db.quote.acceptanceDeadlineSeconds;
      },
    ]) {
      const db = fixture();
      mutate(db);
      await expect(
        freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 }),
      ).rejects.toThrow();
      expect(db.tables.frozenQuotes).toHaveLength(0);
    }
  });
  test("duplicate requests and duplicate workers share a single immutable job", async () => {
    const db = await queued();
    expect(await request(db.ctx, consent)).toBe(db.jobId);
    expect(db.scheduled).toHaveLength(1);
    expect(
      await start(db.ctx, { jobId: db.jobId, generation: 1 }),
    ).not.toBeNull();
    expect(await start(db.ctx, { jobId: db.jobId, generation: 1 })).toBeNull();
    db.tables.stripeCustomers[0].stripeCustomerId = "cus_other";
    await expect(request(db.ctx, consent)).rejects.toThrow(
      "Immutable customer",
    );
  });
  test("revocation before worker and idempotency expiry fail closed", async () => {
    const revoked = await queued();
    revoked.tables.memberships[0].status = "revoked";
    expect(
      await start(revoked.ctx, { jobId: revoked.jobId, generation: 1 }),
    ).toBeNull();
    const expired = await queued();
    expired.tables.paymentJobs[0].firstAttemptAt =
      Date.now() - PROVIDER_RETRY_WINDOW_MS;
    expect(
      await start(expired.ctx, { jobId: expired.jobId, generation: 1 }),
    ).toBeNull();
    expect(expired.tables.paymentJobs[0].state).toBe("blocked");
  });
  test("superseded worker cannot bind; valid provider binding cannot be replayed to another quote", async () => {
    const db = await queued();
    await start(db.ctx, { jobId: db.jobId, generation: 1 });
    db.tables.paymentJobs[0].startedAt = Date.now() - PROVIDER_LEASE_MS;
    db.tables.paymentJobs[0].firstAttemptAt =
      db.tables.paymentJobs[0].startedAt;
    await request(db.ctx, consent);
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 1,
      stripePaymentIntentId: "pi_old",
    });
    expect(db.tables.paymentIntents).toHaveLength(0);
    await start(db.ctx, { jobId: db.jobId, generation: 2 });
    db.tables.paymentIntents.push({
      _id: "other",
      quoteId: "other-quote",
      stripePaymentIntentId: "pi_replay",
    });
    await expect(
      complete(db.ctx, {
        jobId: db.jobId,
        generation: 2,
        stripePaymentIntentId: "pi_replay",
      }),
    ).rejects.toThrow("replay");
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 2,
      stripePaymentIntentId: "pi_new",
    });
    expect(
      db.tables.paymentIntents.find((row) => row.quoteId === "quote"),
    ).toMatchObject({
      amountMinor: 1200,
      currency: "USD",
      environment: "test",
      network: "preprod",
    });
    expect(db.tables.paymentObservations).toHaveLength(0);
  });
  test("refresh invalidates previous authorization even when provider is unavailable", async () => {
    const db = await queued();
    await start(db.ctx, { jobId: db.jobId, generation: 1 });
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 1,
      stripePaymentIntentId: "pi_test",
    });
    const payment = db.tables.paymentIntents[0];
    db.tables.paymentObservations.push({
      _id: "observation",
      paymentIntentId: payment._id,
      authorization: { status: "authorized" },
    });
    await request(db.ctx, consent);
    expect(db.tables.paymentObservations).toHaveLength(0);
    await start(db.ctx, { jobId: db.jobId, generation: 2 });
    await complete(db.ctx, { jobId: db.jobId, generation: 2 });
    expect(db.tables.paymentJobs[0].state).toBe("blocked");
  });
  test("existing intents remain reconcilable after acceptance and creation retry deadlines", async () => {
    const db = await queued();
    await start(db.ctx, { jobId: db.jobId, generation: 1 });
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 1,
      stripePaymentIntentId: "pi_test",
    });
    db.tables.frozenQuotes[0].acceptanceDeadlineSeconds =
      Math.floor(Date.now() / 1000) - 1;
    db.tables.paymentJobs[0].firstAttemptAt =
      Date.now() - PROVIDER_RETRY_WINDOW_MS;
    await request(db.ctx, consent);
    expect(
      await start(db.ctx, { jobId: db.jobId, generation: 2 }),
    ).not.toBeNull();
    const expired = await queued();
    expired.tables.frozenQuotes[0].acceptanceDeadlineSeconds =
      Math.floor(Date.now() / 1000) - 1;
    await expect(request(expired.ctx, consent)).rejects.toThrow("expired");
  });
  test("trusted observation must match binding and current generation clock", async () => {
    const db = await queued();
    await start(db.ctx, { jobId: db.jobId, generation: 1 });
    await complete(db.ctx, {
      jobId: db.jobId,
      generation: 1,
      stripePaymentIntentId: "pi_test",
    });
    await requestRead(db.ctx, { ...consent, consent: "observe-test-payment" });
    await start(db.ctx, { jobId: db.jobId, generation: 2 });
    const now = Date.now();
    const authorization = {
      id: db.tables.paymentIntents[0]._id,
      quoteId: "quote",
      quoteVersion: 1,
      buyerAccountId: "buyer",
      amountMinor: 1200,
      currency: "USD",
      usableFrom: now,
      usableUntil: now + 60_000,
      captureBeforeMs: now + 600_000,
      source: "payment-observer",
      status: "authorized",
      providerReceiptFingerprint: "a".repeat(64),
    };
    for (const patch of [
      { amountMinor: 1 },
      { id: "other" },
      { usableFrom: now - 60_001 },
      { usableFrom: now + 60_001 },
      { usableUntil: now + 60_001 },
      { usableFrom: NaN },
      { usableFrom: Infinity },
      { usableFrom: now + 0.5 },
      { usableUntil: NaN },
      { usableUntil: Infinity },
      { usableUntil: now + 0.5 },
    ]) {
      await expect(
        complete(db.ctx, {
          jobId: db.jobId,
          generation: 2,
          authorization: { ...authorization, ...patch },
        }),
      ).rejects.toThrow("observation");
    }
    await complete(db.ctx, { jobId: db.jobId, generation: 2, authorization });
    expect(db.tables.paymentObservations).toHaveLength(1);
    await complete(db.ctx, { jobId: db.jobId, generation: 2, authorization });
    expect(db.tables.paymentObservations).toHaveLength(1);
    expect(
      usableObservation(
        authorization as PaymentAuthorization,
        now + 60_000,
        now,
      ),
    ).toBe(false);
  });
  test("official SDK boundary uses stable idempotency, exact trusted money and never confirms", async () => {
    const db = await queued();
    const calls: unknown[][] = [];
    const stripe = {
      accounts: { retrieveCurrent: async () => ({ id: "acct_test" }) },
      customers: {
        retrieve: async () => ({ id: "cus_test", livemode: false }),
      },
      paymentIntents: {
        create: async (params: Row, options: Row) => {
          calls.push([params, options]);
          return {
            ...params,
            id: "pi_test",
            livemode: false,
            status: "requires_payment_method",
            latest_charge: null,
            amount_received: 0,
            amount_capturable: 0,
          };
        },
      },
    } as unknown as Stripe;
    const args = {
      jobId: db.jobId,
      firstAttemptAt: Date.now(),
      quote: db.tables.frozenQuotes[0] as unknown as FrozenQuote,
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
    };
    expect(await provisionTestIntent(args, stripe)).toBe("pi_test");
    expect(await provisionTestIntent(args, stripe)).toBe("pi_test");
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0][0]).toMatchObject({
      amount: 1200,
      currency: "usd",
      capture_method: "manual",
      confirm: false,
      payment_method_types: ["card"],
    });
    expect(calls[0][1]).toEqual({
      idempotencyKey: `milo-test-intent:${db.jobId}`,
    });
    await expect(
      provisionTestIntent({ ...args, stripeAccountId: "acct_other" }, stripe),
    ).rejects.toThrow("account mismatch");
    await expect(
      provisionTestIntent(
        { ...args, firstAttemptAt: Date.now() - PROVIDER_RETRY_WINDOW_MS },
        stripe,
      ),
    ).rejects.toThrow("retry window");
    expect(calls).toHaveLength(2);
  });
  test("live/deleted customers cannot reach intent creation and corrupt provider money cannot bind", async () => {
    const db = await queued();
    let creates = 0;
    let customer: Row = { id: "cus_test", livemode: true };
    const stripe = {
      accounts: { retrieveCurrent: async () => ({ id: "acct_test" }) },
      customers: { retrieve: async () => customer },
      paymentIntents: {
        create: async (params: Row) => {
          creates++;
          return {
            ...params,
            amount: 1,
            id: "pi_test",
            livemode: false,
            status: "requires_payment_method",
            latest_charge: null,
          };
        },
      },
    } as unknown as Stripe;
    const args = {
      jobId: db.jobId,
      firstAttemptAt: Date.now(),
      quote: db.tables.frozenQuotes[0] as unknown as FrozenQuote,
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
    };
    await expect(provisionTestIntent(args, stripe)).rejects.toThrow(
      "Test customer",
    );
    customer = { id: "cus_test", deleted: true };
    await expect(provisionTestIntent(args, stripe)).rejects.toThrow(
      "Test customer",
    );
    expect(creates).toBe(0);
    customer = { id: "cus_test", livemode: false };
    await expect(provisionTestIntent(args, stripe)).rejects.toThrow(
      "binding mismatch",
    );
    expect(creates).toBe(1);
  });
});

const monitorStart = handler<string>(monitoring.start);
const monitorTick = handler(monitoring.tick);
const monitorBegin = handler(monitoring.begin);
const monitorFinish = handler(monitoring.finish);
const monitorStop = handler(monitoring.stop);
const monitorStatus = handler<MonitorStatus>(monitoring.status);
async function monitored() {
  const db = await queued();
  await start(db.ctx, { jobId: db.jobId, generation: 1 });
  await complete(db.ctx, {
    jobId: db.jobId,
    generation: 1,
    stripePaymentIntentId: "pi_test",
  });
  const monitorId = await monitorStart(db.ctx, {
    ...consent,
    consent: "monitor-test-payment",
  });
  const fence = { monitorId, generation: 1, attempt: 0 };
  const auth = () => ({
    id: db.tables.paymentIntents[0]._id,
    quoteId: "quote",
    quoteVersion: 1,
    buyerAccountId: "buyer",
    amountMinor: 1200,
    currency: "USD",
    usableFrom: Date.now(),
    usableUntil: Date.now() + 60_000,
    captureBeforeMs: Date.now() + 600_000,
    source: "payment-observer",
    status: "authorized",
    providerReceiptFingerprint: "a".repeat(64),
  });
  return { ...db, fence, auth };
}

describe("bounded read-only monitoring — transaction doubles", () => {
  test("status is a minimal read-only projection, never a payment authorization", async () => {
    const db = await monitored();
    const expiresAt = db.tables.paymentMonitors[0].expiresAt as number;
    const before = JSON.stringify([db.tables, db.scheduled]);
    expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
      state: "waiting",
      expiresAt,
      canStop: true,
      quoteVersion: 1,
      canStart: false,
    });
    expect(JSON.stringify([db.tables, db.scheduled])).toBe(before);
    await monitorTick(db.ctx, db.fence);
    expect((await monitorStatus(db.ctx, { quoteId: "quote" })).state).toBe(
      "running",
    );
    // DEBT-011/C-B-09: finish requires begin's claim; drive the real flow.
    await monitorBegin(db.ctx, { ...db.fence, attempt: 1 });
    await monitorFinish(db.ctx, {
      ...db.fence,
      attempt: 1,
      authorization: db.auth(),
    });
    expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
      state: "waiting",
      expiresAt,
      canStop: true,
      quoteVersion: 1,
      canStart: false,
    });
    db.tables.paymentObservations[0].authorization = {
      status: "authorized",
      usableUntil: 0,
    };
    expect(
      Object.keys(await monitorStatus(db.ctx, { quoteId: "quote" })).sort(),
    ).toEqual(["canStart", "canStop", "expiresAt", "quoteVersion", "state"]);
  });

  test("finish refuses an unclaimed attempt without completing it (DEBT-011 / C-B-09)", async () => {
    const db = await monitored();
    await monitorTick(db.ctx, db.fence);
    expect((await monitorStatus(db.ctx, { quoteId: "quote" })).state).toBe(
      "running",
    );
    const observations = db.tables.paymentObservations.length;
    expect(
      await monitorFinish(db.ctx, {
        ...db.fence,
        attempt: 1,
        authorization: db.auth(),
      }),
    ).toBeNull();
    expect(db.tables.paymentObservations).toHaveLength(observations);
    expect(db.tables.paymentMonitors[0].state).toBe("running");
  });

  test("status allows a buyer without a payment, but denies strangers and missing auth", async () => {
    const db = await queued();
    expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
      state: "none",
      expiresAt: null,
      canStop: false,
      quoteVersion: null,
      canStart: false,
    });
    db.identity({ issuer: "privy.io", subject: "did:privy:stranger" });
    await expect(monitorStatus(db.ctx, { quoteId: "quote" })).rejects.toThrow(
      "quote buyer",
    );
    db.identity(null);
    await expect(monitorStatus(db.ctx, { quoteId: "quote" })).rejects.toThrow(
      "Privy",
    );
  });

  test("non-owner buyers can inspect but cannot withdraw another subject's consent", async () => {
    const db = await monitored();
    db.tables.memberships.push({
      ...db.tables.memberships[0],
      _id: "other",
      privySubject: "did:privy:other",
    });
    db.identity({ issuer: "privy.io", subject: "did:privy:other" });
    expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
      state: "waiting",
      expiresAt: db.tables.paymentMonitors[0].expiresAt as number,
      canStop: false,
      quoteVersion: 1,
      canStart: false,
    });
    await expect(monitorStop(db.ctx, { quoteId: "quote" })).rejects.toThrow(
      "consent owner",
    );
    db.tables.trustedProvisioning.push({
      kind: "membership",
      key: JSON.stringify(["did:privy:other", "scope"]),
      status: "revoked",
    });
    await expect(monitorStatus(db.ctx, { quoteId: "quote" })).rejects.toThrow(
      "quote buyer",
    );
  });

  for (const change of [
    "membership",
    "quote",
    "customer",
    "binding",
  ] as const) {
    test(`status fails closed after ${change} changes while owner can still withdraw`, async () => {
      const db = await monitored();
      if (change === "membership") db.tables.memberships[0].status = "revoked";
      else if (change === "binding") db.tables.frozenQuotes[0].version = 2;
      else
        db.tables.trustedProvisioning.push({
          kind: change,
          key: change === "quote" ? "quote" : "buyer",
          status: "revoked",
        });
      expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
        state: "unavailable",
        expiresAt: db.tables.paymentMonitors[0].expiresAt as number,
        canStop: true,
        quoteVersion: null,
        canStart: false,
      });
      db.identity({ issuer: "privy.io", subject: "did:privy:stranger" });
      await expect(monitorStatus(db.ctx, { quoteId: "quote" })).rejects.toThrow(
        "quote buyer",
      );
      db.identity({ issuer: "privy.io", subject: "did:privy:buyer" });
      await monitorStop(db.ctx, { quoteId: "quote" });
      expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
        state: "stopped",
        expiresAt: db.tables.paymentMonitors[0].expiresAt as number,
        canStop: false,
        quoteVersion: null,
        canStart: false,
      });
    });
  }

  test("status expires at the exact boundary without scheduler cleanup", async () => {
    const db = await monitored();
    const expiresAt = db.tables.paymentMonitors[0].expiresAt as number;
    const clock = spyOn(Date, "now").mockReturnValue(expiresAt);
    try {
      expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
        state: "expired",
        expiresAt,
        canStop: true,
        quoteVersion: 1,
        canStart: true,
      });
      expect(db.tables.paymentMonitors[0].state).toBe("waiting");
      await monitorStop(db.ctx, { quoteId: "quote" });
      expect((await monitorStatus(db.ctx, { quoteId: "quote" })).canStop).toBe(
        false,
      );
    } finally {
      clock.mockRestore();
    }
  });

  test("start readiness respects existing sessions, competing jobs and mutation version checks", async () => {
    const db = await monitored();
    await monitorStop(db.ctx, { quoteId: "quote" });
    expect((await monitorStatus(db.ctx, { quoteId: "quote" })).canStart).toBe(
      true,
    );
    for (const state of ["queued", "running"]) {
      db.tables.paymentJobs[0].state = state;
      expect((await monitorStatus(db.ctx, { quoteId: "quote" })).canStart).toBe(
        false,
      );
    }
    db.tables.paymentJobs[0].state = "complete";
    const ready = await monitorStatus(db.ctx, { quoteId: "quote" });
    expect(ready.canStart).toBe(true);
    await expect(
      monitorStart(db.ctx, {
        quoteId: "quote",
        expectedVersion: 2,
        consent: "monitor-test-payment",
      }),
    ).rejects.toThrow("quote buyer");
    await monitorStart(db.ctx, {
      quoteId: "quote",
      expectedVersion: ready.quoteVersion,
      consent: "monitor-test-payment",
    });
    expect((await monitorStatus(db.ctx, { quoteId: "quote" })).canStart).toBe(
      false,
    );
    db.tables.paymentMonitors = [];
    expect(await monitorStatus(db.ctx, { quoteId: "quote" })).toEqual({
      state: "none",
      expiresAt: null,
      canStop: false,
      quoteVersion: 1,
      canStart: true,
    });
  });

  test("pure status projection rejects invalid and future clocks and invalid lifetimes", () => {
    const session = {
      state: "waiting" as const,
      consentAt: 1000,
      expiresAt: 1000 + MONITOR_DURATION_MS,
    };
    for (const now of [NaN, Infinity, -1, 999, 1000.5])
      expect(projectMonitorStatus(session, true, true, now).state).toBe(
        "unavailable",
      );
    expect(
      projectMonitorStatus(
        { ...session, expiresAt: Infinity },
        true,
        true,
        1000,
      ),
    ).toEqual({ state: "unavailable", expiresAt: null, canStop: true });
  });

  test("requires existing payment, buyer, and no creation lease takeover", async () => {
    const db = await queued();
    await expect(monitorStart(db.ctx, consent)).rejects.toThrow(
      "Active immutable payment",
    );
    db.tables.paymentIntents.push({
      _id: "payment",
      quoteId: "quote",
      quoteVersion: 1,
      buyerAccountId: "buyer",
      amountMinor: 1200,
      currency: "USD",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripePaymentIntentId: "pi_test",
      environment: "test",
      network: "preprod",
    });
    db.tables.paymentJobs[0].startedAt = 0;
    await expect(monitorStart(db.ctx, consent)).rejects.toThrow(
      "Payment job must finish",
    );
    db.tables.paymentJobs[0].state = "complete";
    db.tables.memberships[0].role = "merchant";
    await expect(monitorStart(db.ctx, consent)).rejects.toThrow("quote buyer");
    await monitorStop(db.ctx, { quoteId: "quote" });
    expect(db.tables.paymentMonitors).toHaveLength(0);
  });

  test("only the consenting subject can stop, even after revocation; stopping is idempotent", async () => {
    const db = await monitored();
    await monitorTick(db.ctx, db.fence);
    const active = { ...db.fence, attempt: 1 };
    await monitorBegin(db.ctx, active);
    db.identity({ issuer: "privy.io", subject: "did:privy:other" });
    await expect(monitorStop(db.ctx, { quoteId: "quote" })).rejects.toThrow(
      "consent owner",
    );
    expect(db.tables.paymentMonitors[0].state).toBe("running");
    db.identity({ issuer: "privy.io", subject: "did:privy:buyer" });
    db.tables.memberships[0].status = "revoked";
    await monitorStop(db.ctx, { quoteId: "quote" });
    const generation = db.tables.paymentMonitors[0].generation;
    await monitorStop(db.ctx, { quoteId: "quote" });
    expect(db.tables.paymentMonitors[0].generation).toBe(generation);
    await monitorFinish(db.ctx, { ...active, authorization: db.auth() });
    expect(db.tables.paymentMonitors[0].state).toBe("stopped");
    expect(db.tables.paymentObservations).toHaveLength(0);
    db.identity(null);
    await expect(monitorStop(db.ctx, { quoteId: "quote" })).rejects.toThrow();
  });

  test("duplicates cannot renew consent or perform duplicate reads; refresh clears auth before I/O", async () => {
    const db = await monitored();
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      await expect(monitorStart(db.ctx, consent)).rejects.toThrow(
        "Stop existing",
      );
      await expect(requestRead(db.ctx, consent)).rejects.toThrow(
        "Stop monitoring",
      );
      await monitorTick(db.ctx, db.fence);
      const active = { ...db.fence, attempt: 1 };
      expect(await monitorBegin(db.ctx, active)).not.toBeNull();
      expect(await monitorBegin(db.ctx, active)).toBeNull();
      await monitorTick(db.ctx, db.fence);
      expect(db.tables.paymentMonitors[0].attempt).toBe(1);
      await monitorFinish(db.ctx, { ...active, authorization: db.auth() });
      expect(db.tables.paymentObservations).toHaveLength(1);
      await monitorFinish(db.ctx, active);
      expect(db.tables.paymentObservations).toHaveLength(1);
      now += MONITOR_INTERVAL_MS;
      await monitorTick(db.ctx, active);
      expect(db.tables.paymentObservations).toHaveLength(0);
      await monitorBegin(db.ctx, { ...active, attempt: 2 });
      await monitorFinish(db.ctx, { ...active, attempt: 2 });
      expect(db.tables.paymentObservations).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
  });

  test("watchdog recovers only bounded stalled read attempts and rejects stale completion", async () => {
    const db = await monitored();
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      await monitorTick(db.ctx, db.fence);
      const old = { ...db.fence, attempt: 1 };
      await monitorBegin(db.ctx, old);
      now += MONITOR_LEASE_MS;
      await monitorTick(db.ctx, old);
      expect(db.tables.paymentMonitors[0].attempt).toBe(2);
      await monitorFinish(db.ctx, { ...old, authorization: db.auth() });
      expect(db.tables.paymentObservations).toHaveLength(0);
      now = Number(db.tables.paymentMonitors[0].expiresAt);
      await monitorTick(db.ctx, { ...old, attempt: 2 });
      expect(db.tables.paymentMonitors[0].state).toBe("stopped");
      expect(await monitorBegin(db.ctx, { ...old, attempt: 2 })).toBeNull();
      expect(db.tables.paymentJobs[0].generation).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  test("stop and restart fence old callbacks and clear usable auth", async () => {
    const db = await monitored();
    await monitorTick(db.ctx, db.fence);
    const active = { ...db.fence, attempt: 1 };
    await monitorBegin(db.ctx, active);
    await monitorFinish(db.ctx, { ...active, authorization: db.auth() });
    await monitorStop(db.ctx, { quoteId: "quote" });
    expect(db.tables.paymentObservations).toHaveLength(0);
    await monitorStart(db.ctx, consent);
    await monitorTick(db.ctx, active);
    await monitorFinish(db.ctx, { ...active, authorization: db.auth() });
    expect(db.tables.paymentMonitors[0].generation).toBe(3);
    expect(db.tables.paymentMonitors[0].attempt).toBe(0);
    expect(db.tables.paymentObservations).toHaveLength(0);
  });

  for (const change of [
    "membership",
    "customer",
    "quote",
    "revocation",
  ] as const) {
    test(`${change} changes invalidate receipts and post-I/O results`, async () => {
      const db = await monitored();
      await monitorTick(db.ctx, db.fence);
      const active = { ...db.fence, attempt: 1 };
      await monitorBegin(db.ctx, active);
      if (change === "membership") db.tables.memberships[0].status = "revoked";
      if (change === "customer")
        db.tables.stripeCustomers[0].stripeCustomerId = "cus_other";
      if (change === "quote") db.tables.frozenQuotes[0].version = 2;
      if (change === "revocation")
        db.tables.trustedProvisioning.push({
          kind: "membership",
          key: JSON.stringify(["did:privy:buyer", "scope"]),
          status: "revoked",
        });
      expect(
        await monitorReceiptUsable(
          db.ctx,
          active.monitorId as never,
          1,
          Date.now(),
        ),
      ).toBe(false);
      await monitorFinish(db.ctx, { ...active, authorization: db.auth() });
      expect(db.tables.paymentMonitors[0].state).toBe("stopped");
      expect(db.tables.paymentObservations).toHaveLength(0);
    });
  }

  test("expiry fences admission even before scheduler cleanup and late cleanup preserves one-shot results", async () => {
    const db = await monitored();
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      await monitorTick(db.ctx, db.fence);
      const active = { ...db.fence, attempt: 1 };
      await monitorBegin(db.ctx, active);
      await monitorFinish(db.ctx, { ...active, authorization: db.auth() });
      expect(
        await monitorReceiptUsable(db.ctx, active.monitorId as never, 1, now),
      ).toBe(true);
      now = Number(db.tables.paymentMonitors[0].expiresAt);
      expect(
        await monitorReceiptUsable(db.ctx, active.monitorId as never, 1, now),
      ).toBe(false);
      await requestRead(db.ctx, consent);
      // A later independently consented one-shot receipt is not owned by the old monitor.
      db.tables.paymentObservations.push({
        _id: "later",
        paymentIntentId: db.tables.paymentIntents[0]._id,
        authorization: db.auth(),
      });
      await monitorTick(db.ctx, active);
      await monitorStop(db.ctx, { quoteId: "quote" });
      expect(db.tables.paymentObservations[0]._id).toBe("later");
    } finally {
      clock.mockRestore();
    }
  });

  test("revocation before worker claim prevents a read and expiry during I/O prevents publication", async () => {
    const db = await monitored();
    await monitorTick(db.ctx, db.fence);
    db.tables.memberships[0].status = "revoked";
    expect(await monitorBegin(db.ctx, { ...db.fence, attempt: 1 })).toBeNull();
    expect(db.tables.paymentMonitors[0].state).toBe("stopped");
    db.tables.memberships[0].status = "active";
    await monitorStart(db.ctx, consent);
    const next = { ...db.fence, generation: 2 };
    await monitorTick(db.ctx, next);
    await monitorBegin(db.ctx, { ...next, attempt: 1 });
    const clock = spyOn(Date, "now").mockReturnValue(
      Number(db.tables.paymentMonitors[0].expiresAt),
    );
    try {
      await monitorFinish(db.ctx, {
        ...next,
        attempt: 1,
        authorization: db.auth(),
      });
      expect(db.tables.paymentObservations).toHaveLength(0);
      expect(db.tables.paymentMonitors[0].state).toBe("stopped");
    } finally {
      clock.mockRestore();
    }
  });

  test("hard expiry and invalid clocks fail closed", () => {
    const session = {
      state: "waiting",
      consentAt: 1000,
      expiresAt: 1000 + MONITOR_DURATION_MS,
    };
    expect(monitorLive(session, 1000)).toBe(true);
    for (const now of [999, NaN, Infinity, session.expiresAt])
      expect(monitorLive(session, now)).toBe(false);
    expect(
      monitorLive({ ...session, expiresAt: session.expiresAt + 1 }, 1001),
    ).toBe(false);
    expect(monitorLive({ ...session, state: "stopped" }, 1001)).toBe(false);
  });
});
