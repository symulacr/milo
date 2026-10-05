import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { provision } from "../../../convex/stripeCustomerProvisioning";
import {
  type CustomerFactCommit,
  type CustomerFactReader,
  provisionTestCustomerFacts,
} from "../src/stripe-customer-provisioning.server";
import { canonicalPayload } from "../src/trusted-provisioning-policy";
import {
  installStripeDouble,
  type StripeDoubleRoutes,
} from "./stripe-fetch-double";

const input = {
  requestId: "request-1",
  operatorId: "operator-1",
  sourceId: "stripe-facts",
  buyerAccountId: "buyer-1",
  stripeAccountId: "acct_test",
  stripeCustomerId: "cus_test",
};
const authorities = JSON.stringify([input]);
const original = process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
afterEach(() => {
  if (original === undefined)
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
  else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = original;
});

function fixture() {
  process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = authorities;
  const calls: unknown[][] = [];
  const writes: CustomerFactCommit[] = [];
  let creations = 0;
  const customer = {
    id: input.stripeCustomerId,
    livemode: false,
    deleted: false,
    email: "private@example.invalid",
    metadata: { buyer: "unrelated" },
  };
  const client: CustomerFactReader = {
    accounts: {
      retrieveCurrent: async (...args) => {
        calls.push(["account", ...args]);
        return { id: input.stripeAccountId };
      },
    },
    customers: {
      retrieve: async (...args) => {
        calls.push(["customer", ...args]);
        return customer;
      },
    },
  };
  return {
    customer,
    client,
    calls,
    writes,
    creations: () => creations,
    factory: () => {
      creations++;
      return client;
    },
    commit: async (args: CustomerFactCommit) => {
      writes.push(args);
      return "binding-1";
    },
  };
}

describe("Stripe test-customer provider facts (not buyer ownership)", () => {
  test("exposes only an internal action", () => {
    expect(provision.isInternal).toBe(true);
    expect("isPublic" in provision).toBe(false);
  });

  test("only reads authenticated account/customer and commits exact minimal evidence", async () => {
    const f = fixture();
    expect(await provisionTestCustomerFacts(input, f.commit, f.factory)).toBe(
      "binding-1",
    );
    expect(f.calls).toEqual([["account"], ["customer", "cus_test"]]);
    const evidenceFingerprint = createHash("sha256")
      .update(
        canonicalPayload({
          domain: "milo.stripe-test-customer-provider-facts",
          version: 1,
          stripeAccountId: input.stripeAccountId,
          stripeCustomerId: input.stripeCustomerId,
          deleted: false,
          livemode: false,
          buyerMapping: {
            authority: "operator-asserted",
            buyerAccountId: input.buyerAccountId,
          },
        }),
      )
      .digest("hex");
    expect(f.writes).toEqual([
      {
        requestId: input.requestId,
        provenance: {
          operatorId: input.operatorId,
          sourceId: input.sourceId,
          evidenceFingerprint,
        },
        payload: {
          kind: "customer",
          value: {
            buyerAccountId: input.buyerAccountId,
            stripeAccountId: input.stripeAccountId,
            stripeCustomerId: input.stripeCustomerId,
          },
        },
      },
    ]);
    f.customer.email = "different@example.invalid";
    f.customer.metadata.buyer = input.buyerAccountId;
    await provisionTestCustomerFacts(input, f.commit, f.factory);
    expect(f.writes[1]).toEqual(f.writes[0]);
    await provisionTestCustomerFacts(
      { ...input, buyerAccountId: "another-buyer" },
      f.commit,
      f.factory,
    );
    expect(f.writes[2].provenance.evidenceFingerprint).not.toBe(
      evidenceFingerprint,
    );
  });

  for (const field of Object.keys(input) as (keyof typeof input)[]) {
    for (const value of ["", " bad ", "x".repeat(513), null, 42]) {
      test(`rejects malformed ${field}/${String(value).length}/${typeof value} before client creation`, async () => {
        const f = fixture();
        await expect(
          provisionTestCustomerFacts(
            { ...input, [field]: value } as typeof input,
            f.commit,
            f.factory,
          ),
        ).rejects.toThrow();
        expect(f.creations()).toBe(0);
        expect(f.calls).toEqual([]);
        expect(f.writes).toEqual([]);
      });
    }
  }

  for (const config of [
    undefined,
    "",
    "{",
    "null",
    "{}",
    "[]",
    '[{"operatorId":"operator-1","sourceId":"wrong"}]',
  ]) {
    test(`rejects missing/malformed/unallowlisted config ${config}`, async () => {
      const f = fixture();
      if (config === undefined)
        delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
      else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = config;
      await expect(
        provisionTestCustomerFacts(input, f.commit, f.factory),
      ).rejects.toThrow();
      expect(f.creations()).toBe(0);
      expect(f.calls).toEqual([]);
      expect(f.writes).toEqual([]);
    });
  }

  for (const failure of [
    "account",
    "customer",
    "live",
    "deleted",
    "malformed-deleted",
    "missing-live",
    "factory-error",
    "account-error",
    "customer-error",
  ]) {
    test(`rejects ${failure} with redacted error and zero commits`, async () => {
      const f = fixture();
      if (failure === "account")
        f.client.accounts.retrieveCurrent = async () => ({ id: "acct_other" });
      if (failure === "customer") f.customer.id = "cus_other";
      if (failure === "live") f.customer.livemode = true;
      if (failure === "deleted") f.customer.deleted = true;
      if (failure === "malformed-deleted")
        f.client.customers.retrieve = async () => ({
          id: input.stripeCustomerId,
          livemode: false,
          deleted: null,
        });
      if (failure === "missing-live")
        f.client.customers.retrieve = async () => ({
          id: input.stripeCustomerId,
        });
      const fail = () => {
        throw new Error("secret raw provider customer response");
      };
      if (failure === "account-error") f.client.accounts.retrieveCurrent = fail;
      if (failure === "customer-error") f.client.customers.retrieve = fail;
      const error = await provisionTestCustomerFacts(
        input,
        f.commit,
        failure === "factory-error" ? fail : f.factory,
      ).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      if (!(error instanceof Error)) throw new Error("Expected redacted error");
      expect(error.message).toBe("Stripe test customer facts unavailable");
      expect(error.cause).toBeUndefined();
      expect(f.writes).toEqual([]);
      if (failure === "account") expect(f.calls).toEqual([]);
    });
  }
});

