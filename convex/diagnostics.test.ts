import { describe, expect, test } from "bun:test";
import { RELEASE_FLAG_DEFAULTS } from "../packages/backend/src/release-flags";
import { operatorConfig } from "../packages/backend/src/session-identity";
import {
  byIntentRows,
  DIAGNOSTICS_BY_INTENT_LIMIT,
  DIGEST_WINDOW_MS,
  deadLetterCounts,
  digest,
  INBOX_REAP_DAYS,
  pruneExpiredContent,
  RETENTION_DAYS,
  read,
  reapPaymentInbox,
} from "./diagnostics";
import type { Row } from "./orderProjection.double";
import {
  readSurface,
  settlementDouble,
  writeSurface,
} from "./orderProjection.double";

// The diagnostics read is session-gated, and `requireSessionSubject` compares
// the identity's issuer against the deployment's own. Declare it here.
process.env.CONVEX_SITE_URL ??= "privy.io";

/**
 * F-21 same class at diagnostics.ts: by_intent must use .take(64),
 * never .unique(), so one intent with capture+void does not crash reads.
 */
describe("diagnostics by_intent (F-21 class)", () => {
  type Row = {
    _id: string;
    paymentIntentId: string;
    action: "capture" | "void";
    state: string;
    generation: number;
    attempt: number;
  };

  const db = (rows: Row[]) =>
    settlementDouble({ settlementOps: rows as never }).ctx.db as never;

  const intent = "pi_1";
  const capture: Row = {
    _id: "op_cap",
    paymentIntentId: intent,
    action: "capture",
    state: "pending",
    generation: 1,
    attempt: 0,
  };
  const voidOp: Row = {
    _id: "op_void",
    paymentIntentId: intent,
    action: "void",
    state: "reconciliation",
    generation: 1,
    attempt: 2,
  };

  test("lists capture+void for one intent without throwing", async () => {
    const rows = await byIntentRows(db([capture, voidOp]) as never, intent);
    expect(rows).toHaveLength(2);
    expect(DIAGNOSTICS_BY_INTENT_LIMIT).toBe(64);
  });

  test("projects redacted fields only (no secrets / raw payloads)", async () => {
    const rows = await byIntentRows(db([capture]) as never, intent);
    expect(rows[0]).toEqual({
      id: "op_cap",
      action: "capture",
      state: "pending",
      generation: 1,
      attempt: 0,
    });
  });
});

/**
 * ROUND 18 item 7 — the daily dead-letter digest.
 *
 * Stripe retries a live delivery for up to 3 days but a sandbox delivery only 3
 * times, so a silently dropped event is the normal failure mode. The digest is
 * the only thing that tells an operator about it. Two properties matter and both
 * are cheap to break: it must no-op when no operator is configured, and it must
 * stay silent when there is nothing wrong (a daily "all clear" trains an operator
 * to ignore the one that matters).
 */
describe("ROUND18 item 7: the operator digest", () => {
  const inbox = (rows: Array<Record<string, unknown>>) =>
    ({
      db: {
        query: () => ({
          withIndex: (_i: string, range: (q: never) => unknown) => {
            const q = { gt: () => q };
            (range as unknown as (x: unknown) => void)(q);
            return { take: async (n: number) => rows.slice(0, n) };
          },
        }),
      },
    }) as never;

  const counts = async (rows: Array<Record<string, unknown>>) => {
    const handler = (
      deadLetterCounts as unknown as {
        _handler: (
          ctx: never,
          args: Record<string, never>,
        ) => Promise<{
          unprocessed: number;
          recent: number;
          byType: Array<{ eventType: string; count: number }>;
        }>;
      }
    )._handler;
    return handler(inbox(rows), {});
  };

  test("counts only unprocessed rows, grouped by type", async () => {
    const now = Date.now();
    const out = await counts([
      { eventType: "payment_intent.succeeded", receivedAt: now },
      { eventType: "payment_intent.succeeded", receivedAt: now },
      { eventType: "charge.refunded", receivedAt: now },
      { eventType: "charge.expired", receivedAt: now, processedAt: now },
    ]);
    expect(out.unprocessed).toBe(3);
    expect(out.recent).toBe(4);
    expect(out.byType).toEqual([
      { eventType: "payment_intent.succeeded", count: 2 },
      { eventType: "charge.refunded", count: 1 },
    ]);
  });

  test("an empty inbox is zero, not an error", async () => {
    expect(await counts([])).toEqual({ unprocessed: 0, recent: 0, byType: [] });
  });

  test("the window is a day plus slack", () => {
    // 25 h: a cron that fires a few minutes late still covers the full previous
    // day and does not double-count the boundary.
    expect(DIGEST_WINDOW_MS).toBe(25 * 60 * 60_000);
  });

  test("the cron is registered daily, off the top of the hour", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./crons.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('crons.daily(\n  "operator digest"');
    // `minuteUTC` is omitted so Convex spreads the run; pinning :00 is the
    // documented busiest moment.
    expect(source).not.toMatch(/hourUTC: 7,\s*minuteUTC/);
  });
});

