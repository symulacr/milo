import { afterEach, describe, expect, test } from "bun:test";
import type { AdmissionContext } from "../../../convex/admissionContext";
import { requireMembership } from "../../../convex/auth/identity";
import {
  type AdmissionInput,
  admitCanonical,
} from "../../../convex/canonicalAdmission";
import {
  begin,
  finish,
  freezeApprovedQuote,
  requestPayment,
} from "../../../convex/provisioning";
import {
  attachContract,
  createQuote,
} from "../../../convex/stripeProvisioning";
import {
  acceptInvite,
  assertProvisioningActive,
  createStudio,
  finalizeQuote,
  provision,
  revoke,
  studioFor,
  writeQuoteDraft,
} from "../../../convex/trustedProvisioning";
import { provisionTestCustomerFacts } from "../src/stripe-customer-provisioning.server";
import {
  canonicalPayload,
  validateProvenance,
} from "../src/trusted-provisioning-policy";
import { buildQuote, checkReturns, handlerOf, quoteArgs } from "./fixtures";

// AUDIT15 A-01: no privy.io fallback, so declare the issuer under test.
process.env.CONVEX_SITE_URL ??= "privy.io";

type Row = Record<string, unknown>;

/** The registered function behind a handler, for its `exportReturns`. */
const returnsOf = (name: string) =>
  (({ writeQuoteDraft, createQuote }) as Record<string, unknown>)[name];

const provenance = {
  operatorId: "operator-1",
  sourceId: "verified-import",
  evidenceFingerprint: "a".repeat(64),
};
const configured = JSON.stringify([
  { operatorId: provenance.operatorId, sourceId: provenance.sourceId },
]);
const original = process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
const originalKey = process.env.STRIPE_SECRET_KEY;
afterEach(() => {
  if (original === undefined)
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
  else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = original;
  if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalKey;
});
const handler = <T>(fn: unknown) => handlerOf<Row, T>(fn);
const insert = handler<string>(provision);
const remove = handler<null>(revoke);