type ActionRow = Record<string, unknown>;

const BINDING_ID = "trustedprovisioning_binding1";

/**
 * The Convex action as Convex runs it: a node-runtime internal action whose
 * only capability is runMutation. The Stripe SDK under Bun resolves its `bun`
 * export condition to the fetch HTTP client, so intercepting globalThis.fetch
 * drives the real Stripe client, its real request URLs and its real response
 * parsing with no network and no mocked module. See stripe-fetch-double.ts.
 */
function actionFixture(responses: StripeDoubleRoutes = {}) {
  const mutations: { ref: string; args: ActionRow }[] = [];
  let bindingId = BINDING_ID;
  const double = installStripeDouble({
    account: { id: input.stripeAccountId, object: "account" },
    ...responses,
  });
  const ctx = {
    runMutation: async (ref: unknown, args: ActionRow) => {
      const symbol = Object.getOwnPropertySymbols(ref)[0] as symbol;
      mutations.push({
        ref: String((ref as Record<symbol, string>)[symbol]),
        args,
      });
      return bindingId;
    },
  };
  return {
    urls: double.urls,
    mutations,
    ctx,
    setBindingId: (id: string) => {
      bindingId = id;
    },
    restore: double.restore,
  };
}

const authorityConfig = JSON.stringify([input]);
const priorAuthorities = process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
const priorSecretKey = process.env.STRIPE_SECRET_KEY;

function setEnv(key: string | undefined, config: string | undefined) {
  if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = key;
  if (config === undefined)
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
  else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = config;
}

function restoreEnv() {
  setEnv(priorSecretKey, priorAuthorities);
}

const actionHandler = (
  provision as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<string>;
  }
)._handler;