/**
 * R23 I-10: unprocessed inbox rows are reaped, not kept forever.
 */
describe("R23 I-10: the dead-letter queue has a reaping half", () => {
  const ctxFor = (tables: Record<string, Row[]>) =>
    ({ db: { ...readSurface(tables), ...writeSurface(tables) } }) as never;

  const row = (over: Record<string, unknown> = {}): Row => ({
    _id: "i1",
    provider: "stripe",
    accountId: "acct",
    eventId: "evt_1",
    eventType: "payment_intent.succeeded",
    digest: "d",
    paymentIntentRef: null,
    receivedAt: Date.now() - (INBOX_REAP_DAYS + 1) * 24 * 60 * 60_000,
    ...over,
  });

  const reap = async (tables: Record<string, Row[]>) =>
    (
      reapPaymentInbox as unknown as {
        _handler: (c: never, a: Record<string, never>) => Promise<unknown>;
      }
    )._handler(ctxFor(tables), {});

  test("a stale unprocessed row is removed", async () => {
    const tables = { paymentInbox: [row()] };
    expect(await reap(tables)).toEqual({ removed: 1 });
    expect(tables.paymentInbox).toHaveLength(0);
  });

  test("a recent row is kept", async () => {
    const tables = { paymentInbox: [row({ receivedAt: Date.now() })] };
    expect(await reap(tables)).toEqual({ removed: 0 });
    expect(tables.paymentInbox).toHaveLength(1);
  });

  test("a stale row that DID process is never reaped here", async () => {
    // `settlement.ts` owns processed rows; deleting one here could lose a late
    // reconcile.
    const tables = { paymentInbox: [row({ processedAt: Date.now() })] };
    expect(await reap(tables)).toEqual({ removed: 0 });
    expect(tables.paymentInbox).toHaveLength(1);
  });

  test("the cron is registered daily", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./crons.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"reap unprocessed payment inbox"');
    expect(source).toContain("diagnostics:reapPaymentInbox");
  });
});

/**
 * R23 H-06: a digest that cannot be delivered must not look like a clean run.
 */
describe("R23 H-06: the digest distinguishes its two skips", () => {
  const run = async (recipients: string | undefined, unprocessed: number) => {
    const previous = process.env.MILO_OPERATOR_EMAILS;
    if (recipients === undefined) delete process.env.MILO_OPERATOR_EMAILS;
    else process.env.MILO_OPERATOR_EMAILS = recipients;
    const warned: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) =>
      warned.push(args.map(String).join(" "));
    try {
      const out = await (
        digest as unknown as {
          _handler: (
            c: never,
            a: Record<string, never>,
          ) => Promise<{ skipped: string | null; emailed: number }>;
        }
      )._handler(
        {
          runQuery: async () => ({
            unprocessed,
            recent: unprocessed,
            byType: [],
          }),
        } as never,
        {},
      );
      return { out, warned };
    } finally {
      console.warn = realWarn;
      if (previous === undefined) delete process.env.MILO_OPERATOR_EMAILS;
      else process.env.MILO_OPERATOR_EMAILS = previous;
    }
  };

  test("no operator configured is reported and logged, not silent", async () => {
    const { out, warned } = await run(undefined, 5);
    expect(out.skipped).toBe("no-operator");
    expect(out.emailed).toBe(0);
    expect(warned.join("\n")).toContain("digest-skipped");
    expect(warned.join("\n")).toContain("no-operator");
    // The count is in the log, so the operator can see the size of the gap.
    expect(warned.join("\n")).toContain("5");
  });

  test("nothing to report is a distinct, quiet skip", async () => {
    const { out, warned } = await run("ops@studio.example", 0);
    expect(out.skipped).toBe("clean");
    expect(warned).toEqual([]);
  });
});

/**
 * R22 I-04: the privacy page promises "Order brief and delivered files: 90 days
 * after the order ends". Nothing enforced it. This pins the enforcement and,
 * just as importantly, what it does NOT delete.
 */
