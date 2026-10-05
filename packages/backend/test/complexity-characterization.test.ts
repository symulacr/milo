import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import type { AdmissionContext } from "../../../convex/admissionContext";
import {
  requestObservation,
  requestPayment,
} from "../../../convex/provisioning";
import {
  type AdmissionBinding,
  type AdmissionTimingPolicy,
  type AdmissionTransaction,
  type BindAdmissionInput,
  decideCanonicalAdmission,
  type FrozenQuote,
  type ObservedDeployment,
  type PaymentAuthorization,
  REQUIRED_ENTRYPOINTS,
} from "../src/admission-policy";
import {
  normalizeTestPayment,
  type TestPaymentBinding,
} from "../src/stripe-observer.server";
import { buildQuote } from "./fixtures";

// Pins the observable behaviour of the three functions Wave 5A split, including
// every rejection reason string and its position in the evaluation order. A
// split that reorders or merges two checks changes one of these expectations.

const HASH = "a".repeat(64);

// ---- admission-policy: decideCanonicalAdmission -> validate ------------------

const quote: FrozenQuote = buildQuote({
  id: "quote",
  acceptanceDeadlineSeconds: 151,
  deliveryDeadlineSeconds: 152,
  reviewDeadlineSeconds: 153,
  resolutionDeadlineSeconds: 154,
});
const authorization: PaymentAuthorization = {
  id: "auth-1",
  quoteId: quote.id,
  quoteVersion: quote.version,
  buyerAccountId: quote.buyerAccountId,
  amountMinor: quote.amountMinor,
  currency: quote.currency,
  usableFrom: 100_000,
  usableUntil: 200_000,
  captureBeforeMs: 200_000,
  source: "payment-observer",
  status: "authorized",
  providerReceiptFingerprint: HASH,
};
const observation: ObservedDeployment = {
  ...quote,
  id: "observation-1",
  quoteId: quote.id,
  quoteVersion: quote.version,
  observationVersion: 2,
  source: "chain-observer",
  network: quote.network,
  nonce: quote.nonce,
  address: "1".repeat(64),
  phase: "DEPLOYED",
  revision: 0,
  termsCommitment: HASH,
  artifactFingerprint: HASH,
  keySetFingerprint: HASH,
  rolesFingerprint: quote.rolesFingerprint,
  initialStateFingerprint: quote.initialStateFingerprint,
  genesisHash: HASH,
  entrypoints: REQUIRED_ENTRYPOINTS,
  maintenancePolicy: "locked",
  maintenanceReceiptFingerprint: HASH,
  blockHash: HASH,
  blockHeight: 32,
  stateFingerprint: HASH,
  observedAt: 150_000,
  acceptanceDeadlineSeconds: quote.acceptanceDeadlineSeconds,
  deliveryDeadlineSeconds: quote.deliveryDeadlineSeconds,
  reviewDeadlineSeconds: quote.reviewDeadlineSeconds,
  resolutionDeadlineSeconds: quote.resolutionDeadlineSeconds,
};
const input = {
  quoteId: quote.id,
  observationId: observation.id,
  authorizationId: authorization.id,
  address: observation.address,
};

interface Override {
  account?: string;
  now?: number;
  frozenQuote?: FrozenQuote;
  observed?: ObservedDeployment;
  auth?: PaymentAuthorization;
  timingPolicy?: unknown;
  mismatchedQuoteId?: boolean;
  input?: BindAdmissionInput;
  quoteId?: string;
  bindings?: Partial<Record<"nonce" | "address" | "quote", AdmissionBinding>>;
}

function store(overrides: Override = {}) {
  return {
    transact<T>(operation: (tx: AdmissionTransaction) => T): T {
      const conflict: AdmissionBinding = {
        network: quote.network,
        nonce: quote.nonce,
        address: input.address,
        quoteId: quote.id,
        observationId: observation.id,
        authorizationId: authorization.id,
        boundAt: 0,
      };
      return operation({
        authenticatedAccountId: () =>
          Object.hasOwn(overrides, "account")
            ? overrides.account
            : quote.buyerAccountId,
        serverNow: () => overrides.now ?? 150_000,
        getFrozenQuote: (id: string) =>
          overrides.mismatchedQuoteId
            ? (overrides.frozenQuote ?? quote)
            : (overrides.frozenQuote ?? quote).id === id
              ? (overrides.frozenQuote ?? quote)
              : undefined,
        getCurrentPaymentAuthorization: () => overrides.auth ?? authorization,
        getObservedDeployment: () => overrides.observed ?? observation,
        getAdmissionTimingPolicy: () =>
          (Object.hasOwn(overrides, "timingPolicy")
            ? overrides.timingPolicy
            : { captureSafetyMarginMs: 1_000 }) as
            | AdmissionTimingPolicy
            | undefined,
        getBinding: () => overrides.bindings?.nonce ?? undefined,
        getBindingByAddress: () => overrides.bindings?.address ?? undefined,
        getBindingByQuote: () => overrides.bindings?.quote ?? undefined,
        insertBinding: () => undefined,
      });
    },
  };
}