async function runAction(
  f: ReturnType<typeof actionFixture>,
  args: Record<string, unknown> = {},
) {
  setEnv("sk_test_convexactioncoverage", authorityConfig);
  return actionHandler(f.ctx, { ...input, ...args });
}

describe("convex stripeCustomerProvisioning.provision action", () => {
  test("is internal-only and registers an id return on trustedProvisioning", () => {
    expect(provision.isInternal).toBe(true);
    expect(provision.isAction).toBe(true);
    expect("isPublic" in provision).toBe(false);
    const registered = provision as unknown as {
      exportArgs: () => string;
      exportReturns: () => string;
    };
    expect(JSON.parse(registered.exportArgs())).toEqual({
      type: "object",
      value: {
        requestId: { fieldType: { type: "string" }, optional: false },
        operatorId: { fieldType: { type: "string" }, optional: false },
        sourceId: { fieldType: { type: "string" }, optional: false },
        buyerAccountId: { fieldType: { type: "string" }, optional: false },
        stripeAccountId: { fieldType: { type: "string" }, optional: false },
        stripeCustomerId: { fieldType: { type: "string" }, optional: false },
      },
    });
    expect(JSON.parse(registered.exportReturns())).toEqual({
      type: "id",
      tableName: "trustedProvisioning",
    });
  });

  test("verifies live provider facts and commits them through trustedProvisioning:provision", async () => {
    const f = actionFixture();
    let committed: string | undefined;
    try {
      committed = await runAction(f);
    } finally {
      f.restore();
      restoreEnv();
    }
    expect(committed).toBe(BINDING_ID);
    expect(f.urls).toEqual([
      "https://api.stripe.com/v1/account",
      `https://api.stripe.com/v1/customers/${input.stripeCustomerId}`,
    ]);
    expect(f.mutations).toHaveLength(1);
    expect(f.mutations[0].ref).toBe("trustedProvisioning:provision");
    expect(f.mutations[0].args).toEqual({
      requestId: input.requestId,
      provenance: {
        operatorId: input.operatorId,
        sourceId: input.sourceId,
        evidenceFingerprint: createHash("sha256")
          .update(
            canonicalPayload({
              domain: "milo.stripe-test-customer-provider-facts",
              version: 1,
              stripeAccountId: input.stripeAccountId,
              stripeCustomerId: input.stripeCustomerId,
              deleted: false,
              livemode: false,
              buyerMapping: {
                authority: "operator-asserted",
                buyerAccountId: input.buyerAccountId,
              },
            }),
          )
          .digest("hex"),
      },
      payload: {
        kind: "customer",
        value: {
          buyerAccountId: input.buyerAccountId,
          stripeAccountId: input.stripeAccountId,
          stripeCustomerId: input.stripeCustomerId,
        },
      },
    });
  });

  test("the committed payload carries no provider email or metadata", async () => {
    const f = actionFixture({
      customer: {
        id: input.stripeCustomerId,
        object: "customer",
        deleted: false,
        livemode: false,
        email: "private@example.invalid",
        metadata: { buyer: input.buyerAccountId, stripe: "raw" },
      },
    });
    try {
      await runAction(f);
    } finally {
      f.restore();
      restoreEnv();
    }
    const serialized = JSON.stringify(f.mutations[0].args);
    expect(serialized).not.toContain("private@example.invalid");
    expect(serialized).not.toContain("raw");
    expect(f.mutations[0].args.requestId).toBe(input.requestId);
  });

  test("returns whatever id the trustedProvisioning mutation returns", async () => {
    const f = actionFixture();
    f.setBindingId("trustedprovisioning_other9999");
    let committed: string | undefined;
    try {
      committed = await runAction(f);
    } finally {
      f.restore();
      restoreEnv();
    }
    expect(committed).toBe("trustedprovisioning_other9999");
  });

  test("the evidence fingerprint changes with the buyer mapping only", async () => {
    const first = actionFixture();
    let a: string | undefined;
    try {
      await runAction(first);
      a = String(
        (first.mutations[0].args.provenance as ActionRow).evidenceFingerprint,
      );
    } finally {
      first.restore();
    }
    const second = actionFixture();
    let b: string | undefined;
    try {
      await runAction(second, { buyerAccountId: "buyer-2" });
      b = String(
        (second.mutations[0].args.provenance as ActionRow).evidenceFingerprint,
      );
    } finally {
      second.restore();
      restoreEnv();
    }
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(b).toMatch(/^[a-f0-9]{64}$/);
    expect(b).not.toBe(a);
  });

  for (const [name, customer] of [
    [
      "live-mode",
      {
        id: input.stripeCustomerId,
        object: "customer",
        deleted: false,
        livemode: true,
      },
    ],
    [
      "deleted",
      { id: input.stripeCustomerId, object: "customer", deleted: true },
    ],
    [
      "wrong-id",
      {
        id: "cus_someoneelse",
        object: "customer",
        deleted: false,
        livemode: false,
      },
    ],
  ] as const) {
    test(`a ${name} customer is refused before any mutation`, async () => {
      const f = actionFixture({ customer });
      let caught: unknown;
      try {
        await runAction(f);
      } catch (error) {
        caught = error;
      } finally {
        f.restore();
        restoreEnv();
      }
      expect((caught as Error).message).toBe(
        "Stripe test customer facts unavailable",
      );
      expect(f.mutations).toEqual([]);
    });
  }

  test("an account that is not the requested one stops before the customer read", async () => {
    const f = actionFixture({
      account: { id: "acct_someoneelse", object: "account" },
    });
    let caught: unknown;
    try {
      await runAction(f);
    } catch (error) {
      caught = error;
    } finally {
      f.restore();
      restoreEnv();
    }
    expect((caught as Error).message).toBe(
      "Stripe test customer facts unavailable",
    );
    expect(f.urls).toEqual(["https://api.stripe.com/v1/account"]);
    expect(f.mutations).toEqual([]);
  });

  test("a provider error is redacted and never commits", async () => {
    const f = actionFixture({ status: 402 });
    let caught: unknown;
    try {
      await runAction(f);
    } catch (error) {
      caught = error;
    } finally {
      f.restore();
      restoreEnv();
    }
    expect((caught as Error).message).toBe(
      "Stripe test customer facts unavailable",
    );
    expect((caught as Error).message).not.toContain("cus_leak");
    expect(f.mutations).toEqual([]);
  });

  test("an unallowlisted operator config is refused before the provider is called", async () => {
    const f = actionFixture();
    let caught: unknown;
    try {
      setEnv(
        "sk_test_convexactioncoverage",
        JSON.stringify([
          { operatorId: "operator-other", sourceId: "stripe-facts" },
        ]),
      );
      await actionHandler(f.ctx, input);
    } catch (error) {
      caught = error;
    } finally {
      f.restore();
      restoreEnv();
    }
    expect(caught).toBeInstanceOf(Error);
    expect(f.urls).toEqual([]);
    expect(f.mutations).toEqual([]);
  });

  test("malformed identifiers are refused before the provider is called", async () => {
    for (const field of [
      "buyerAccountId",
      "stripeAccountId",
      "stripeCustomerId",
    ] as const) {
      const f = actionFixture();
      let caught: unknown;
      try {
        await runAction(f, { [field]: " bad " });
      } catch (error) {
        caught = error;
      } finally {
        f.restore();
      }
      expect((caught as Error).message).toBe(
        "Invalid trusted customer fact identifiers",
      );
      expect(f.urls).toEqual([]);
      expect(f.mutations).toEqual([]);
    }
    restoreEnv();
  });

  for (const key of [
    undefined,
    "",
    "sk_live_convexactioncoverage",
    "sk_test_",
  ]) {
    test(`the action refuses key ${JSON.stringify(key)} rather than calling the provider`, async () => {
      const f = actionFixture();
      let caught: unknown;
      try {
        setEnv(key, authorityConfig);
        await actionHandler(f.ctx, input);
      } catch (error) {
        caught = error;
      } finally {
        f.restore();
        restoreEnv();
      }
      expect((caught as Error).message).toBe(
        "Stripe test customer facts unavailable",
      );
      expect(f.urls).toEqual([]);
      expect(f.mutations).toEqual([]);
    });
  }
});