describe("R22 I-04: retention is enforced, not just promised", () => {
  const ctxFor = (tables: Record<string, Row[]>) =>
    ({
      db: { ...readSurface(tables), ...writeSurface(tables) },
    }) as never;

  const chain = (over: Record<string, unknown> = {}): Row => ({
    _id: "c1",
    orderId: "order-1",
    quoteId: "quote-1",
    terminal: true,
    observedAt: Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60_000,
    phase: "APPROVED",
    ...over,
  });

  const draft = (): Row => ({
    _id: "d1",
    id: "quote-1",
    brief: "A short brief for the fixed-price image pack.",
    title: "Three hero images",
    clientEmail: "buyer@example.com",
    amountMinor: 90_000,
    currency: "USD",
    updatedAt: 1,
  });

  const delivery = (): Row => ({
    _id: "del1",
    orderId: "order-1",
    merchantId: "merchant-1",
    revision: 1,
    files: [{ grantId: "g", storageId: "s", sha256: "a".repeat(64) }],
    manifest: "m",
  });

  const prune = async (tables: Record<string, Row[]>) =>
    (
      pruneExpiredContent as unknown as {
        _handler: (c: never, a: Record<string, never>) => Promise<unknown>;
      }
    )._handler(ctxFor(tables), {});

  test("a terminal order past the window is redacted, not deleted", async () => {
    const tables = {
      chainOrders: [chain()],
      quoteDrafts: [draft()],
      deliveries: [delivery()],
    };
    expect(await prune(tables)).toEqual({ quotes: 1, deliveries: 1 });
    // The personal content is gone.
    expect(tables.quoteDrafts[0].brief).toBe("");
    expect(tables.quoteDrafts[0].clientEmail).toBe("");
    expect(tables.deliveries[0].files).toEqual([]);
    // The money record survives, because the page promises 7 years for tax.
    expect(tables.quoteDrafts[0].amountMinor).toBe(90_000);
    expect(tables.quoteDrafts).toHaveLength(1);
  });

  test("an order inside the window is untouched", async () => {
    const tables = {
      chainOrders: [chain({ observedAt: Date.now() - 24 * 60 * 60_000 })],
      quoteDrafts: [draft()],
      deliveries: [delivery()],
    };
    expect(await prune(tables)).toEqual({ quotes: 0, deliveries: 0 });
    expect(tables.quoteDrafts[0].brief).not.toBe("");
    expect(tables.deliveries[0].files).toHaveLength(1);
  });

  test("a non-terminal order is never touched, however old", async () => {
    const tables = {
      chainOrders: [chain({ terminal: false })],
      quoteDrafts: [draft()],
      deliveries: [delivery()],
    };
    expect(await prune(tables)).toEqual({ quotes: 0, deliveries: 0 });
    expect(tables.quoteDrafts[0].brief).not.toBe("");
  });

  test("an order with no observedAt is not provably ended, so it is left alone", async () => {
    const tables = {
      chainOrders: [chain({ observedAt: undefined })],
      quoteDrafts: [draft()],
      deliveries: [delivery()],
    };
    expect(await prune(tables)).toEqual({ quotes: 0, deliveries: 0 });
  });

  test("the cron is registered daily", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./crons.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"prune expired order content"');
    expect(source).toContain("diagnostics:pruneExpiredContent");
  });
});

/**
 * R22 I-07: the session must actually end. `updateAge` made `expiresIn` a
 * rolling window, so an active session renewed forever and the privacy page's
 * "7 days, then you sign in again" was false.
 */
describe("R22 I-07: the session lifetime is absolute, not rolling", () => {
  test("session refresh is disabled so expiresIn is an absolute lifetime", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./auth.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("disableSessionRefresh: true");
    // `updateAge` is what made it rolling; it must not be back.
    expect(source).not.toMatch(/updateAge:\s*60 \* 60 \* 24\b/);
  });
});

/**
 * ROUND 19 — the diagnostics read reports which mail provider is active.
 *
 * The selection logic itself is tested in `magic-link.test.ts`; what this pins
 * is that the read *exposes* it, and that it exposes names only. This query is
 * reachable from the app, so a key value here would be a disclosure.
 */
