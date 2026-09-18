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
  assertProvisioningActive,
  provision,
  revoke,
} from "../../../convex/trustedProvisioning";
import { provisionTestCustomerFacts } from "../src/stripe-customer-provisioning.server";
import {
  canonicalPayload,
  validateProvenance,
} from "../src/trusted-provisioning-policy";

type Row = Record<string, unknown>;
const provenance = {
  operatorId: "operator-1",
  sourceId: "verified-import",
  evidenceFingerprint: "a".repeat(64),
};
const configured = JSON.stringify([
  { operatorId: provenance.operatorId, sourceId: provenance.sourceId },
]);
const original = process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
afterEach(() => {
  if (original === undefined)
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
  else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = original;
});
function handler<T>(fn: unknown) {
  return (fn as { _handler: (ctx: AdmissionContext, args: Row) => Promise<T> })
    ._handler;
}
const insert = handler<string>(provision);
const remove = handler<null>(revoke);

// Handler doubles verify policy, not hosted Convex authorization or OCC.
function fixture() {
  process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = configured;
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

import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../src/public-constructor.mjs";

function quote() {
  const now = Date.now();
  const result = {
    kind: "quote",
    value: {
      constructorVersion: 1 as const,
      constructorEncoding: CONSTRUCTOR_ENCODING,
      buyerCommitment: "1".repeat(64),
      merchantCommitment: "2".repeat(64),
      operatorCommitment: "3".repeat(64),
      termsCommitment: "a".repeat(64),
      id: "quote",
      scopeId: "scope",
      network: "preprod",
      nonce: "4".repeat(64),
      version: 2,
      amountMinor: 1200,
      currency: "USD",
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
      expiresAt: now + 300000,
      imagePackPolicy: {
        serviceVersion: 1,
        packQuantity: 1,
        outputCount: 3,
        unitPriceMinor: 1200,
      },
    },
  };
  Object.assign(result.value, publicConstructorFingerprints(result.value));
  return result;
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
    ).rejects.toThrow("Privy subject");
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
