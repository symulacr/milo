import { describe, expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import type { Row } from "./orderProjection.double";
import { settlementDouble } from "./orderProjection.double";
import {
  INBOX_RETENTION_MS,
  inboxDedupeKey,
  MAX_RECONCILE_ATTEMPTS,
  MAX_SWEEP,
  opsForIntent,
  reconcile,
  recordEvent,
  settlementAuthorized,
  settlementIdempotencyKey,
  sweep,
} from "./settlement";

type RecordEventArgs = {
  provider: "stripe";
  accountId: string;
  eventId: string;
  eventType: string;
  digest: string;
  paymentIntentRef: string | null;
};
type ReconcileArgs = {
  provider: "stripe";
  accountId: string;
  eventId: string;
};

const dbDouble = settlementDouble;
type Double = ReturnType<typeof settlementDouble>["ctx"];

const recordEventHandler = (
  recordEvent as unknown as {
    _handler: (
      ctx: Double,
      args: RecordEventArgs,
    ) => Promise<{ isNew: boolean; inboxId: string; digestMatches: boolean }>;
  }
)._handler;
const reconcileHandler = (
  reconcile as unknown as {
    _handler: (ctx: Double, args: ReconcileArgs) => Promise<null>;
  }
)._handler;

/**
 * Pure-policy coverage for the F-21 class: by_intent lookups must tolerate
 * capture+void on one intent (.take(64), never .unique()).
 */
describe("settlementAuthorized phase gates", () => {
  test("capture only from APPROVED", () => {
    expect(settlementAuthorized("capture", "APPROVED")).toBe(true);
    for (const phase of [
      "CANCELLED",
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
    ]) {
      expect(settlementAuthorized("capture", phase)).toBe(false);
    }
  });
  test("void only from CANCELLED", () => {
    expect(settlementAuthorized("void", "CANCELLED")).toBe(true);
    for (const phase of [
      "APPROVED",
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
    ]) {
      expect(settlementAuthorized("void", phase)).toBe(false);
    }
  });
});

describe("settlementIdempotencyKey", () => {
  test("is stable across attempts and unique per (order, action, revision)", () => {
    const a = settlementIdempotencyKey("order-1", "capture", 1);
    const b = settlementIdempotencyKey("order-1", "capture", 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^milo-capture:order-1:1$/);
    expect(settlementIdempotencyKey("order-1", "void", 1)).not.toBe(a);
    expect(settlementIdempotencyKey("order-1", "capture", 2)).not.toBe(a);
    expect(settlementIdempotencyKey("order-2", "capture", 1)).not.toBe(a);
  });
});

describe("opsForIntent — F-21 by_intent .take(64), never .unique()", () => {
  type OpRow = {
    _id: GenericId<"settlementOps">;
    paymentIntentId: GenericId<"paymentIntents">;
    action: "capture" | "void";
    orderId: string;
    contractRevision: number;
    state: string;
    generation: number;
    attempt: number;
  };

  const intent = "pi_1" as GenericId<"paymentIntents">;
  const capture: OpRow = {
    _id: "op_cap" as GenericId<"settlementOps">,
    paymentIntentId: intent,
    action: "capture",
    orderId: "order-1",
    contractRevision: 1,
    state: "pending",
    generation: 1,
    attempt: 0,
  };
  const voidOp: OpRow = {
    _id: "op_void" as GenericId<"settlementOps">,
    paymentIntentId: intent,
    action: "void",
    orderId: "order-1",
    contractRevision: 1,
    state: "pending",
    generation: 1,
    attempt: 0,
  };
  const db = (rows: OpRow[]) =>
    (
      dbDouble({ settlementOps: rows as unknown as Row[] }).ctx as {
        db: unknown;
      }
    ).db as never;

  test("returns capture and void for one intent without throwing", async () => {
    const rows = await opsForIntent(db([capture, voidOp]) as never, intent);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.action).sort()).toEqual(["capture", "void"]);
  });

  test("is empty when the intent has no ops", async () => {
    const rows = await opsForIntent(db([]) as never, intent);
    expect(rows).toEqual([]);
  });

  test("bounds the scan at 64 rows (take(64), not unlimited)", async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      ...capture,
      _id: `op_${i}` as GenericId<"settlementOps">,
    }));
    const rows = await opsForIntent(db(many) as never, intent);
    expect(rows).toHaveLength(64);
    expect(MAX_SWEEP).toBe(16);
  });
});

