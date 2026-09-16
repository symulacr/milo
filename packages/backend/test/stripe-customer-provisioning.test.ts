import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { provision } from "../../../convex/stripeCustomerProvisioning";
import {
  type CustomerFactCommit,
  type CustomerFactReader,
  provisionTestCustomerFacts,
} from "../src/stripe-customer-provisioning.server";
import { canonicalPayload } from "../src/trusted-provisioning-policy";

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
