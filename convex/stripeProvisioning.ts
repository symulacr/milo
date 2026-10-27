"use node";

import { createHash, createHmac } from "node:crypto";
import {
  actionGeneric,
  type GenericActionCtx,
  internalActionGeneric,
  makeFunctionReference,
} from "convex/server";
import { type GenericId, type Infer, v } from "convex/values";
import type {
  FrozenQuote,
  PaymentAuthorization,
} from "../packages/backend/src/admission-policy";
import { inviteFailureReason } from "../packages/backend/src/email";
import {
  bytesToHex,
  HEX64,
  hexToBytes,
  randomHex,
} from "../packages/backend/src/encoding";
import { stripeMode } from "../packages/backend/src/stripe-mode";
import {
  normalizeTestPayment,
  observeTestPayment,
  stripeClient,
  type TestPaymentBinding,
} from "../packages/backend/src/stripe-observer.server";
import { provisionTestIntent } from "../packages/backend/src/stripe-provisioning.server";
import type { DataModel } from "./_generated/dataModel";
import { requiredEnv, unavailable } from "./admissionContext";
import { quoteDraftFields, rejectWith } from "./admissionValidators";
import { authComponent, createAuth } from "./auth";

type JobInput = { jobId: GenericId<"paymentJobs">; generation: number };
type Snapshot = {
  job: {
    stripeAccountId: string;
    stripeCustomerId: string;
    firstAttemptAt: number;
    mode?: "create" | "observe";
  };
  quote: FrozenQuote;
  payment:
    | (Omit<TestPaymentBinding, "id"> & { _id: GenericId<"paymentIntents"> })
    | null;
} | null;

const BEGIN = makeFunctionReference<"mutation", JobInput, Snapshot>(
  "provisioning:begin",
);
const FINISH = makeFunctionReference<"mutation">("provisioning:finish");