describe("inbox dedup identity (provider, accountId, eventId)", () => {
  test("first delivery is a new row; duplicate eventId is the same key", () => {
    const first = inboxDedupeKey("stripe", "acct_1", "evt_1");
    const dup = inboxDedupeKey("stripe", "acct_1", "evt_1");
    expect(first).toBe(dup);
  });
  test("same event id under another account is a distinct row", () => {
    expect(inboxDedupeKey("stripe", "acct_1", "evt_1")).not.toBe(
      inboxDedupeKey("stripe", "acct_2", "evt_1"),
    );
  });
  test("provider participates in the identity", () => {
    expect(inboxDedupeKey("stripe", "acct_1", "evt_1")).not.toBe(
      inboxDedupeKey("other", "acct_1", "evt_1"),
    );
  });
});

/**
 * The durable inbox these tests describe moved from the deleted
 * `packages/backend/src/reconciliation.ts` into `convex/settlement.ts`. These
 * are the same guarantees, asserted against the code that now owns them: an
 * event is recorded once per (provider, account, eventId), a processed event is
 * never replayed, and a terminal outcome cannot regress.
 */
describe("recordEvent and reconcile: one row per event, no replay", () => {
  const inboxDouble = (seed: Row[] = []) => dbDouble({ paymentInbox: seed });

  const eventArgs = {
    provider: "stripe" as const,
    accountId: "acct_1",
    eventId: "evt_1",
    eventType: "payment_intent.succeeded",
    digest: "a".repeat(64),
    paymentIntentRef: "pi_1",
  };

  test("the first delivery inserts and reports isNew, the second does not", async () => {
    const f = inboxDouble();
    const first = await recordEventHandler(f.ctx, eventArgs);
    expect(first.isNew).toBe(true);
    expect(f.tables.paymentInbox).toHaveLength(1);
    const second = await recordEventHandler(f.ctx, eventArgs);
    expect(second.isNew).toBe(false);
    expect(second.inboxId).toBe(first.inboxId);
    expect(f.tables.paymentInbox).toHaveLength(1);
  });

  test("the same event id under another account is a separate row", async () => {
    const f = inboxDouble();
    await recordEventHandler(f.ctx, eventArgs);
    const other = await recordEventHandler(f.ctx, {
      ...eventArgs,
      accountId: "acct_2",
    });
    expect(other.isNew).toBe(true);
    expect(f.tables.paymentInbox).toHaveLength(2);
  });

  test("reconcile is a no-op for an unknown or already-processed event", async () => {
    const unknown = inboxDouble();
    await expect(reconcileHandler(unknown.ctx, eventArgs)).resolves.toBeNull();
    expect(unknown.scheduled).toEqual([]);

    const processed = inboxDouble([
      {
        _id: "paymentInbox-1",
        provider: "stripe",
        accountId: "acct_1",
        eventId: "evt_1",
        paymentIntentRef: "pi_1",
        processedAt: 1_000,
      },
    ]);
    await expect(
      reconcileHandler(processed.ctx, eventArgs),
    ).resolves.toBeNull();
    expect(processed.tables.paymentInbox[0].processedAt).toBe(1_000);
    expect(processed.scheduled).toEqual([]);
  });

  test("reconcile re-queues only ops parked in reconciliation", async () => {
    const f = inboxDouble([
      {
        _id: "paymentInbox-1",
        provider: "stripe",
        accountId: "acct_1",
        eventId: "evt_1",
        paymentIntentRef: "pi_1",
        processedAt: undefined,
      },
    ]);
    f.tables.paymentIntents.push({
      _id: "pi-1",
      stripePaymentIntentId: "pi_1",
    });
    f.tables.settlementOps.push(
      {
        _id: "op-recon",
        paymentIntentId: "pi-1",
        state: "reconciliation",
        generation: 1,
        attempt: 0,
      },
      { _id: "op-done", paymentIntentId: "pi-1", state: "complete" },
    );
    await reconcileHandler(f.ctx, eventArgs);
    const byId = (id: string) =>
      f.tables.settlementOps.find((row) => row._id === id);
    expect(byId("op-recon")?.state).toBe("pending");
    expect(byId("op-done")?.state).toBe("complete");
    expect(f.scheduled).toHaveLength(1);
    expect(f.tables.paymentInbox[0].processedAt).toBeGreaterThan(0);
  });
});