function reasonOf(result: ReturnType<typeof decideCanonicalAdmission>) {
  return result.kind === "rejected" ? result.reason : `<${result.kind}>`;
}

describe("admission validate: every rejection reason, in evaluation order", () => {
  test("the unmodified baseline binds", () => {
    expect(decideCanonicalAdmission(store(), input).kind).toBe("bound");
  });

  test("one case per reason string, each reachable on its own", () => {
    const cases: [Override, string][] = [
      [{ account: "  " }, "authenticated buyer is required"],
      [{ account: undefined }, "authenticated buyer is required"],
      [{ now: 150.5 }, "server clock is invalid"],
      [{ now: -1 }, "server clock is invalid"],
      [
        { input: { ...input, address: "not-hex" } },
        "contract address is malformed",
      ],
      [{ frozenQuote: { ...quote, network: "" } }, "frozen quote is invalid"],
      [
        { frozenQuote: { ...quote, currency: "EUR" } },
        "frozen quote is invalid",
      ],
      [{ frozenQuote: { ...quote, version: 0 } }, "frozen quote is invalid"],
      [
        { frozenQuote: { ...quote, termsCommitment: "short" } },
        "frozen quote is invalid",
      ],
      [
        { quoteId: "other-quote", mismatchedQuoteId: true },
        "frozen quote identity does not match requested quote",
      ],
      [{ account: "other" }, "authenticated account is not the quote buyer"],
      [
        {
          auth: { ...authorization, status: "pending" } as PaymentAuthorization,
        },
        "payment authorization is not bound to the exact frozen quote",
      ],
      [
        { auth: { ...authorization, id: "other-auth" } },
        "payment authorization is not bound to the exact frozen quote",
      ],
      [
        { auth: { ...authorization, amountMinor: 1 } },
        "payment authorization is not bound to the exact frozen quote",
      ],
      [
        { auth: { ...authorization, captureBeforeMs: 0 } },
        "payment authorization is not bound to the exact frozen quote",
      ],
      [
        { now: 99_999 },
        "independent payment authorization window is not active",
      ],
      [
        { now: 200_000 },
        "independent payment authorization window is not active",
      ],
      [
        { now: 200_001 },
        "independent payment authorization window is not active",
      ],
      [
        { timingPolicy: { captureSafetyMarginMs: 0 } },
        "server admission timing policy is invalid",
      ],
      [{ now: 151_000 }, "acceptance deadline has expired"],
      [
        {
          auth: {
            ...authorization,
            captureBeforeMs: 154_500,
            usableUntil: 154_500,
          },
        },
        "payment authorization expires before the required resolution window",
      ],
      [
        { observed: { ...observation, observationVersion: 1 as 2 } },
        "observed deployment identity does not match frozen quote",
      ],
      [
        { observed: { ...observation, nonce: "9".repeat(64) } },
        "observed deployment identity does not match frozen quote",
      ],
      [
        { observed: { ...observation, network: "mainnet" } },
        "observed deployment identity does not match frozen quote",
      ],
      [
        { observed: { ...observation, observedAt: 150_000 + 30_001 } },
        "deployment observation is not fresh",
      ],
      [
        { observed: { ...observation, termsCommitment: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, artifactFingerprint: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, keySetFingerprint: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, rolesFingerprint: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        {
          observed: { ...observation, initialStateFingerprint: "b".repeat(64) },
        },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, genesisHash: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, constructorVersion: 2 as 1 } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, buyerCommitment: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, merchantCommitment: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        { observed: { ...observation, operatorCommitment: "b".repeat(64) } },
        "observed deployment does not match approved quote policy",
      ],
      [
        // Deadline drift breaks validObserved's ordering check first, so it is
        // reported as an identity mismatch, not a policy mismatch.
        { observed: { ...observation, acceptanceDeadlineSeconds: 155 } },
        "observed deployment identity does not match frozen quote",
      ],
      [
        { observed: { ...observation, deliveryDeadlineSeconds: 155 } },
        "observed deployment identity does not match frozen quote",
      ],
      [
        { observed: { ...observation, reviewDeadlineSeconds: 155 } },
        "observed deployment identity does not match frozen quote",
      ],
      [
        // 151/152/153/155 is still strictly increasing, so this one reaches the
        // policy comparison; the other three break validObserved's ordering.
        { observed: { ...observation, resolutionDeadlineSeconds: 155 } },
        "observed deployment does not match approved quote policy",
      ],
      [
        {
          observed: {
            ...observation,
            entrypoints: REQUIRED_ENTRYPOINTS.slice(0, -1),
          },
        },
        "observed deployment bootstrap policy is incomplete",
      ],
      [
        {
          observed: {
            ...observation,
            entrypoints: [...REQUIRED_ENTRYPOINTS.slice(0, -1), "extra"],
          },
        },
        "observed deployment bootstrap policy is incomplete",
      ],
      [
        { observed: { ...observation, phase: "REVOKED" as "DEPLOYED" } },
        "observed deployment bootstrap policy is incomplete",
      ],
      [
        { observed: { ...observation, revision: 1 as 0 } },
        "observed deployment bootstrap policy is incomplete",
      ],
      [
        { observed: { ...observation, maintenancePolicy: "open" as "locked" } },
        "observed deployment bootstrap policy is incomplete",
      ],
    ];
    for (const [index, [overrides, expected]] of cases.entries()) {
      const useInput: BindAdmissionInput =
        overrides.input ??
        (overrides.quoteId === undefined
          ? input
          : { ...input, quoteId: String(overrides.quoteId) });
      expect({
        index,
        expected,
        actual: reasonOf(decideCanonicalAdmission(store(overrides), useInput)),
      }).toMatchObject({ expected, actual: expected });
    }
  });

  test("earlier checks win when several would fail at once", () => {
    expect(
      reasonOf(
        decideCanonicalAdmission(
          store({ account: "other", now: 151_000, timingPolicy: null }),
          input,
        ),
      ),
    ).toBe("authenticated account is not the quote buyer");
    expect(
      reasonOf(
        decideCanonicalAdmission(
          store({
            now: 151_000,
            auth: {
              ...authorization,
              status: "voided",
            } as PaymentAuthorization,
          }),
          input,
        ),
      ),
    ).toBe("payment authorization is not bound to the exact frozen quote");
    expect(
      reasonOf(
        decideCanonicalAdmission(
          store({
            observed: {
              ...observation,
              revision: 1 as 0,
              nonce: "9".repeat(64),
            },
          }),
          input,
        ),
      ),
    ).toBe("observed deployment identity does not match frozen quote");
    expect(
      reasonOf(
        decideCanonicalAdmission(
          store({ timingPolicy: { captureSafetyMarginMs: 0 }, now: 151_000 }),
          input,
        ),
      ),
    ).toBe("server admission timing policy is invalid");
  });

  test("observation freshness rejects an old and a future-dated record alike", () => {
    // Deadlines far past `now`, so staleness is reached before acceptance expiry.
    const lateQuote: FrozenQuote = buildQuote({
      ...quote,
      acceptanceDeadlineSeconds: 9_000,
      deliveryDeadlineSeconds: 9_100,
      reviewDeadlineSeconds: 9_200,
      resolutionDeadlineSeconds: 9_300,
    });
    // Derived from lateQuote so every policy field matches; only observedAt varies.
    const lateObservation: ObservedDeployment = {
      ...lateQuote,
      id: "observation-1",
      quoteId: lateQuote.id,
      quoteVersion: lateQuote.version,
      observationVersion: 2,
      source: "chain-observer",
      address: "1".repeat(64),
      phase: "DEPLOYED",
      revision: 0,
      entrypoints: REQUIRED_ENTRYPOINTS,
      maintenancePolicy: "locked",
      maintenanceReceiptFingerprint: HASH,
      blockHash: HASH,
      blockHeight: 32,
      stateFingerprint: HASH,
      observedAt: 150_000,
    };
    const at = (observedAt: number, now: number) =>
      decideCanonicalAdmission(
        store({
          now,
          frozenQuote: lateQuote,
          auth: {
            ...authorization,
            usableFrom: 0,
            usableUntil: Number.MAX_SAFE_INTEGER,
            captureBeforeMs: Number.MAX_SAFE_INTEGER,
          },
          observed: { ...lateObservation, observedAt },
        }),
        input,
      ).kind;
    const fresh = (observedAt: number, now: number) =>
      at(observedAt, now) === "bound";
    expect(fresh(0, 300_000)).toBe(true);
    expect(fresh(0, 300_001)).toBe(false);
    expect(fresh(120_000, 150_000)).toBe(true);
    expect(fresh(150_000, 450_000)).toBe(true);
    expect(fresh(150_000, 450_001)).toBe(false);
    expect(fresh(180_000, 150_000)).toBe(true);
    expect(fresh(180_001, 150_000)).toBe(false);
    expect(at(-1, 150_000)).toBe("rejected");
  });

  test("acceptance deadline boundary is exclusive, resolution window inclusive", () => {
    expect(decideCanonicalAdmission(store({ now: 150_999 }), input).kind).toBe(
      "bound",
    );
    expect(
      decideCanonicalAdmission(
        store({
          auth: {
            ...authorization,
            captureBeforeMs: 155_001,
            usableUntil: 155_001,
          },
        }),
        input,
      ).kind,
    ).toBe("bound");
    expect(
      reasonOf(
        decideCanonicalAdmission(
          store({
            auth: {
              ...authorization,
              captureBeforeMs: 155_000,
              usableUntil: 155_000,
            },
          }),
          input,
        ),
      ),
    ).toBe(
      "payment authorization expires before the required resolution window",
    );
  });

  test("a matching existing binding is already-bound, a conflicting one rejects", () => {
    const bound = decideCanonicalAdmission(store(), input);
    if (bound.kind !== "bound") throw new Error("baseline must bind");
    for (const key of ["nonce", "address", "quote"] as const) {
      expect(
        decideCanonicalAdmission(
          store({ bindings: { [key]: bound.binding } }),
          input,
        ).kind,
      ).toBe("already-bound");
      expect(
        reasonOf(
          decideCanonicalAdmission(
            store({
              bindings: { [key]: { ...bound.binding, quoteId: "other-quote" } },
            }),
            input,
          ),
        ),
      ).toBe("canonical quote, nonce, or address is already bound");
    }
  });
});

// ---- stripe-observer: normalizeTestPayment ----------------------------------

const observedAt = 1_800_000_000_000;
const binding: TestPaymentBinding = {
  id: "authorization1",
  quoteId: "quote1",
  quoteVersion: 1,
  buyerAccountId: "buyer1",
  stripeAccountId: "acct_testfixture",
  stripeCustomerId: "cus_testfixture",
  stripePaymentIntentId: "pi_testfixture",
  amountMinor: 1200,
  currency: "USD",
  environment: "test",
  network: "preprod",
};

function intentFixture(): Stripe.PaymentIntent {
  return {
    id: binding.stripePaymentIntentId,
    livemode: false,
    amount: 1200,
    currency: "usd",
    customer: binding.stripeCustomerId,
    capture_method: "manual",
    status: "requires_capture",
    amount_capturable: 1200,
    amount_received: 0,
    latest_charge: {
      id: "ch_testfixture",
      livemode: false,
      payment_intent: binding.stripePaymentIntentId,
      customer: binding.stripeCustomerId,
      amount: 1200,
      currency: "usd",
      status: "succeeded",
      paid: true,
      captured: false,
      amount_captured: 0,
      refunded: false,
      amount_refunded: 0,
      disputed: false,
      payment_method_details: {
        type: "card",
        card: { capture_before: observedAt / 1000 + 600 },
      },
    },
  } as Stripe.PaymentIntent;
}

function statusOf(
  result: ReturnType<typeof normalizeTestPayment>,
): PaymentAuthorization["status"] | false {
  return result.kind === "observed" ? result.authorization.status : false;
}
function windowOf(
  result: ReturnType<typeof normalizeTestPayment>,
): number | false {
  return result.kind === "observed" ? result.authorization.usableUntil : false;
}
function reasonOfPayment(
  result: ReturnType<typeof normalizeTestPayment>,
): string | undefined {
  return result.kind === "blocked" ? result.reason : undefined;
}

describe("normalizeTestPayment: exact authorization produced per provider state", () => {
  test("authorized hold: full field-by-field shape and fingerprint stability", () => {
    const result = normalizeTestPayment(intentFixture(), binding, observedAt);
    if (result.kind !== "observed") throw new Error("expected observed");
    expect(result.authorization).toEqual({
      id: binding.id,
      quoteId: binding.quoteId,
      quoteVersion: binding.quoteVersion,
      buyerAccountId: binding.buyerAccountId,
      amountMinor: binding.amountMinor,
      currency: binding.currency,
      usableFrom: observedAt,
      usableUntil: observedAt + 60_000,
      captureBeforeMs: observedAt + 600_000,
      source: "payment-observer",
      status: "authorized",
      providerReceiptFingerprint:
        result.authorization.providerReceiptFingerprint,
    });
    expect(normalizeTestPayment(intentFixture(), binding, observedAt)).toEqual(
      result,
    );
  });

  test("every blocked reason string, one reachable case each", () => {
    const chargeWith = (patch: Record<string, unknown>) => {
      const intent = intentFixture();
      intent.latest_charge = {
        ...(intent.latest_charge as Stripe.Charge),
        ...patch,
      } as Stripe.Charge;
      return intent;
    };
    const intentWith = (patch: Record<string, unknown>) =>
      ({ ...intentFixture(), ...patch }) as Stripe.PaymentIntent;
    const bindingWith = (patch: Partial<TestPaymentBinding>) =>
      ({ ...binding, ...patch }) as TestPaymentBinding;

    expect(
      reasonOfPayment(
        normalizeTestPayment(
          intentFixture(),
          bindingWith({ environment: "live" as "test" }),
          observedAt,
        ),
      ),
    ).toBe("Invalid test payment binding or clock");
    expect(
      reasonOfPayment(normalizeTestPayment(intentFixture(), binding, -1)),
    ).toBe("Invalid test payment binding or clock");
    expect(
      reasonOfPayment(normalizeTestPayment(intentFixture(), binding, 1.5)),
    ).toBe("Invalid test payment binding or clock");
    expect(
      reasonOfPayment(
        normalizeTestPayment(intentFixture(), binding, Number.NaN),
      ),
    ).toBe("Invalid test payment binding or clock");
    expect(
      reasonOfPayment(
        normalizeTestPayment(intentFixture(), binding, Number.MAX_SAFE_INTEGER),
      ),
    ).toBe("Invalid test payment binding or clock");
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          intentWith({ livemode: true }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Stripe intent does not match immutable test binding");
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          intentWith({ capture_method: "automatic" }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Stripe intent does not match immutable test binding");
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          intentWith({ latest_charge: "ch_unexpanded" }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Expanded charge required");
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          chargeWith({ livemode: true }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Stripe charge does not match immutable test binding");
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          chargeWith({ payment_intent: "pi_another" }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Stripe charge does not match immutable test binding");
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          chargeWith({ currency: "eur" }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Stripe charge does not match immutable test binding");
    expect(
      reasonOfPayment(
        normalizeTestPayment(chargeWith({ paid: false }), binding, observedAt),
      ),
    ).toBe(
      "Full manual card authorization and provider capture expiry required",
    );
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          chargeWith({
            payment_method_details: { type: "us_bank_account" },
          }),
          binding,
          observedAt,
        ),
      ),
    ).toBe(
      "Full manual card authorization and provider capture expiry required",
    );
    expect(
      reasonOfPayment(
        normalizeTestPayment(
          intentWith({ status: "succeeded", amount_received: 1200 }),
          binding,
          observedAt,
        ),
      ),
    ).toBe("Captured payment needs independent refund/dispute reconciliation");
    for (const provider of [
      "requires_refund",
      "partially_funded",
      "unknown",
      "",
    ] as const)
      expect(
        reasonOfPayment(
          normalizeTestPayment(
            intentWith({ status: provider as Stripe.PaymentIntent["status"] }),
            binding,
            observedAt,
          ),
        ),
      ).toBe("Unsupported Stripe payment state");
  });

  test("status mapping is exhaustive over the provider vocabulary", () => {
    const cases: [string, PaymentAuthorization["status"]][] = [
      ["requires_capture", "authorized"],
      ["processing", "pending"],
      ["requires_action", "pending"],
      ["requires_confirmation", "pending"],
      ["requires_payment_method", "pending"],
      ["canceled", "voided"],
    ];
    for (const [provider, expected] of cases) {
      const intent = intentFixture();
      intent.status = provider as Stripe.PaymentIntent["status"];
      intent.latest_charge =
        provider === "requires_capture" ? intent.latest_charge : null;
      expect(statusOf(normalizeTestPayment(intent, binding, observedAt))).toBe(
        expected,
      );
    }
    const withError = (
      provider: string,
      expected: PaymentAuthorization["status"],
    ) => {
      const intent = intentFixture();
      intent.status = provider as Stripe.PaymentIntent["status"];
      intent.latest_charge = null;
      intent.last_payment_error = { type: "card_error" } as never;
      expect(statusOf(normalizeTestPayment(intent, binding, observedAt))).toBe(
        expected,
      );
    };
    withError("requires_payment_method", "failed");
    withError("processing", "pending");
    withError("requires_action", "pending");
    withError("requires_confirmation", "pending");
    withError("canceled", "voided");
    const succeeded = intentFixture();
    succeeded.status = "succeeded";
    succeeded.amount_received = 1200;
    const captured = succeeded.latest_charge as Stripe.Charge;
    captured.captured = true;
    captured.amount_captured = 1200;
    const capturedResult = normalizeTestPayment(succeeded, binding, observedAt);
    expect(
      capturedResult.kind === "observed" && capturedResult.authorization.status,
    ).toBe("captured");
    expect(
      capturedResult.kind === "observed" &&
        capturedResult.authorization.usableUntil,
    ).toBe(observedAt);
  });

  test("provider capture expiry drives both the authorized/failed split and the window clamp", () => {
    const atExpiry = normalizeTestPayment(
      intentFixture(),
      binding,
      observedAt + 600_000,
    );
    expect(atExpiry.kind === "observed" && atExpiry.authorization.status).toBe(
      "failed",
    );
    expect(
      atExpiry.kind === "observed" && atExpiry.authorization.usableUntil,
    ).toBe(observedAt + 600_000);
    const nearlyExpired = normalizeTestPayment(
      intentFixture(),
      binding,
      observedAt + 590_000,
    );
    expect(
      nearlyExpired.kind === "observed" &&
        nearlyExpired.authorization.usableUntil,
    ).toBe(observedAt + 600_000);
    expect(
      nearlyExpired.kind === "observed" &&
        nearlyExpired.authorization.usableFrom,
    ).toBe(observedAt + 590_000);
    const longHold = normalizeTestPayment(
      intentFixture(),
      binding,
      observedAt + 30_000,
    );
    expect(
      longHold.kind === "observed" && longHold.authorization.usableFrom,
    ).toBe(observedAt + 30_000);
    expect(
      longHold.kind === "observed" && longHold.authorization.usableUntil,
    ).toBe(observedAt + 90_000);
    const shortHold = normalizeTestPayment(
      intentFixture(),
      binding,
      observedAt - 20_000,
    );
    expect(
      shortHold.kind === "observed" && shortHold.authorization.usableUntil,
    ).toBe(observedAt + 40_000);
  });

  test("a non-card or absent charge never authorizes a hold", () => {
    for (const charge of [
      null,
      {
        ...(intentFixture().latest_charge as Stripe.Charge),
        status: "pending" as const,
      },
    ]) {
      const intent = intentFixture();
      intent.latest_charge = charge as never;
      expect(normalizeTestPayment(intent, binding, observedAt).kind).toBe(
        "blocked",
      );
    }
  });
});
// ---- convex/provisioning: requestPaymentJob --------------------------------

// Explicit transaction/provider doubles, same shape as provisioning.test.ts.
function jobFixture() {
  const now = Date.now();
  const quote = buildQuote({
    _id: "approved",
    _creationTime: now,
    id: "quote",
    scopeId: "scope",
    amountMinor: 1200,
    buyerAccountId: "buyer",
    expiresAt: now + 300_000,
    acceptanceDeadlineSeconds: Math.floor(now / 1000) + 600,
    deliveryDeadlineSeconds: Math.floor(now / 1000) + 1200,
    reviewDeadlineSeconds: Math.floor(now / 1000) + 1800,
    resolutionDeadlineSeconds: Math.floor(now / 1000) + 2400,
  });
  const tables: Record<string, Record<string, unknown>[]> = {
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
      insert: async (table: string, row: Record<string, unknown>) => {
        const _id = `${table}-${++serial}`;
        tables[table].push({ ...row, _id, _creationTime: now });
        return _id;
      },
      patch: async (id: string, patch: Record<string, unknown>) =>
        Object.assign(get(id) ?? {}, patch),
    },
  } as unknown as AdmissionContext;
  return {
    ctx,
    tables,
    scheduled,
    identity: (value: typeof identity) => {
      identity = value;
    },
  };
}

type JobRow = Record<string, unknown>;
type JobId = string;
type JobMutation = {
  _handler: (ctx: AdmissionContext, args: JobRow) => Promise<JobId>;
};
const requestCreate = (requestPayment as unknown as JobMutation)._handler;
const requestObserve = (requestObservation as unknown as JobMutation)._handler;
const createConsent = {
  quoteId: "quote",
  expectedVersion: 1,
  consent: "create-test-payment",
};
const observeConsent = { ...createConsent, consent: "observe-test-payment" };

async function frozen() {
  const db = jobFixture();
  const { freezeApprovedQuote } = await import("../../../convex/provisioning");
  await freezeApprovedQuote(db.ctx, { quoteId: "quote", expectedVersion: 1 });
  return db;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
    return "<resolved>";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("requestPaymentJob: rejection reason and lease-reuse shape", () => {
  test("create consent queues a fresh job and schedules the provider action", async () => {
    const db = await frozen();
    const jobId = await requestCreate(db.ctx, createConsent);
    expect(db.tables.paymentJobs).toHaveLength(1);
    expect(db.tables.paymentJobs[0]).toMatchObject({
      quoteId: "quote",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      consentSubject: "did:privy:buyer",
      generation: 1,
      mode: "create",
      state: "queued",
    });
    expect(db.tables.paymentJobs[0].startedAt).toBe(
      db.tables.paymentJobs[0].consentAt,
    );
    expect(db.scheduled).toHaveLength(1);
    expect(db.scheduled[0]).toEqual([
      0,
      { [Symbol.for("functionName")]: "stripeProvisioning:run" },
      { jobId, generation: 1 },
    ]);
  });

  test("one rejection message per guard, each reachable on its own", async () => {
    expect(
      await rejection(requestObserve((await frozen()).ctx, observeConsent)),
    ).toBe("Existing immutable payment required for observation");

    const anonymous = await frozen();
    anonymous.identity(null);
    expect(await rejection(requestCreate(anonymous.ctx, createConsent))).toBe(
      "Authenticated Privy identity required",
    );

    const wrongVersion = await frozen();
    expect(
      await rejection(
        requestCreate(wrongVersion.ctx, {
          ...createConsent,
          expectedVersion: 9,
        }),
      ),
    ).toBe("Frozen quote version required");

    const noQuote = jobFixture();
    expect(
      await rejection(
        requestCreate(noQuote.ctx, { ...createConsent, quoteId: "missing" }),
      ),
    ).toBe("Frozen quote version required");

    const otherBuyer = await frozen();
    otherBuyer.tables.memberships[0].accountId = "someone-else";
    expect(await rejection(requestCreate(otherBuyer.ctx, createConsent))).toBe(
      "Quote buyer required",
    );

    const revoked = await frozen();
    revoked.tables.memberships[0].status = "revoked";
    expect(await rejection(requestCreate(revoked.ctx, createConsent))).toBe(
      "Active membership required",
    );

    const notBuyer = await frozen();
    notBuyer.tables.memberships[0].role = "merchant";
    expect(await rejection(requestCreate(notBuyer.ctx, createConsent))).toBe(
      "Quote buyer required",
    );

    const noCustomer = await frozen();
    noCustomer.tables.stripeCustomers.length = 0;
    expect(await rejection(requestCreate(noCustomer.ctx, createConsent))).toBe(
      "Trusted Stripe customer binding required",
    );

    const expired = await frozen();
    expired.tables.frozenQuotes[0].acceptanceDeadlineSeconds =
      Math.floor(Date.now() / 1000) - 1;
    expect(await rejection(requestCreate(expired.ctx, createConsent))).toBe(
      "Quote expired",
    );

    const revoking = await frozen();
    revoking.tables.trustedProvisioning.push({
      _id: "revoked",
      kind: "quote",
      key: "quote",
      status: "revoked",
    });
    expect(await rejection(requestCreate(revoking.ctx, createConsent))).toBe(
      "Trusted provisioning revoked",
    );

    const revokingCustomer = await frozen();
    revokingCustomer.tables.trustedProvisioning.push({
      _id: "revoked",
      kind: "customer",
      key: "buyer",
      status: "revoked",
    });
    expect(
      await rejection(requestCreate(revokingCustomer.ctx, createConsent)),
    ).toBe("Trusted provisioning revoked");
    expect(revokingCustomer.tables.paymentJobs).toHaveLength(0);
  });

  test("monitor and payment-binding guards reject before any job row is written", async () => {
    const monitored = await frozen();
    monitored.tables.paymentMonitors.push({
      _id: "monitor",
      quoteId: "quote",
      state: "running",
      expiresAt: Date.now() + 60_000,
    });
    expect(await rejection(requestCreate(monitored.ctx, createConsent))).toBe(
      "Stop monitoring before requesting a payment job",
    );
    expect(monitored.tables.paymentJobs).toHaveLength(0);

    const stopped = await frozen();
    stopped.tables.paymentMonitors.push({
      _id: "monitor",
      quoteId: "quote",
      state: "stopped",
      expiresAt: Date.now() + 60_000,
    });
    const stoppedId = await requestCreate(stopped.ctx, createConsent);
    expect(stopped.tables.paymentJobs[0]._id).toBe(stoppedId);

    const lapsedMonitor = await frozen();
    lapsedMonitor.tables.paymentMonitors.push({
      _id: "monitor",
      quoteId: "quote",
      state: "running",
      expiresAt: Date.now() - 1,
    });
    expect(
      (await requestCreate(lapsedMonitor.ctx, createConsent)) ===
        lapsedMonitor.tables.paymentJobs[0]._id,
    ).toBe(true);

    for (const patch of [
      { amountMinor: 1 },
      { stripeAccountId: "acct_other" },
      { stripeCustomerId: "cus_other" },
      { environment: "live" },
      { network: "mainnet" },
    ]) {
      const db = await frozen();
      db.tables.paymentIntents.push({
        _id: "payment",
        quoteId: "quote",
        quoteVersion: 1,
        buyerAccountId: "buyer",
        amountMinor: 1200,
        currency: "USD",
        network: "preprod",
        environment: "test",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripePaymentIntentId: "pi_test",
        ...patch,
      });
      expect(await rejection(requestObserve(db.ctx, observeConsent))).toBe(
        "Immutable payment binding mismatch",
      );
      expect(db.tables.paymentJobs).toHaveLength(0);
    }
  });

  test("a creation job inside its lease blocks an observation request", async () => {
    const db = await frozen();
    const jobId = await requestCreate(db.ctx, createConsent);
    expect(db.tables.paymentJobs[0].mode).toBe("create");
    db.tables.paymentIntents.push({
      _id: "payment",
      quoteId: "quote",
      quoteVersion: 1,
      buyerAccountId: "buyer",
      amountMinor: 1200,
      currency: "USD",
      network: "preprod",
      environment: "test",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripePaymentIntentId: "pi_test",
    });
    db.tables.paymentJobs[0].state = "running";
    db.tables.paymentJobs[0].startedAt = Date.now();
    expect(await rejection(requestObserve(db.ctx, observeConsent))).toBe(
      "Creation job must finish before observation",
    );
    expect(db.tables.paymentJobs).toHaveLength(1);
    expect(db.tables.paymentJobs[0].generation).toBe(1);
    expect(db.tables.paymentJobs[0]._id).toBe(jobId);

    db.tables.paymentJobs[0].startedAt = Date.now() - 61_000;
    await requestObserve(db.ctx, observeConsent);
    expect(db.tables.paymentJobs).toHaveLength(1);
    expect(db.tables.paymentJobs[0].generation).toBe(2);
    expect(db.tables.paymentJobs[0].mode).toBe("observe");
    expect(db.scheduled).toHaveLength(2);
  });

  test("an observe job inside its lease is reused by both consent kinds", async () => {
    const db = await frozen();
    db.tables.paymentIntents.push({
      _id: "payment",
      quoteId: "quote",
      quoteVersion: 1,
      buyerAccountId: "buyer",
      amountMinor: 1200,
      currency: "USD",
      network: "preprod",
      environment: "test",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripePaymentIntentId: "pi_test",
    });
    const jobId = await requestCreate(db.ctx, createConsent);
    expect(db.tables.paymentJobs[0].mode).toBe("observe");
    db.tables.paymentJobs[0].state = "queued";
    db.tables.paymentJobs[0].startedAt = Date.now();
    expect(await requestCreate(db.ctx, createConsent)).toBe(jobId);
    expect(await requestObserve(db.ctx, observeConsent)).toBe(jobId);
    expect(db.tables.paymentJobs).toHaveLength(1);
    expect(db.tables.paymentJobs[0].generation).toBe(1);
    expect(db.scheduled).toHaveLength(1);
  });

  test("a job outside its lease, or with a broken clock, is replaced or rejected", async () => {
    const fresh = await frozen();
    const jobId = await requestCreate(fresh.ctx, createConsent);
    for (const clock of [
      { generation: 0 },
      { generation: 1.5 },
      { startedAt: -1 },
      { startedAt: Date.now() + 60_000 },
      { firstAttemptAt: -1 },
      { firstAttemptAt: Date.now() + 60_000 },
    ]) {
      Object.assign(fresh.tables.paymentJobs[0], clock);
      expect(await rejection(requestCreate(fresh.ctx, createConsent))).toBe(
        "Invalid provisioning job clock",
      );
    }
    fresh.tables.paymentJobs[0].generation = 1;
    fresh.tables.paymentJobs[0].startedAt = Date.now();
    delete fresh.tables.paymentJobs[0].firstAttemptAt;
    fresh.tables.paymentJobs[0].startedAt = Date.now() - 61_000;
    await requestCreate(fresh.ctx, createConsent);
    expect(fresh.tables.paymentJobs[0].generation).toBe(2);
    expect(fresh.tables.paymentJobs[0]._id).toBe(jobId);
  });

  test("customer rebinding on an existing job is refused", async () => {
    const db = await frozen();
    await requestCreate(db.ctx, createConsent);
    db.tables.stripeCustomers[0].stripeCustomerId = "cus_rotated";
    expect(await rejection(requestCreate(db.ctx, createConsent))).toBe(
      "Immutable customer binding changed",
    );
  });

  test("an existing payment makes a create request observe instead", async () => {
    const db = await frozen();
    db.tables.paymentIntents.push({
      _id: "payment",
      quoteId: "quote",
      quoteVersion: 1,
      buyerAccountId: "buyer",
      amountMinor: 1200,
      currency: "USD",
      network: "preprod",
      environment: "test",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripePaymentIntentId: "pi_test",
    });
    const jobId = await requestCreate(db.ctx, createConsent);
    expect(db.tables.paymentJobs[0].mode).toBe("observe");
    expect(String(db.tables.paymentJobs[0]._id)).toBe(jobId);
  });
});
