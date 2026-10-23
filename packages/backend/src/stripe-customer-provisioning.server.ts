import { createHash } from "node:crypto";
import { isTestStripeId, testStripeClient } from "./stripe-observer.server";
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

const IDENTIFIER_FIELDS = [
  "buyerAccountId",
  "stripeAccountId",
  "stripeCustomerId",
] as const;

function isTrustedIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 512 && value.trim() === value;
}

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
    !IDENTIFIER_FIELDS.every(
      (field) =>
        typeof input[field] === "string" && isTrustedIdentifier(input[field]),
    ) ||
    !isTestStripeId(input.stripeAccountId, input.stripeCustomerId)
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
    throw new Error("Stripe test customer facts unavailable");
  }

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