describe("ROUND19: diagnostics exposes the mail provider by name only", () => {
  const readMail = async () => {
    const handler = (
      read as unknown as {
        _handler: (
          ctx: never,
          args: Record<string, never>,
        ) => Promise<{ mail: Record<string, unknown> }>;
      }
    )._handler;
    const ctx = {
      auth: {
        getUserIdentity: async () => ({
          issuer: process.env.CONVEX_SITE_URL ?? "privy.io",
          subject: "did:privy:buyer",
        }),
      },
      db: { query: () => ({ withIndex: () => ({ take: async () => [] }) }) },
    } as never;
    return (await handler(ctx, {})).mail;
  };

  const withEnv = async (
    vars: Record<string, string | undefined>,
    run: () => Promise<void>,
  ) => {
    const previous = Object.fromEntries(
      Object.keys(vars).map((k) => [k, process.env[k]]),
    );
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await run();
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  test.each([
    ["resend", "RESEND_API_KEY"],
    ["agentmail", "AGENTMAIL_API_KEY"],
    ["brevo", "BREVO_API_KEY"],
  ])("%s reports its own key variable, never its value", async (p, keyEnv) => {
    await withEnv(
      { MAIL_PROVIDER: p, [keyEnv]: "secret-value-xyz" },
      async () => {
        const mail = await readMail();
        expect(mail).toMatchObject({ provider: p, keyEnv, keyPresent: true });
        expect(JSON.stringify(mail)).not.toContain("secret-value-xyz");
      },
    );
  });

  test("the default provider is resend with its key absent", async () => {
    await withEnv(
      { MAIL_PROVIDER: undefined, RESEND_API_KEY: undefined },
      async () => {
        expect(await readMail()).toMatchObject({
          provider: "resend",
          keyEnv: "RESEND_API_KEY",
          keyPresent: false,
        });
      },
    );
  });
});

/**
 * R35 (b): one source for "is an operator configured?".
 *
 * Three call sites answered it three ways: the digest tested
 * `recipients.length === 0`, `isOperator` tested `operatorEmails().length === 0`,
 * and `diagnostics.read` answered nothing at all — so a deployment with no
 * `MILO_OPERATOR_EMAILS` looked healthy from the API and only failed when a real
 * dispute needed resolving. These tests pin that all three now agree, and that
 * the disagreement is impossible because they read the same function.
 */
describe("R35 (b): operatorConfig is the single source for operator presence", () => {
  const withOperatorEnv = async (
    value: string | undefined,
    run: () => Promise<void> | void,
  ) => {
    const previous = process.env.MILO_OPERATOR_EMAILS;
    if (value === undefined) delete process.env.MILO_OPERATOR_EMAILS;
    else process.env.MILO_OPERATOR_EMAILS = value;
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.MILO_OPERATOR_EMAILS;
      else process.env.MILO_OPERATOR_EMAILS = previous;
    }
  };

  test("an unset allowlist reports configured: false with a zero count", async () => {
    await withOperatorEnv(undefined, async () => {
      expect(operatorConfig()).toEqual({ configured: false, count: 0 });
    });
  });

  test("a set allowlist reports configured: true and counts the entries", async () => {
    await withOperatorEnv("a@example.com, b@example.com", async () => {
      expect(operatorConfig()).toEqual({ configured: true, count: 2 });
    });
  });

  test("a blank allowlist counts as unconfigured, not as one empty operator", async () => {
    // `operatorEmails()` filters empties, so " , " must not read as configured.
    await withOperatorEnv(" , ", async () => {
      expect(operatorConfig()).toEqual({ configured: false, count: 0 });
    });
  });

  test("diagnostics.read exposes the operator fact as a count, never an address", async () => {
    await withOperatorEnv("secret-operator@example.com", async () => {
      const handler = (
        read as unknown as {
          _handler: (
            ctx: never,
            args: Record<string, never>,
          ) => Promise<{ operator: { configured: boolean; count: number } }>;
        }
      )._handler;
      const ctx = {
        auth: {
          getUserIdentity: async () => ({
            issuer: process.env.CONVEX_SITE_URL ?? "privy.io",
            subject: "did:privy:buyer",
          }),
        },
        db: { query: () => ({ withIndex: () => ({ take: async () => [] }) }) },
      } as never;
      const out = await handler(ctx, {});
      expect(out.operator).toEqual({ configured: true, count: 1 });
      // The address itself is never part of the payload.
      expect(JSON.stringify(out)).not.toContain("secret-operator@example.com");
    });
  });

  test("the digest, isOperator and the read all call operatorConfig", async () => {
    // A source assertion, because the point is the *wiring*: three independent
    // re-derivations of the same fact is the defect this removes. Deleting any
    // one of these call sites must fail this test.
    const { readFile } = await import("node:fs/promises");
    const diagnostics = await readFile(
      new URL("./diagnostics.ts", import.meta.url),
      "utf8",
    );
    const auth = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
    expect(diagnostics).toContain("operatorConfig().configured");
    expect(diagnostics).toContain("operator: operatorConfig()");
    expect(auth).toContain("operatorConfig().configured");
    // And the old re-derivations are gone.
    expect(auth).not.toContain("operatorEmails().length === 0");
    expect(diagnostics).not.toContain("recipients.length === 0");
  });

  test("an unconfigured deployment warns once, not once per call", async () => {
    await withOperatorEnv(undefined, async () => {
      const warned: string[] = [];
      const realWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warned.push(args.map(String).join(" "));
      };
      try {
        // The module-level latch is already set by an earlier test in this file,
        // so reset it the only way a caller can: reload the module.
        const fresh = await import(
          `../packages/backend/src/session-identity.ts?warn=${Date.now()}`
        );
        fresh.warnIfNoOperator();
        fresh.warnIfNoOperator();
        fresh.warnIfNoOperator();
        expect(
          warned.filter((w) => w.includes("operator-unconfigured")),
        ).toHaveLength(1);
        // The message names the consequence, not just the variable.
        expect(warned.join("\n")).toContain("MILO_OPERATOR_EMAILS");
      } finally {
        console.warn = realWarn;
      }
    });
  });
});