export const run = internalActionGeneric({
  args: { jobId: v.id("paymentJobs"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runMutation(BEGIN, args);
    if (!snapshot) return null;
    try {
      if (!snapshot.payment) {
        if (snapshot.job.mode === "observe") {
          await ctx.runMutation(FINISH, args);
          return null;
        }
        const stripePaymentIntentId = await provisionTestIntent({
          jobId: args.jobId,
          quote: snapshot.quote,
          firstAttemptAt: snapshot.job.firstAttemptAt,
          stripeAccountId: snapshot.job.stripeAccountId,
          stripeCustomerId: snapshot.job.stripeCustomerId,
        });
        await ctx.runMutation(FINISH, { ...args, stripePaymentIntentId });
      } else {
        const observation = await observeTestPayment({
          ...snapshot.payment,
          id: snapshot.payment._id,
        });
        await ctx.runMutation(FINISH, {
          ...args,
          ...(observation.kind === "observed"
            ? { authorization: observation.authorization }
            : {}),
        });
      }
    } catch {
      await ctx.runMutation(FINISH, args);
    }
    return null;
  },
});

const DRAFT = makeFunctionReference<"mutation">(
  "trustedProvisioning:writeQuoteDraft",
);

/**
 * R22 I-01: the legacy derivation, kept ONLY so an order created before
 * per-order secrets still resolves. New orders never reach it — their secret is
 * generated at creation and stored server-side.
 */
const legacyOperatorSecretFor = (nonce: string): string =>
  createHmac("sha256", hexToBytes(requiredEnv("MILO_OPERATOR_SECRET", HEX64)))
    .update(hexToBytes(nonce))
    .digest("hex");

/**
 * The operator signing secret for one order.
 *
 * `stored` is the per-order secret written at creation. When it is present the
 * env secret is not read at all, so a leak of `MILO_OPERATOR_SECRET` derives
 * nothing for any order created after this change. The fallback exists so the
 * orders already deployed on chain keep working; it is the only path that still
 * touches the env var.
 */
const operatorSecretFor = (nonce: string, stored?: string | null): string =>
  stored ?? legacyOperatorSecretFor(nonce);

/** 32 random bytes as hex: the per-order operator secret (R22 I-01). */
const randomSecret = randomHex;

const capability = async (
  network: string,
  nonce: string,
  role: number,
  secret: string,
): Promise<string> => {
  const { pureCircuits } = await import(
    "../packages/contract/generated/contract/index.js"
  );
  const { networkBytes } = await import(
    "../packages/backend/src/public-constructor.ts"
  );
  return Buffer.from(
    pureCircuits.hashCapability(
      networkBytes(network),
      hexToBytes(nonce),
      role,
      hexToBytes(secret),
    ),
  ).toString("hex");
};

const quoteArgs = { ...quoteDraftFields };

const quoteReturns = v.object({
  quoteId: v.string(),
  inviteUrl: v.string(),
  emailed: v.boolean(),
  /** Why the email did not go out; present only when `emailed` is false. */
  reason: v.optional(v.string()),
});

type QuoteInput = {
  [K in keyof typeof quoteArgs]: Infer<(typeof quoteArgs)[K]>;
};

type ActionCtx = GenericActionCtx<DataModel>;

/** Write the draft, then email the single-use link that also signs in. */
async function writeAndInvite(
  ctx: ActionCtx,
  quote: QuoteInput & { studioName?: string },
) {
  // R22 I-01 (V1): the operator secret is random per order and lives only in
  // the server-side draft. The commitment the contract checks is derived from
  // it, so a leak of MILO_OPERATOR_SECRET derives nothing for this order.
  const operatorSecret = randomSecret();
  const draft = await ctx.runMutation(DRAFT, {
    ...quote,
    operatorSecret,
    operatorCommitment: await capability(
      "preprod",
      quote.orderNonce,
      2,
      operatorSecret,
    ),
  });
  try {
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    await auth.api.signInMagicLink({
      body: {
        email: quote.clientEmail,
        // R21 I-11 removed `inviteToken` from the mutation's result, so the
        // callback is taken from the URL that carries it. Reading the old
        // field left `callbackURL` undefined and broke every invite.
        callbackURL:
          new URL(draft.inviteUrl).pathname + new URL(draft.inviteUrl).search,
        metadata: { quoteId: draft.quoteId },
      },
      headers,
    });
    return {
      quoteId: draft.quoteId,
      inviteUrl: draft.inviteUrl,
      emailed: true,
    };
  } catch (cause) {
    // The quote exists and the link works; only the delivery failed. Report it
    // instead of throwing, so a retry cannot create a second quote.
    return {
      quoteId: draft.quoteId,
      inviteUrl: draft.inviteUrl,
      emailed: false,
      reason: inviteFailureReason(cause),
    };
  }
}

export const createQuote = actionGeneric({
  args: quoteArgs,
  returns: quoteReturns,
  handler: async (ctx, args) => writeAndInvite(ctx, args),
});

const FINALIZE = makeFunctionReference<
  "mutation",
  { quoteId: string; operatorCommitment: string },
  | {
      ok: true;
      version: number;
      amountMinor: number;
      currency: string;
      buyerAccountId: string;
      stripeCustomerId: string | null;
    }
  | { ok: false; reason: string }
>("trustedProvisioning:finalizeQuote");

/**
 * A studio's first order, in one call. The studio is created only when the
 * caller has none, so a returning studio never renames itself by accident.
 * `scopeId` is accepted for a caller that already resolved its studio.
 */
export const createStudioAndQuote = actionGeneric({
  args: {
    studioName: v.string(),
    ...quoteArgs,
    scopeId: v.optional(v.string()),
  },
  returns: quoteReturns,
  handler: async (ctx, args) => {
    const { studioName, scopeId: given, ...quote } = args;
    // One call: `writeQuoteDraft` ensures the studio when `studioName` is set,
    // so this used to be studioFor -> createStudio -> writeQuoteDraft (3
    // round-trips) and is now one.
    return writeAndInvite(ctx, {
      ...quote,
      scopeId: given ?? "",
      studioName: given ? undefined : studioName,
    });
  },
});

const NONCE_FOR_QUOTE = makeFunctionReference<
  "query",
  { quoteId: string },
  { orderNonce: string; operatorSecret: string | null } | null
>("trustedProvisioning:orderNonceFor");

const FREEZE = makeFunctionReference<"mutation">("provisioning:freeze");

const BIND_PAYMENT = makeFunctionReference<
  "mutation",
  {
    quoteId: string;
    quoteVersion: number;
    buyerAccountId: string;
    amountMinor: number;
    currency: string;
    stripeAccountId: string;
    stripeCustomerId: string;
    stripePaymentIntentId: string;
    authorization: PaymentAuthorization;
  },
  {
    paymentIntentId: GenericId<"paymentIntents">;
    stripeCustomerId: string;
    stripePaymentIntentId: string;
  }
>("trustedProvisioning:bindHeldPayment");

const OBSERVE_PAYMENT = makeFunctionReference<"mutation">(
  "trustedProvisioning:observeHeldPayment",
);

export const holdPayment = actionGeneric({
  args: { quoteId: v.string() },
  returns: v.object({
    state: v.union(
      v.literal("held"),
      v.literal("pending"),
      v.literal("needs-card"),
      v.literal("failed"),
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    state: "held" | "pending" | "needs-card" | "failed";
    reason?: string;
  }> => {
    // Two hops, not three: this read exists only to seed the operator
    // capability, and `finalizeQuote` returns the accepted draft's own fields
    // rather than making the action read them again.
    const nonce = await ctx.runQuery(NONCE_FOR_QUOTE, {
      quoteId: args.quoteId,
    });
    if (!nonce) return { state: "failed" as const, reason: "Order not found." };
    const operator = await capability(
      "preprod",
      nonce.orderNonce,
      2,
      operatorSecretFor(nonce.orderNonce, nonce.operatorSecret),
    );
    const finalized = await ctx.runMutation(FINALIZE, {
      quoteId: args.quoteId,
      operatorCommitment: operator,
    });
    if (!finalized.ok)
      return { state: "failed" as const, reason: finalized.reason };
    // Refuse a live key before freezing: freezing is a durable state change, so
    // a refusal after it would leave the quote frozen with no payment intent.
    const mode = stripeMode(process.env.STRIPE_SECRET_KEY);
    if (mode === "live")
      return {
        state: "needs-card" as const,
        reason: "Live card entry is not available yet.",
      };
    try {
      await ctx.runMutation(FREEZE, {
        quoteId: args.quoteId,
        expectedVersion: finalized.version,
      });
      const stripe = stripeClient();
      const account = await stripe.accounts.retrieveCurrent();
      const customerId =
        finalized.stripeCustomerId ??
        (
          await stripe.customers.create(
            { metadata: { buyerAccountId: finalized.buyerAccountId } },
            { idempotencyKey: `milo-customer:${finalized.buyerAccountId}` },
          )
        ).id;
      const intent = await stripe.paymentIntents.create(
        {
          amount: finalized.amountMinor,
          currency: finalized.currency.toLowerCase(),
          customer: customerId,
          capture_method: "manual",
          allowed_payment_method_types: ["card"],
          payment_method: "pm_card_visa",
          confirm: true,
          expand: ["latest_charge"],
          metadata: {
            quoteId: args.quoteId,
            quoteVersion: String(finalized.version),
          },
        },
        { idempotencyKey: `milo-hold:${args.quoteId}:v${finalized.version}` },
      );
      // The observation is recorded by the bind itself: it is derived from the
      // same provider response, and the bind is the transaction that knows the
      // row id it must be keyed by.
      const observed = normalizeTestPayment(
        intent,
        {
          id: intent.id,
          quoteId: args.quoteId,
          quoteVersion: finalized.version,
          buyerAccountId: finalized.buyerAccountId,
          amountMinor: finalized.amountMinor,
          currency: finalized.currency,
          stripeAccountId: account.id,
          stripeCustomerId: customerId,
          stripePaymentIntentId: intent.id,
          environment: "test",
          network: "preprod",
        },
        Date.now(),
        mode,
      );
      if (observed.kind !== "observed")
        return { state: "failed" as const, reason: observed.reason };
      await ctx.runMutation(BIND_PAYMENT, {
        quoteId: args.quoteId,
        quoteVersion: finalized.version,
        buyerAccountId: finalized.buyerAccountId,
        amountMinor: finalized.amountMinor,
        currency: finalized.currency,
        stripeAccountId: account.id,
        stripeCustomerId: customerId,
        stripePaymentIntentId: intent.id,
        authorization: observed.authorization,
      });
      const status = observed.authorization.status;
      if (status === "authorized" || status === "captured")
        return { state: "held" as const };
      if (status === "failed") return { state: "failed" as const };
      return { state: "pending" as const };
    } catch (error) {
      return {
        state: "failed" as const,
        reason:
          error instanceof Error ? error.message : "The payment hold failed.",
      };
    }
  },
});

const OPERATOR_EMAILS = makeFunctionReference<
  "query",
  { quoteId: string },
  {
    allowed: boolean;
    orderNonce: string | null;
    operatorSecret: string | null;
  }
>("trustedProvisioning:operatorAccess");

export const operatorSecret = actionGeneric({
  args: { quoteId: v.string() },
  returns: v.union(
    v.object({ secret: v.string() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ secret: string } | { ok: false; reason: string }> => {
    const access = await ctx.runQuery(OPERATOR_EMAILS, {
      quoteId: args.quoteId,
    });
    if (!access.orderNonce)
      return { ok: false as const, reason: "Order not found." };
    if (!access.allowed)
      return {
        ok: false as const,
        reason: "Operator access is not configured.",
      };
    // R21 I-03: this hands out a signing capability and recorded nothing, so a
    // compromised operator left no trace. Logged, not stored: a table would
    // need a retention policy nobody has written (I-04), and Convex's log
    // retention is already bounded. Never the key itself.
    console.warn(
      "operator-key-issued",
      JSON.stringify({ quoteId: args.quoteId }),
    );
    return {
      secret: operatorSecretFor(access.orderNonce, access.operatorSecret),
    };
  },
});

const ATTACH_DRAFT = makeFunctionReference<
  "query",
  { quoteId: string },
  {
    id: string;
    version: number;
    orderNonce: string;
    termsCommitment: string;
    buyerCommitment: string | null;
    merchantCommitment: string;
    operatorCommitment: string | null;
    rolesFingerprint: string;
    initialStateFingerprint: string;
    genesisHash: string;
    acceptance: number;
    delivery: number;
    review: number;
    resolution: number;
  } | null
>("trustedProvisioning:readFrozenQuote");

const RECORD_DEPLOYMENT = makeFunctionReference<"mutation">(
  "observationIngest:recordDeployment",
);

const ADMISSION_BIND = makeFunctionReference<"mutation">("admission:bind");

const PAYMENT_FOR_QUOTE = makeFunctionReference<
  "query",
  { quoteId: string },
  {
    paymentIntentId: GenericId<"paymentIntents">;
    quoteVersion: number;
    buyerAccountId: string;
    amountMinor: number;
    currency: string;
    stripeAccountId: string;
    stripeCustomerId: string;
    stripePaymentIntentId: string;
  } | null
>("trustedProvisioning:paymentForQuote");

const INDEXER = `query Latest($address: HexEncoded!) {
  contractAction(address: $address) {
    state
    transaction { hash block { height hash } }
  }
}`;

const HEAD = "query { block { height } }";

const FINALITY_DEPTH = 3;

type Indexed = {
  state: string;
  transaction: { hash: string; block: { height: number; hash: string } } | null;
};

async function indexerPost(
  query: string,
  variables: Record<string, unknown> | undefined,
): Promise<unknown> {
  const url = requiredEnv("MIDNIGHT_PREPROD_INDEXER_HTTP");
  const token = requiredEnv("MILO_PREPROD_BLOCKFROST_PROJECT_ID");
  const endpoint = new URL(url);
  endpoint.searchParams.set("project_id", token);
  const response = await fetch(endpoint.href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    unavailable(`The Preprod indexer answered ${response.status}.`);
  const body = (await response.json()) as {
    data?: unknown;
    errors?: unknown[];
  };
  if (body.errors && body.errors.length > 0)
    unavailable("The Preprod indexer rejected the query.");
  return body.data;
}

export const attachContract = actionGeneric({
  args: { quoteId: v.string(), address: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), phase: v.string() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const reject = rejectWith;
    if (!/^[a-f0-9]{64}$/.test(args.address))
      return reject("The contract address is not 64 lowercase hex characters.");
    const quote = await ctx.runQuery(ATTACH_DRAFT, { quoteId: args.quoteId });
    if (!quote) return reject("The order is not ready for its contract.");
    if (!quote.buyerCommitment || !quote.operatorCommitment)
      return reject("The order is not ready for its contract.");
    const { ContractState } = await import("@midnight-ntwrk/compact-runtime");
    const { ledger } = await import(
      "../packages/contract/generated/contract/index.js"
    );
    const { hexToBytes } = await import("../packages/backend/src/encoding");
    const { networkBytes } = await import(
      "../packages/backend/src/public-constructor.ts"
    );
    const { REQUIRED_ENTRYPOINTS } = await import(
      "../packages/backend/src/admission-policy"
    );
    let head: number;
    let action: Indexed | null;
    try {
      const headData = (await indexerPost(HEAD, undefined)) as {
        block?: { height?: unknown };
      } | null;
      if (typeof headData?.block?.height !== "number")
        return reject("The Preprod indexer returned no head block.");
      head = headData.block.height;
      const data = (await indexerPost(INDEXER, {
        address: args.address,
      })) as {
        contractAction?: Indexed | null;
      } | null;
      action = data?.contractAction ?? null;
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "The Preprod indexer failed.",
      );
    }
    if (!action?.transaction?.block)
      return reject("No contract is at this address.");
    if (head - action.transaction.block.height < FINALITY_DEPTH)
      return reject("The contract is not final yet.");
    let state: InstanceType<typeof ContractState>;
    let view: ReturnType<typeof ledger>;
    try {
      state = ContractState.deserialize(hexToBytes(action.state));
      view = ledger(state.data);
    } catch {
      return reject("The contract state cannot be read.");
    }
    const hex = bytesToHex;
    const expected = {
      network: hex(networkBytes("preprod")),
      orderNonce: quote.orderNonce,
      termsCommitment: quote.termsCommitment,
      buyerCommitment: quote.buyerCommitment,
      merchantCommitment: quote.merchantCommitment,
      operatorCommitment: quote.operatorCommitment,
    };
    const actual = {
      network: hex(view.configuration.network),
      orderNonce: hex(view.configuration.orderNonce),
      termsCommitment: hex(view.configuration.termsCommitment),
      buyerCommitment: hex(view.configuration.buyerCommitment),
      merchantCommitment: hex(view.configuration.merchantCommitment),
      operatorCommitment: hex(view.configuration.operatorCommitment),
    };
    const fields = Object.keys(expected) as (keyof typeof expected)[];
    if (fields.some((key) => expected[key] !== actual[key]))
      return reject("The contract does not match this order.");
    const deadlines = [
      ["acceptance", quote.acceptance],
      ["delivery", quote.delivery],
      ["review", quote.review],
      ["resolution", quote.resolution],
    ] as const;
    const observed = [
      Number(view.configuration.acceptanceDeadline),
      Number(view.configuration.deliveryDeadline),
      Number(view.configuration.reviewDeadline),
      Number(view.configuration.resolutionDeadline),
    ];
    const drift = observed.some(
      (value, index) => Math.abs(value - deadlines[index][1]) > 600,
    );
    if (drift) return reject("The contract deadlines do not match this order.");
    const installed = state
      .operations()
      .map((name) =>
        typeof name === "string"
          ? name
          : new TextDecoder("utf-8", { fatal: true }).decode(name),
      );
    if (
      installed.length !== REQUIRED_ENTRYPOINTS.length ||
      !REQUIRED_ENTRYPOINTS.every((name) => installed.includes(name))
    )
      return reject("The contract does not install all 14 verifiers.");
    const authority = state.maintenanceAuthority;
    if (authority?.threshold !== 1 || authority.committee.length !== 0)
      return reject("The contract maintenance authority is not locked.");
    const observedAt = Date.now();
    const stateFingerprint = createHash("sha256")
      .update(action.state)
      .digest("hex");
    const record = {
      constructorVersion: 1 as const,
      constructorEncoding: "milo:compact-configuration:v1" as const,
      buyerCommitment: quote.buyerCommitment,
      merchantCommitment: quote.merchantCommitment,
      operatorCommitment: quote.operatorCommitment,
      id: `deployment_${createHash("sha256")
        .update(JSON.stringify([args.address, action.transaction.hash]))
        .digest("hex")
        .slice(0, 32)}`,
      quoteId: quote.id,
      quoteVersion: quote.version,
      observationVersion: 2 as const,
      source: "chain-observer" as const,
      network: "preprod" as const,
      nonce: quote.orderNonce,
      address: args.address,
      phase: "DEPLOYED" as const,
      revision: 0 as const,
      termsCommitment: quote.termsCommitment,
      artifactFingerprint:
        "8428a3177d719c147c2cb26e97f744b4d01de098a661a49c419693ad37417701",
      keySetFingerprint:
        "db2705f6d7625e912c568b0b8a3ddf85944b9a74c5d4bf97c13f9c7099302ee0",
      rolesFingerprint: quote.rolesFingerprint,
      initialStateFingerprint: quote.initialStateFingerprint,
      genesisHash: quote.genesisHash,
      entrypoints: [...REQUIRED_ENTRYPOINTS],
      maintenancePolicy: "locked" as const,
      maintenanceReceiptFingerprint: createHash("sha256")
        .update(
          JSON.stringify([
            "locked",
            args.address,
            action.transaction.hash,
            stateFingerprint,
          ]),
        )
        .digest("hex"),
      blockHash: action.transaction.block.hash.replace(/^0x/, ""),
      blockHeight: action.transaction.block.height,
      stateFingerprint,
      observedAt,
      acceptanceDeadlineSeconds: quote.acceptance,
      deliveryDeadlineSeconds: quote.delivery,
      reviewDeadlineSeconds: quote.review,
      resolutionDeadlineSeconds: quote.resolution,
    };
    let recorded: { kind: string; observationId: string };
    try {
      recorded = (await ctx.runMutation(RECORD_DEPLOYMENT, record)) as {
        kind: string;
        observationId: string;
      };
    } catch (error) {
      return reject(
        error instanceof Error
          ? error.message
          : "The deployment record was refused.",
      );
    }
    const payment = await ctx.runQuery(PAYMENT_FOR_QUOTE, {
      quoteId: quote.id,
    });
    if (!payment)
      return reject("The payment hold is not in place for this order.");
    if (process.env.STRIPE_SECRET_KEY && payment.stripePaymentIntentId) {
      const observed = await observeTestPayment({
        ...payment,
        id: payment.paymentIntentId,
        quoteId: quote.id,
        environment: "test",
        network: "preprod",
      });
      if (observed.kind === "observed")
        await ctx.runMutation(OBSERVE_PAYMENT, {
          paymentIntentId: payment.paymentIntentId,
          authorization: observed.authorization,
        });
    }
    const bound = (await ctx.runMutation(ADMISSION_BIND, {
      quoteId: quote.id,
      expectedQuoteVersion: quote.version,
      observationId: recorded.observationId,
      authorizationId: payment.paymentIntentId,
      address: args.address,
    })) as { kind: string; reason?: string };
    if (bound.kind === "rejected")
      return reject(bound.reason ?? "Admission refused the contract.");
    return { ok: true as const, phase: "DEPLOYED" };
  },
});