// Handler doubles verify policy, not hosted Convex authorization or OCC.
function fixture() {
  process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = configured;
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  const tables: Record<string, Row[]> = Object.fromEntries(
    [
      "trustedProvisioning",
      "trustedProvisioningAudit",
      "memberships",
      "stripeCustomers",
      "approvedQuotes",
      "frozenQuotes",
      "paymentJobs",
      "paymentMonitors",
      "paymentIntents",
      "paymentObservations",
      "canonicalBindings",
    ].map((name) => [name, []]),
  );
  let serial = 0;
  const get = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  const ctx = {
    scheduler: { runAfter: async () => null },
    auth: {
      getUserIdentity: async () => ({
        issuer: "privy.io",
        subject: "did:privy:buyer",
      }),
    },
    db: {
      get: async (id: string) => get(id),
      normalizeId: (table: string, id: string) =>
        id.startsWith(`${table}-`) ? id : null,
      query: (table: string) => ({
        withIndex: (_name: string, range: (q: unknown) => unknown) => {
          const conditions: [string, unknown][] = [];
          const q = {
            eq: (key: string, value: unknown) => {
              conditions.push([key, value]);
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
      insert: async (table: string, value: Row) => {
        const id = `${table}-${++serial}`;
        tables[table].push({ ...value, _id: id });
        return id;
      },
      patch: async (id: string, value: Row) => {
        const row = get(id);
        if (!row) throw new Error("Missing row");
        Object.assign(row, value);
      },
    },
  } as unknown as AdmissionContext;
  return { ctx, tables };
}
const membership = {
  kind: "membership",
  value: {
    privySubject: "did:privy:buyer",
    scopeId: "scope",
    accountId: "buyer",
    role: "buyer",
  },
};
const customer = {
  kind: "customer",
  value: {
    buyerAccountId: "buyer",
    stripeAccountId: "acct_test",
    stripeCustomerId: "cus_test",
  },
};

function quote() {
  const now = Date.now();
  const value = buildQuote({
    id: "quote",
    scopeId: "scope",
    version: 2,
    amountMinor: 1200,
    buyerAccountId: "buyer",
    expiresAt: now + 300000,
    acceptanceDeadlineSeconds: Math.floor(now / 1000) + 600,
    deliveryDeadlineSeconds: Math.floor(now / 1000) + 1200,
    reviewDeadlineSeconds: Math.floor(now / 1000) + 1800,
    resolutionDeadlineSeconds: Math.floor(now / 1000) + 2400,
  });
  return { kind: "quote", value };
}
const args = (payload: unknown, requestId = "request-1") => ({
  payload,
  provenance,
  requestId,
});

describe("customer provider-fact adapter uses existing commit lifecycle", () => {
  for (const race of ["authority-removal", "revocation"] as const) {
    test(`rejects ${race} during provider reads without new writes`, async () => {
      const { ctx, tables } = fixture();
      const input = {
        requestId: "provider-facts-1",
        operatorId: provenance.operatorId,
        sourceId: provenance.sourceId,
        ...customer.value,
      };
      let duringRead = async () => {};
      const factory = () => ({
        accounts: {
          retrieveCurrent: async () => ({ id: input.stripeAccountId }),
        },
        customers: {
          retrieve: async () => {
            await duringRead();
            return { id: input.stripeCustomerId, livemode: false };
          },
        },
      });
      const commit = (
        verified: Parameters<
          Parameters<typeof provisionTestCustomerFacts>[1]
        >[0],
      ) => insert(ctx, verified);
      const id = await provisionTestCustomerFacts(input, commit, factory);
      expect(await provisionTestCustomerFacts(input, commit, factory)).toBe(id);
      expect(tables.trustedProvisioningAudit).toHaveLength(1);
      duringRead = async () => {
        if (race === "authority-removal")
          process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = "[]";
        else
          await remove(ctx, {
            bindingId: id,
            expectedVersion: 1,
            requestId: "revoke-during-read",
            provenance,
          });
      };
      await expect(
        provisionTestCustomerFacts(input, commit, factory),
      ).rejects.toThrow(
        race === "authority-removal" ? "Allowlisted" : "revoked",
      );
      expect(tables.trustedProvisioning).toHaveLength(1);
      expect(tables.stripeCustomers).toHaveLength(1);
      expect(tables.trustedProvisioningAudit).toHaveLength(
        race === "authority-removal" ? 1 : 2,
      );
    });
  }
});

describe("internal trusted provisioning", () => {
  for (const kind of ["membership", "quote", "customer"] as const) {
    for (const stage of [
      "freeze",
      "request",
      "begin",
      "finish",
      "admission",
    ] as const) {
      if (kind === "customer" && stage === "freeze") continue;
      test(`${kind} revocation blocks the real ${stage} handler`, async () => {
        const { ctx, tables } = fixture();
        const ids = {
          membership: await insert(ctx, args(membership, "membership")),
          customer: await insert(ctx, args(customer, "customer")),
          quote: await insert(ctx, args(quote(), "quote")),
        };
        const consent = {
          quoteId: "quote",
          expectedVersion: 2,
          consent: "create-test-payment",
        };
        if (stage !== "freeze") {
          await freezeApprovedQuote(ctx, consent);
        }
        let jobId: string | undefined;
        if (stage === "begin" || stage === "finish" || stage === "request") {
          jobId = await handler<string>(requestPayment)(ctx, consent);
        }
        if (stage === "finish") {
          expect(
            await handler(begin)(ctx, { jobId, generation: 1 }),
          ).not.toBeNull();
        }
        await remove(ctx, {
          bindingId: ids[kind],
          expectedVersion: kind === "quote" ? 2 : 1,
          requestId: "revoke",
          provenance,
        });
        const before = JSON.stringify({
          frozen: tables.frozenQuotes,
          payments: tables.paymentIntents,
          observations: tables.paymentObservations,
          bindings: tables.canonicalBindings,
        });
        const operation = () => {
          if (stage === "freeze") return freezeApprovedQuote(ctx, consent);
          if (stage === "request") return handler(requestPayment)(ctx, consent);
          if (stage === "begin")
            return handler(begin)(ctx, { jobId, generation: 1 });
          if (stage === "finish")
            return handler(finish)(ctx, {
              jobId,
              generation: 1,
              stripePaymentIntentId: "pi_test",
            });
          return admitCanonical(ctx, {
            quoteId: "quote",
            expectedQuoteVersion: 2,
            observationId: "observation",
            authorizationId: "paymentIntents-test",
            address: "address",
          } as AdmissionInput);
        };
        if (
          kind === "membership" &&
          (stage === "begin" || stage === "finish")
        ) {
          expect(await operation()).toBeNull();
          expect(tables.paymentJobs[0].state).toBe("blocked");
        } else {
          await expect(operation()).rejects.toThrow(
            kind === "membership" ? "Active membership" : "revoked",
          );
        }
        expect(
          JSON.stringify({
            frozen: tables.frozenQuotes,
            payments: tables.paymentIntents,
            observations: tables.paymentObservations,
            bindings: tables.canonicalBindings,
          }),
        ).toBe(before);
      });
    }
  }
  test("exports internal mutations only", () => {
    expect((provision as unknown as { isInternal: boolean }).isInternal).toBe(
      true,
    );
    expect((revoke as unknown as { isInternal: boolean }).isInternal).toBe(
      true,
    );
  });
  test("fails closed without configured operator/source and evidence", async () => {
    const { ctx, tables } = fixture();
    for (const config of [
      undefined,
      "broken",
      "[]",
      JSON.stringify([
        { operatorId: provenance.operatorId, sourceId: "other" },
      ]),
    ]) {
      if (config === undefined)
        delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
      else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = config;
      await expect(insert(ctx, args(membership))).rejects.toThrow();
    }
    expect(tables.memberships).toHaveLength(0);
    expect(() =>
      validateProvenance(
        { ...provenance, evidenceFingerprint: "unverified" },
        "request",
        configured,
      ),
    ).toThrow();
    expect(() => validateProvenance(provenance, " ", configured)).toThrow();
  });
  test("canonical payload comparison ignores object field ordering", () => {
    expect(canonicalPayload({ b: 2, a: { y: 1, x: 0 } })).toBe(
      canonicalPayload({ a: { x: 0, y: 1 }, b: 2 }),
    );
  });
  test("revocation requires configured authority and duplicate bindings fail closed", async () => {
    const { ctx, tables } = fixture();
    const id = await insert(ctx, args(customer));
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
    await expect(
      remove(ctx, {
        bindingId: id,
        expectedVersion: 1,
        requestId: "revoke",
        provenance,
      }),
    ).rejects.toThrow();
    expect(tables.trustedProvisioning[0].status).toBe("active");
    expect(tables.trustedProvisioningAudit).toHaveLength(1);
    tables.trustedProvisioning.push({
      ...tables.trustedProvisioning[0],
      _id: "duplicate",
    });
    await expect(
      assertProvisioningActive(ctx, "customer", "buyer"),
    ).rejects.toThrow("Duplicate rows");
  });
  for (const [name, build, table] of [
    ["membership", () => membership, "memberships"],
    ["customer", () => customer, "stripeCustomers"],
    ["quote", quote, "approvedQuotes"],
  ] as const) {
    test(`${name}: immutable, audited, idempotent and irreversibly revocable`, async () => {
      const { ctx, tables } = fixture();
      const input = build();
      const request = args(input);
      const id = await insert(ctx, request);
      expect(await insert(ctx, request)).toBe(id);
      expect(tables[table]).toHaveLength(1);
      expect(tables.trustedProvisioningAudit).toHaveLength(1);
      expect(tables.trustedProvisioningAudit[0]).toMatchObject(provenance);
      await expect(insert(ctx, args(input, "duplicate"))).rejects.toThrow(
        "already provisioned",
      );
      await expect(
        insert(ctx, {
          ...request,
          provenance: { ...provenance, evidenceFingerprint: "b".repeat(64) },
        }),
      ).rejects.toThrow("request conflict");
      const version = name === "quote" ? 2 : 1;
      const revocation = {
        bindingId: id,
        expectedVersion: version,
        requestId: "revoke-1",
        provenance,
      };
      await expect(
        remove(ctx, { ...revocation, expectedVersion: version + 1 }),
      ).rejects.toThrow("version");
      await remove(ctx, revocation);
      expect(await remove(ctx, revocation)).toBeNull();
      expect(tables.trustedProvisioningAudit).toHaveLength(2);
      await expect(insert(ctx, request)).rejects.toThrow("revoked");
      await expect(insert(ctx, args(input, "new-request"))).rejects.toThrow();
      if (name === "membership")
        await expect(requireMembership(ctx, "scope")).rejects.toThrow(
          "Active membership",
        );
      else
        await expect(
          assertProvisioningActive(
            ctx,
            name,
            name === "quote" ? "quote" : "buyer",
          ),
        ).rejects.toThrow("revoked");
    });
  }
  test("rejects rebinding, legacy adoption, and provider customer sharing", async () => {
    const { ctx, tables } = fixture();
    await insert(ctx, args(customer));
    await expect(
      insert(
        ctx,
        args(
          {
            ...customer,
            value: { ...customer.value, stripeCustomerId: "cus_other" },
          },
          "rebind",
        ),
      ),
    ).rejects.toThrow("Immutable binding conflict");
    await expect(
      insert(
        ctx,
        args(
          {
            ...customer,
            value: { ...customer.value, buyerAccountId: "other" },
          },
          "share",
        ),
      ),
    ).rejects.toThrow("already bound");
    tables.memberships.push({ ...membership.value, status: "active" });
    await expect(insert(ctx, args(membership, "adopt"))).rejects.toThrow(
      "cannot be adopted",
    );
    await expect(
      assertProvisioningActive(ctx, "quote", "legacy"),
    ).resolves.toBeUndefined();
  });
  test("distinguishes missing from malformed authority configuration (DEBT-070)", async () => {
    const { ctx } = fixture();
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
    await expect(insert(ctx, args(customer))).rejects.toThrow(
      "configuration required",
    );
    process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = "{";
    await expect(insert(ctx, args(customer))).rejects.toThrow(
      "configuration malformed",
    );
  });
  test("rejects invalid catalog policy and identities before writes", async () => {
    const { ctx, tables } = fixture();
    const invalid = quote();
    invalid.value.imagePackPolicy.unitPriceMinor = 1;
    await expect(insert(ctx, args(invalid))).rejects.toThrow("image-pack");
    await expect(
      insert(
        ctx,
        args({
          ...membership,
          value: { ...membership.value, privySubject: "unverified" },
        }),
      ),
    ).rejects.toThrow("Subject required");
    await expect(
      insert(
        ctx,
        args({
          ...customer,
          value: { ...customer.value, stripeCustomerId: "unknown" },
        }),
      ),
    ).rejects.toThrow("Stripe identifiers");
    expect(tables.trustedProvisioningAudit).toHaveLength(0);
  });
});

const createStudioHandler = handlerOf<{ name: string }, { scopeId: string }>(
  createStudio,
);
const writeQuoteDraftHandler = handlerOf<
  Record<string, unknown>,
  { quoteId: string; inviteUrl: string; emailed: boolean }
>(writeQuoteDraft);
const acceptInviteHandler = handlerOf<
  { quoteId: string; token: string; buyerCommitment: string },
  { ok: boolean; reason?: string }
>(acceptInvite);
const studioForHandler = handlerOf<
  Record<string, never>,
  { scopeId: string } | null
>(studioFor);

const HEX = (char: string) => char.repeat(64);

function workspaceFixture(subject = "did:privy:merchant") {
  const tables: Record<string, Row[]> = Object.fromEntries(
    ["memberships", "quoteDrafts"].map((name) => [name, []]),
  );
  let serial = 0;
  const get = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  const ctx = {
    scheduler: { runAfter: async () => null },
    auth: { getUserIdentity: async () => ({ issuer: "privy.io", subject }) },
    db: {
      query: (table: string) => ({
        withIndex: (_name: string, range: (q: unknown) => unknown) => {
          const conditions: [string, unknown][] = [];
          const q = {
            eq: (key: string, value: unknown) => {
              conditions.push([key, value]);
              return q;
            },
          };
          range(q);
          const matched = () =>
            (tables[table] ?? []).filter((row) =>
              conditions.every(([key, value]) => row[key] === value),
            );
          return {
            unique: async () => {
              const rows = matched();
              if (rows.length > 1) throw new Error("Duplicate rows");
              return rows[0] ?? null;
            },
            take: async (n: number) => matched().slice(0, n),
            first: async () => matched()[0] ?? null,
            filter: () => ({
              filter: () => ({ first: async () => matched()[0] ?? null }),
              first: async () => matched()[0] ?? null,
            }),
          };
        },
      }),
      insert: async (table: string, value: Row) => {
        const id = `${table}-${++serial}`;
        tables[table].push({ ...value, _id: id });
        return id;
      },
      patch: async (id: string, value: Row) => {
        const row = get(id);
        if (!row) throw new Error("Missing row");
        Object.assign(row, value);
      },
    },
  } as unknown as AdmissionContext;
  return { ctx, tables };
}

describe("workspace studio and invite flow", () => {
  test("createStudio is one per subject and idempotent", async () => {
    const f = workspaceFixture();
    const first = await createStudioHandler(f.ctx, { name: "North Studio" });
    const second = await createStudioHandler(f.ctx, { name: "North Studio" });
    expect(second.scopeId).toBe(first.scopeId);
    expect(f.tables.memberships).toHaveLength(1);
    expect(f.tables.memberships[0]).toMatchObject({
      role: "merchant",
      studioName: "North Studio",
      status: "active",
    });
  });

  test("createStudio rejects a name outside 2 to 60 characters", async () => {
    const f = workspaceFixture();
    await expect(createStudioHandler(f.ctx, { name: "A" })).rejects.toThrow(
      "2 to 60",
    );
    await expect(
      createStudioHandler(f.ctx, { name: "A".repeat(61) }),
    ).rejects.toThrow("2 to 60");
  });

  test("studioFor finds the caller's studio and nothing else", async () => {
    const f = workspaceFixture();
    expect(await studioForHandler(f.ctx, {})).toBeNull();
    const studio = await createStudioHandler(f.ctx, { name: "North Studio" });
    expect(await studioForHandler(f.ctx, {})).toEqual({
      scopeId: studio.scopeId,
    });
    const other = workspaceFixture("did:privy:other");
    expect(await studioForHandler(other.ctx, {})).toBeNull();
  });

  test("createQuote requires an active merchant in the scope", async () => {
    const f = workspaceFixture();
    const studio = await createStudioHandler(f.ctx, { name: "North Studio" });
    await expect(
      writeQuoteDraftHandler(f.ctx, quoteArgs("someone-else")),
    ).rejects.toThrow("Active studio merchant required");
    const created = await writeQuoteDraftHandler(
      f.ctx,
      quoteArgs(studio.scopeId),
    );
    expect(created.inviteUrl).toContain(`/orders/${created.quoteId}?invite=`);
    expect(f.tables.quoteDrafts).toHaveLength(1);
    // The draft mutation's own return validator must accept what it returns.
    checkReturns(writeQuoteDraft, created);
  });

  // R14: the create-quote action returned `{...draft, emailed}`, and the draft
  // mutation returns `inviteToken` too, so the action's `quoteReturns` rejected
  // its own result live with `ReturnsValidationError: Object contains extra
  // field inviteToken`. Every unit test called `_handler` and skipped the
  // validator, so nothing caught it. These two rows run the real action and
  // check its output against its real `returns` descriptor.
  test("createQuote's result satisfies its returns validator", async () => {
    const f = workspaceFixture();
    const studio = await createStudioHandler(f.ctx, { name: "North Studio" });
    const draft = await writeQuoteDraftHandler(
      f.ctx,
      quoteArgs(studio.scopeId),
    );
    // The action's only Convex call is the draft mutation; the rest is email.
    const ctx = {
      runMutation: async () => draft,
    } as unknown as AdmissionContext;
    // A fixture key, not a real secret: the action HMACs the nonce with it.
    const previous = process.env.MILO_OPERATOR_SECRET;
    process.env.MILO_OPERATOR_SECRET = "a".repeat(64);
    try {
      const result = await (
        createQuote as unknown as {
          _handler: (c: AdmissionContext, a: unknown) => Promise<unknown>;
        }
      )._handler(ctx, quoteArgs(studio.scopeId));
      checkReturns(createQuote, result);
      // The token is the draft's; the action must not leak it to the browser.
      expect(result).not.toHaveProperty("inviteToken");
      expect(returnsOf("createQuote")).toBe(createQuote);
    } finally {
      if (previous === undefined) delete process.env.MILO_OPERATOR_SECRET;
      else process.env.MILO_OPERATOR_SECRET = previous;
    }
  });

  test("createQuote rejects terms that do not equal the amount in cents", async () => {
    const f = workspaceFixture();
    const studio = await createStudioHandler(f.ctx, { name: "North Studio" });
    await expect(
      writeQuoteDraftHandler(
        f.ctx,
        quoteArgs(studio.scopeId, {
          terms: {
            unitPrice: "1",
            total: "1",
            scopeDigest: HEX("e"),
            rightsDigest: HEX("f"),
            paymentPolicy: HEX("1"),
            salt: HEX("2"),
          },
        }),
      ),
    ).rejects.toThrow("cents");
  });

  test("acceptInvite is single use and creates the buyer membership", async () => {
    const merchant = workspaceFixture();
    const studio = await createStudioHandler(merchant.ctx, {
      name: "North Studio",
    });
    const created = await writeQuoteDraftHandler(
      merchant.ctx,
      quoteArgs(studio.scopeId),
    );
    const token = new URL(created.inviteUrl).searchParams.get("invite") ?? "";
    const buyer = workspaceFixture("did:privy:buyer");
    buyer.tables.quoteDrafts = merchant.tables.quoteDrafts;
    await expect(
      acceptInviteHandler(buyer.ctx, {
        quoteId: created.quoteId,
        token: "wrong",
        buyerCommitment: HEX("c"),
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      acceptInviteHandler(buyer.ctx, {
        quoteId: created.quoteId,
        token,
        buyerCommitment: HEX("c"),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(buyer.tables.memberships[0]).toMatchObject({
      role: "buyer",
      scopeId: studio.scopeId,
    });
    const second = workspaceFixture("did:privy:other");
    second.tables.quoteDrafts = merchant.tables.quoteDrafts;
    await expect(
      acceptInviteHandler(second.ctx, {
        quoteId: created.quoteId,
        token,
        buyerCommitment: HEX("c"),
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  // AUDIT15 A-04: the link is also the sign-in callback, so it lives on in mail
  // archives. Claiming must rotate the token, or a used link stays readable
  // forever through `orders.invite`.
  test("acceptInvite rotates the invite token on claim", async () => {
    const merchant = workspaceFixture();
    const studio = await createStudioHandler(merchant.ctx, {
      name: "North Studio",
    });
    const created = await writeQuoteDraftHandler(
      merchant.ctx,
      quoteArgs(studio.scopeId),
    );
    const token = new URL(created.inviteUrl).searchParams.get("invite") ?? "";
    const before = merchant.tables.quoteDrafts[0].inviteToken;
    expect(before).toBe(token);
    const buyer = workspaceFixture("did:privy:buyer");
    buyer.tables.quoteDrafts = merchant.tables.quoteDrafts;
    await expect(
      acceptInviteHandler(buyer.ctx, {
        quoteId: created.quoteId,
        token,
        buyerCommitment: HEX("c"),
      }),
    ).resolves.toMatchObject({ ok: true });
    const after = merchant.tables.quoteDrafts[0].inviteToken;
    expect(after).not.toBe(token);
    expect(after).toMatch(/^[a-f0-9]{64}$/);
    // The old link no longer resolves, and the new value is never returned.
    await expect(
      acceptInviteHandler(workspaceFixture("did:privy:third").ctx, {
        quoteId: created.quoteId,
        token,
        buyerCommitment: HEX("c"),
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

const finalizeHandler = handlerOf<
  { quoteId: string; operatorCommitment: string },
  { ok: boolean; version?: number; reason?: string }
>(finalizeQuote);

describe("finalizeQuote", () => {
  function seeded() {
    const f = workspaceFixture("did:privy:buyer");
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:merchant",
      scopeId: "scope-1",
      accountId: "did:privy:merchant",
      role: "merchant",
      status: "active",
      studioName: "North Studio",
    });
    f.tables.quoteDrafts.push({
      _id: "d1",
      id: "quote-1",
      scopeId: "scope-1",
      studioName: "North Studio",
      merchantSubject: "did:privy:merchant",
      merchantAccountId: "did:privy:merchant",
      title: "Three hero images",
      brief: "A short brief for the fixed-price image pack.",
      clientEmail: "client@example.com",
      amountUsd: 900,
      amountMinor: 90_000,
      currency: "USD",
      orderNonce: HEX("a"),
      merchantCommitment: HEX("b"),
      termsCommitment: HEX("d"),
      terms: {
        unitPrice: "90000",
        total: "90000",
        scopeDigest: HEX("e"),
        rightsDigest: HEX("f"),
        paymentPolicy: HEX("1"),
        salt: HEX("2"),
      },
      inviteToken: "token",
      buyerSubject: "did:privy:buyer",
      buyerAccountId: "did:privy:buyer",
      buyerCommitment: HEX("c"),
      createdAt: 1,
      updatedAt: 2,
    });
    return f;
  }

  test("refuses before the client accepts the order", async () => {
    const f = seeded();
    f.tables.quoteDrafts[0].buyerCommitment = undefined;
    await expect(
      finalizeHandler(f.ctx, {
        quoteId: "quote-1",
        operatorCommitment: HEX("5"),
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  test("refuses without a configured genesis hash", async () => {
    const f = seeded();
    f.tables.admissionTimingPolicies = [
      { _id: "t1", network: "preprod", captureSafetyMarginMs: 1000 },
    ];
    await expect(
      finalizeHandler(f.ctx, {
        quoteId: "quote-1",
        operatorCommitment: HEX("5"),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("genesis"),
    });
  });

  test("writes the approved quote once and is idempotent", async () => {
    const f = seeded();
    f.tables.admissionTimingPolicies = [
      { _id: "t1", network: "preprod", captureSafetyMarginMs: 1000 },
    ];
    f.tables.approvedQuotes = [];
    f.tables.trustedProvisioning = [];
    f.tables.trustedProvisioningAudit = [];
    process.env.MILO_PREPROD_GENESIS_HASH = `0x${"9".repeat(64)}`;
    const args = { quoteId: "quote-1", operatorCommitment: HEX("5") };
    const first = await finalizeHandler(f.ctx, args);
    expect(first).toMatchObject({ ok: true, version: 1 });
    expect(f.tables.approvedQuotes).toHaveLength(1);
    const second = await finalizeHandler(f.ctx, args);
    expect(second).toMatchObject({ ok: true, version: 1 });
    expect(f.tables.approvedQuotes).toHaveLength(1);
    delete process.env.MILO_PREPROD_GENESIS_HASH;
  });
});

const attachHandler = (
  attachContract as unknown as {
    _handler: (
      ctx: never,
      args: { quoteId: string; address: string },
    ) => Promise<{ ok: boolean; phase?: string; reason?: string }>;
  }
)._handler;

describe("attachContract", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MIDNIGHT_PREPROD_INDEXER_HTTP;
    delete process.env.MILO_PREPROD_BLOCKFROST_PROJECT_ID;
  });

  test("rejects a malformed address before any indexer call", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    await expect(
      attachHandler({} as never, { quoteId: "q", address: "nope" }),
    ).resolves.toMatchObject({ ok: false });
    expect(called).toBe(false);
  });

  test("rejects when no frozen quote exists", async () => {
    globalThis.fetch = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const ctx = {
      runQuery: async () => null,
      runMutation: async () => null,
    } as never;
    await expect(
      attachHandler(ctx, { quoteId: "q", address: "a".repeat(64) }),
    ).resolves.toMatchObject({ ok: false });
  });

  test("rejects when the indexer reports no contract at the address", async () => {
    process.env.MIDNIGHT_PREPROD_INDEXER_HTTP = "https://indexer.invalid";
    process.env.MILO_PREPROD_BLOCKFROST_PROJECT_ID = "preprod_test";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      const data = body.query.includes("contractAction")
        ? { contractAction: null }
        : { block: { height: 100 } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    const ctx = {
      runQuery: async () => ({
        id: "quote-1",
        version: 1,
        orderNonce: HEX("a"),
        termsCommitment: HEX("d"),
        buyerCommitment: HEX("c"),
        merchantCommitment: HEX("b"),
        operatorCommitment: HEX("5"),
        rolesFingerprint: HEX("3"),
        initialStateFingerprint: HEX("4"),
        genesisHash: "9".repeat(64),
        acceptance: 1,
        delivery: 2,
        review: 3,
        resolution: 4,
      }),
      runMutation: async () => null,
    } as never;
    await expect(
      attachHandler(ctx, { quoteId: "quote-1", address: "a".repeat(64) }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("No contract"),
    });
  });

  test("rejects a contract that is not final", async () => {
    process.env.MIDNIGHT_PREPROD_INDEXER_HTTP = "https://indexer.invalid";
    process.env.MILO_PREPROD_BLOCKFROST_PROJECT_ID = "preprod_test";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      const data = body.query.includes("contractAction")
        ? {
            contractAction: {
              state: "00",
              transaction: {
                hash: "f".repeat(64),
                block: { height: 99, hash: "e".repeat(64) },
              },
            },
          }
        : { block: { height: 100 } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    const ctx = {
      runQuery: async () => ({
        id: "quote-1",
        version: 1,
        orderNonce: HEX("a"),
        termsCommitment: HEX("d"),
        buyerCommitment: HEX("c"),
        merchantCommitment: HEX("b"),
        operatorCommitment: HEX("5"),
        rolesFingerprint: HEX("3"),
        initialStateFingerprint: HEX("4"),
        genesisHash: "9".repeat(64),
        acceptance: 1,
        delivery: 2,
        review: 3,
        resolution: 4,
      }),
      runMutation: async () => null,
    } as never;
    await expect(
      attachHandler(ctx, { quoteId: "quote-1", address: "a".repeat(64) }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("final"),
    });
  });
});