/**
 * R35 (c): the release flags are an observation, not a constant.
 *
 * `releaseFlags()` shipped with a test and no caller: ten integration fixtures
 * hardcoded both flags to `false`, so the module could not have changed a
 * decision. The read now derives them from the stored `canonicalBindings` and
 * `chainOrders` rows, which is what `releaseFlagsFromEvidence` was written to
 * consume. These tests fail if the wiring is removed (the flags would fall back
 * to the frozen defaults) and if the derivation is faked (the flags would not
 * track the evidence).
 */
describe("R35 (c): diagnostics derives the release flags from stored evidence", () => {
  const BINDING = {
    network: "preprod",
    nonce: "4".repeat(64),
    address: "1".repeat(64),
    quoteId: "quote-1",
    observationId: "obs-1",
    authorizationId: "pay-1",
    boundAt: 1_700_000_000_000,
  };

  const readWith = async (rows: {
    binding?: Record<string, unknown> | null;
    chain?: Record<string, unknown> | null;
  }) => {
    const handler = (
      read as unknown as {
        _handler: (
          ctx: never,
          args: { paymentIntentId?: string },
        ) => Promise<{
          release: { immutableOrderAdmission: boolean; r1Complete: boolean };
        }>;
      }
    )._handler;
    const payment = {
      _id: "pay-1",
      buyerAccountId: "acct-1",
      quoteId: "quote-1",
      stripePaymentIntentId: "pi_1",
    };
    const ctx = {
      auth: {
        getUserIdentity: async () => ({
          issuer: process.env.CONVEX_SITE_URL ?? "privy.io",
          subject: "did:privy:buyer",
        }),
      },
      db: {
        get: async () => payment,
        query: (table: string) => ({
          withIndex: (index: string) => ({
            take: async () => {
              if (table === "memberships")
                return [{ status: "active", accountId: "acct-1" }];
              return [];
            },
            unique: async () => {
              if (table === "canonicalBindings" && index === "by_quote")
                return rows.binding ?? null;
              if (table === "chainOrders" && index === "by_quote")
                return rows.chain ?? null;
              return null;
            },
          }),
        }),
      },
    } as never;
    return (await handler(ctx, { paymentIntentId: "pay-1" })).release;
  };

  test("no evidence at all is the frozen default, not an error", async () => {
    expect(await readWith({})).toEqual(RELEASE_FLAG_DEFAULTS);
  });

  test("a stored binding alone turns on immutableOrderAdmission only", async () => {
    const flags = await readWith({ binding: BINDING });
    expect(flags.immutableOrderAdmission).toBe(true);
    expect(flags.r1Complete).toBe(false);
  });

  test("a binding plus a chain reservation turns on both flags", async () => {
    const flags = await readWith({
      binding: BINDING,
      chain: {
        orderId: "order-1",
        address: "1".repeat(64),
        observedAt: 1_700_000_000_000,
      },
    });
    expect(flags.immutableOrderAdmission).toBe(true);
    expect(flags.r1Complete).toBe(true);
  });

  test("a malformed binding is not evidence: the flag stays off", async () => {
    // `releaseFlagsFromEvidence` validates shape, so a half-written row must not
    // read as a completed admission.
    const flags = await readWith({
      binding: { ...BINDING, boundAt: undefined },
    });
    expect(flags.immutableOrderAdmission).toBe(false);
    expect(flags.r1Complete).toBe(false);
  });

  test("the read calls releaseFlags rather than returning a constant", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./diagnostics.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("release: releaseFlags(evidence)");
    expect(source).toContain('from "../packages/backend/src/release-flags"');
  });
});