// B-02, B-03, B-09, B-10: the sweep is the only recovery path for an op no
// webhook will revisit, and a replay must not accept a different body.
describe("sweep recovery and replay integrity", () => {
  const sweepH = (
    sweep as unknown as { _handler: (c: Double) => Promise<number> }
  )._handler;
  const op = (id: string, state: string, extra = {}) => ({
    _id: id,
    paymentIntentId: "pi-1",
    state,
    generation: 1,
    attempt: 0,
    nextAt: 0,
    ...extra,
  });
  const inbox = (id: string, at: number, done?: number) => ({
    _id: id,
    provider: "stripe",
    accountId: "a",
    eventId: id,
    eventType: "t",
    digest: "a".repeat(64),
    paymentIntentRef: "pi_1",
    receivedAt: at,
    processedAt: done,
  });
  const get = (f: ReturnType<typeof dbDouble>, id: string) =>
    f.tables.settlementOps.find((r) => r._id === id);

  test("B-02 re-queues a parked op, bounded by attempts", async () => {
    const f = dbDouble({
      settlementOps: [
        op("parked", "reconciliation"),
        op("spent", "reconciliation", { attempt: MAX_RECONCILE_ATTEMPTS }),
      ],
    });
    expect(await sweepH(f.ctx)).toBe(1);
    expect(get(f, "parked")).toMatchObject({ state: "pending", attempt: 1 });
    // A parked op that used its budget stays parked, so it stays visible.
    expect(get(f, "spent")?.state).toBe("reconciliation");
  });

  test("B-03 a pending backlog does not starve lease recovery", async () => {
    const f = dbDouble({
      settlementOps: [
        ...Array.from({ length: MAX_SWEEP }, (_, i) => op(`d${i}`, "pending")),
        op("crashed", "running", { startedAt: Date.now() - 10 * 60_000 }),
      ],
    });
    await sweepH(f.ctx);
    expect(get(f, "crashed")).toMatchObject({ state: "pending", attempt: 1 });
  });

  test("B-09 prunes only processed inbox rows past retention", async () => {
    const now = Date.now();
    const old = now - INBOX_RETENTION_MS - 60_000;
    const f = dbDouble({
      paymentInbox: [
        inbox("old", old, old),
        inbox("open", old),
        inbox("new", now, now),
      ],
    });
    await sweepH(f.ctx);
    expect(f.tables.paymentInbox.map((r) => r._id)).toEqual(["open", "new"]);
  });

  test("B-10 a replay with a different body reports a mismatch", async () => {
    const f = dbDouble({ paymentInbox: [] });
    const base = {
      provider: "stripe" as const,
      accountId: "a",
      eventId: "e",
      eventType: "t",
      paymentIntentRef: "pi_1",
    };
    const send = (d: string) =>
      recordEventHandler(f.ctx, { ...base, digest: d });
    expect((await send("a".repeat(64))).digestMatches).toBe(true);
    expect((await send("a".repeat(64))).digestMatches).toBe(true);
    expect(await send("b".repeat(64))).toMatchObject({ digestMatches: false });
    // The stored row keeps the first digest; a mismatch never overwrites it.
    expect(f.tables.paymentInbox[0].digest).toBe("a".repeat(64));
  });
});
