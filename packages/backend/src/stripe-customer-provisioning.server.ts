import { createHash } from "node:crypto";
import { testStripeClient } from "./stripe-provisioning.server";
import {
  canonicalPayload,
  type Provenance,
  validateProvisioningAuthority,
} from "./trusted-provisioning-policy";

export type CustomerFactRequest = {
  requestId: string;
  operatorId: string;
  sourceId: string;
  buyerAccountId: string;
  stripeAccountId: string;
  stripeCustomerId: string;
};

export type CustomerFactCommit = {
  requestId: string;
  provenance: Provenance;
  payload: {
    kind: "customer";
    value: Pick<
      CustomerFactRequest,
      "buyerAccountId" | "stripeAccountId" | "stripeCustomerId"
    >;
  };
};

export interface CustomerFactReader {
  accounts: { retrieveCurrent(): Promise<{ id: string }> };
  customers: {
    retrieve(id: string): Promise<{
      id: string;
      deleted?: unknown;
      livemode?: boolean;
    }>;
  };
}

// Provider existence is verified; the buyer mapping remains operator-asserted.
export async function provisionTestCustomerFacts<T>(
  input: CustomerFactRequest,
  commit: (args: CustomerFactCommit) => Promise<T>,
  createClient: () => CustomerFactReader = testStripeClient,
): Promise<T> {
  validateProvisioningAuthority(
    input,
    input.requestId,
    process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES,
  );
  if (
    ![
      input.buyerAccountId,
      input.stripeAccountId,
      input.stripeCustomerId,
    ].every(
      (id) =>
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 512 &&
        id.trim() === id,
    ) ||
    !/^acct_[a-zA-Z0-9]+$/.test(input.stripeAccountId) ||
    !/^cus_[a-zA-Z0-9]+$/.test(input.stripeCustomerId)
  )
    throw new Error("Invalid trusted customer fact identifiers");

  let accountId: string;
  let customerId: string;
  try {
    const stripe = createClient();
    const account = await stripe.accounts.retrieveCurrent();
    if (account.id !== input.stripeAccountId)
      throw new Error("Account mismatch");
    const customer = await stripe.customers.retrieve(input.stripeCustomerId);
    if (
      customer.id !== input.stripeCustomerId ||
      (customer.deleted !== undefined && customer.deleted !== false) ||
      customer.livemode !== false
    )
      throw new Error("Invalid test customer");
    accountId = account.id;
    customerId = customer.id;
  } catch {
    // Provider-path failures stay redacted: they can carry identifiers and payloads.
    throw new Error("Stripe test customer facts unavailable");
  }
  // Local digest computation sits outside the redaction boundary: a throw here
  // is a programmer error and must not surface as a provider outage.
  const evidenceFingerprint = createHash("sha256")
    .update(
      canonicalPayload({
        domain: "milo.stripe-test-customer-provider-facts",
        version: 1,
        stripeAccountId: accountId,
        stripeCustomerId: customerId,
        deleted: false,
        livemode: false,
        buyerMapping: {
          authority: "operator-asserted",
          buyerAccountId: input.buyerAccountId,
        },
      }),
    )
    .digest("hex");

  // The existing mutation rechecks current authority and immutable/revoked state.
  return commit({
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
  });
}
