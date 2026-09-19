import { describe, expect, test } from "bun:test";
import {
  type AdmissionBinding,
  type AdmissionTimingPolicy,
  type AdmissionTransaction,
  decideCanonicalAdmission,
  type FrozenQuote,
  type ObservedDeployment,
  type PaymentAuthorization,
  REQUIRED_ENTRYPOINTS,
} from "../src/admission-policy";
import { publicConstructorFingerprints } from "../src/public-constructor.mjs";
import { buildQuote } from "./fixtures";

const hash = "a".repeat(64);
const quote: FrozenQuote = buildQuote({
  scopeId: undefined,
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
  providerReceiptFingerprint: hash,
};
const observation: ObservedDeployment = {
  ...quote,
  id: "observation-1",
  observationVersion: 2,
  source: "chain-observer",
  network: quote.network,
  nonce: quote.nonce,
  address: "1".repeat(64),
  phase: "DEPLOYED",
  revision: 0,
  termsCommitment: hash,
  artifactFingerprint: hash,
  keySetFingerprint: hash,
  rolesFingerprint: quote.rolesFingerprint,
  initialStateFingerprint: quote.initialStateFingerprint,
  genesisHash: hash,
  entrypoints: REQUIRED_ENTRYPOINTS,
  maintenancePolicy: "locked",
  maintenanceReceiptFingerprint: hash,
  blockHash: hash,
  blockHeight: 32,
  stateFingerprint: hash,
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

function repository(
  overrides: {
    account?: string;
    now?: number;
    frozenQuote?: FrozenQuote;
    observed?: ObservedDeployment;
    auth?: PaymentAuthorization;
    timingPolicy?: unknown;
  } = {},
) {
  const byNonce = new Map<string, AdmissionBinding>();
  const byAddress = new Map<string, AdmissionBinding>();
  const byQuote = new Map<string, AdmissionBinding>();
  return {
    transact<T>(operation: (tx: AdmissionTransaction) => T): T {
      return operation({
        authenticatedAccountId: () => overrides.account ?? quote.buyerAccountId,
        serverNow: () => overrides.now ?? 150_000,
        getFrozenQuote: (id: string) =>
          id === (overrides.frozenQuote ?? quote).id
            ? (overrides.frozenQuote ?? quote)
            : undefined,
        getCurrentPaymentAuthorization: (id: string) =>
          id === (overrides.auth ?? authorization).id
            ? (overrides.auth ?? authorization)
            : undefined,
        getObservedDeployment: (id: string) =>
          id === (overrides.observed ?? observation).id
            ? (overrides.observed ?? observation)
            : undefined,
        getAdmissionTimingPolicy: () =>
          Object.hasOwn(overrides, "timingPolicy")
            ? (overrides.timingPolicy as AdmissionTimingPolicy | undefined)
            : { captureSafetyMarginMs: 1_000 },
        getBinding: (network: string, nonce: string) =>
          byNonce.get(`${network}/${nonce}`),
        getBindingByAddress: (address: string) => byAddress.get(address),
        getBindingByQuote: (id: string) => byQuote.get(id),
        insertBinding: (binding: AdmissionBinding) => {
          byNonce.set(`${binding.network}/${binding.nonce}`, binding);
          byAddress.set(binding.address, binding);
          byQuote.set(binding.quoteId, binding);
        },
      });
    },
  };
}

describe("canonical admission decision", () => {
  test("requires exactly the original compiled proof entrypoints", async () => {
    const metadata = await Bun.file(
      new URL(
        "../../contract/generated/compiler/contract-info.json",
        import.meta.url,
      ),
    ).json();
    const circuits = metadata.circuits as { name: string; proof: boolean }[];
    const expected: string[] = [...REQUIRED_ENTRYPOINTS].sort();
    expect(expected).toEqual(
      circuits
        .filter((circuit) => circuit.proof)
        .map((circuit) => circuit.name)
        .sort(),
    );
  });
  test("binds exact trusted records and is idempotent", () => {
    const store = repository();
    expect(decideCanonicalAdmission(store, input).kind).toBe("bound");
    expect(decideCanonicalAdmission(store, input).kind).toBe("already-bound");
  });
  test("matching non-USD legacy quote and payment still cannot be admitted", () => {
    expect(
      decideCanonicalAdmission(
        repository({
          frozenQuote: { ...quote, currency: "EUR" },
          auth: { ...authorization, currency: "EUR" },
        }),
        input,
      ),
    ).toMatchObject({ kind: "rejected", reason: "frozen quote is invalid" });
  });
  test("rejects unauthenticated buyers, independent expiry, and caller-controlled fields", () => {
    expect(
      decideCanonicalAdmission(repository({ account: "other" }), input),
    ).toMatchObject({
      kind: "rejected",
      reason: "authenticated account is not the quote buyer",
    });
    expect(
      decideCanonicalAdmission(repository({ now: 201 }), input),
    ).toMatchObject({
      kind: "rejected",
      reason: "independent payment authorization window is not active",
    });
    expect(decideCanonicalAdmission(repository({ now: 200 }), input).kind).toBe(
      "rejected",
    );
    expect(() =>
      decideCanonicalAdmission(repository(), {
        ...input,
        now: 150,
      } as typeof input),
    ).toThrow("only non-empty");
    expect(() =>
      decideCanonicalAdmission(
        repository(),
        Object.assign(Object.create({ hidden: true }), input),
      ),
    ).toThrow("plain object");
  });
  test("fails closed for missing protocol policy facts", () => {
    for (const observed of [
      { ...observation, entrypoints: REQUIRED_ENTRYPOINTS.slice(0, -1) },
      {
        ...observation,
        entrypoints: [
          ...REQUIRED_ENTRYPOINTS.slice(0, -1),
          "unapprovedOperation",
        ],
      },
      { ...observation, artifactFingerprint: "b".repeat(64) },
      { ...observation, rolesFingerprint: "b".repeat(64) },
      { ...observation, initialStateFingerprint: "b".repeat(64) },
      { ...observation, genesisHash: "b".repeat(64) },
      { ...observation, blockHash: "not-a-block" },
      { ...observation, stateFingerprint: "not-a-state" },
      { ...observation, blockHeight: -1 },
      { ...observation, blockHeight: 1.5 },
      { ...observation, blockHeight: Number.MAX_SAFE_INTEGER + 1 },
      { ...observation, observationVersion: 1 as 2 },
      { ...observation, revision: 1 as 0 },
      { ...observation, observedAt: -400_000 },
      { ...observation, observedAt: 181_000 },
    ])
      expect(
        decideCanonicalAdmission(repository({ observed }), input).kind,
      ).toBe("rejected");
  });
  test("rejects legacy observations missing versioned block and state provenance", () => {
    for (const key of [
      "observationVersion",
      "blockHash",
      "blockHeight",
      "stateFingerprint",
      "acceptanceDeadlineSeconds",
      "deliveryDeadlineSeconds",
      "reviewDeadlineSeconds",
      "resolutionDeadlineSeconds",
    ] as const) {
      const missing: Partial<ObservedDeployment> = { ...observation };
      delete missing[key];
      expect(
        decideCanonicalAdmission(
          repository({ observed: missing as ObservedDeployment }),
          input,
        ).kind,
      ).toBe("rejected");
    }
  });
  test("rejects a negative observation timestamp even within the freshness window", () => {
    const store = repository({ observed: { ...observation, observedAt: -1 } });
    expect(decideCanonicalAdmission(store, input)).toMatchObject({
      kind: "rejected",
      reason: "observed deployment identity does not match frozen quote",
    });
    expect(
      store.transact((tx) => tx.getBindingByQuote(quote.id)),
    ).toBeUndefined();
    expect(
      decideCanonicalAdmission(
        repository({ observed: { ...observation, observedAt: 0 } }),
        input,
      ).kind,
    ).toBe("bound");
  });
  test("requires current authorized payment state, not only plausible receipt dates", () => {
    expect(
      decideCanonicalAdmission(
        repository({ auth: { ...authorization, status: "voided" } }),
        input,
      ),
    ).toMatchObject({
      kind: "rejected",
      reason: "payment authorization is not bound to the exact frozen quote",
    });
  });
  test("requires exact, ordered deadline attestations from the quote and observer", () => {
    const deadlineKeys = [
      "acceptanceDeadlineSeconds",
      "deliveryDeadlineSeconds",
      "reviewDeadlineSeconds",
      "resolutionDeadlineSeconds",
    ] as const;
    for (const key of deadlineKeys)
      expect(
        decideCanonicalAdmission(
          repository({
            observed: { ...observation, [key]: observation[key] + 1 },
          }),
          input,
        ).kind,
      ).toBe("rejected");
    for (const deadlines of [
      [0, 152, 153, 154],
      [-1, 152, 153, 154],
      [151, 151, 153, 154],
      [151, 153, 152, 154],
      [151, 152, 154, 153],
      [Number.MAX_SAFE_INTEGER + 1, 152, 153, 154],
    ]) {
      const [
        acceptanceDeadlineSeconds,
        deliveryDeadlineSeconds,
        reviewDeadlineSeconds,
        resolutionDeadlineSeconds,
      ] = deadlines;
      expect(
        decideCanonicalAdmission(
          repository({
            observed: {
              ...observation,
              acceptanceDeadlineSeconds,
              deliveryDeadlineSeconds,
              reviewDeadlineSeconds,
              resolutionDeadlineSeconds,
            },
          }),
          input,
        ).kind,
      ).toBe("rejected");
    }
    for (const key of deadlineKeys)
      expect(
        decideCanonicalAdmission(
          repository({
            frozenQuote: { ...quote, [key]: Number.MAX_SAFE_INTEGER + 1 },
          }),
          input,
        ).kind,
      ).toBe("rejected");
  });
  test("enforces server timing policy through the complete resolution window", () => {
    const withExpiry = (captureBeforeMs: number) => ({
      ...authorization,
      usableUntil: captureBeforeMs,
      captureBeforeMs,
    });
    expect(
      decideCanonicalAdmission(repository({ auth: withExpiry(155_001) }), input)
        .kind,
    ).toBe("bound");
    for (const captureBeforeMs of [155_000, 154_999])
      expect(
        decideCanonicalAdmission(
          repository({ auth: withExpiry(captureBeforeMs) }),
          input,
        ),
      ).toMatchObject({
        kind: "rejected",
        reason:
          "payment authorization expires before the required resolution window",
      });
    expect(
      decideCanonicalAdmission(
        repository({
          auth: {
            ...authorization,
            usableUntil: 154_500,
            captureBeforeMs: 154_500,
          },
        }),
        input,
      ).kind,
    ).toBe("rejected");
    for (const timingPolicy of [
      undefined,
      null,
      "not-a-policy",
      { captureSafetyMarginMs: 0 },
      { captureSafetyMarginMs: -1 },
      { captureSafetyMarginMs: 1.5 },
      { captureSafetyMarginMs: null },
      { captureSafetyMarginMs: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(
        decideCanonicalAdmission(repository({ timingPolicy }), input).kind,
      ).toBe("rejected");
  });
  test("rejects malformed independently observed provider expiry and usable times", () => {
    const malformed = [
      { ...authorization, captureBeforeMs: 0 },
      { ...authorization, captureBeforeMs: -1 },
      { ...authorization, captureBeforeMs: 1.5 },
      { ...authorization, captureBeforeMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...authorization, usableFrom: -1 },
      { ...authorization, usableUntil: -1 },
      { ...authorization, usableFrom: 100.5 },
      { ...authorization, usableUntil: 200.5 },
      { ...authorization, usableUntil: 200_001 },
    ];
    const missing = { ...authorization } as Partial<PaymentAuthorization>;
    delete missing.captureBeforeMs;
    for (const auth of [...malformed, missing as PaymentAuthorization])
      expect(decideCanonicalAdmission(repository({ auth }), input).kind).toBe(
        "rejected",
      );
  });
  test("uses strict acceptance boundary and cannot be overridden by callers or bindings", () => {
    expect(
      decideCanonicalAdmission(repository({ now: 150_999 }), input).kind,
    ).toBe("bound");
    expect(
      decideCanonicalAdmission(repository({ now: 151_000 }), input),
    ).toMatchObject({
      kind: "rejected",
      reason: "acceptance deadline has expired",
    });
    for (const extra of [
      { captureSafetyMarginMs: 1 },
      { captureBeforeMs: 999_999 },
    ])
      expect(() =>
        decideCanonicalAdmission(repository(), {
          ...input,
          ...extra,
        } as typeof input),
      ).toThrow("only non-empty");
    const store = repository();
    expect(decideCanonicalAdmission(store, input).kind).toBe("bound");
    expect(decideCanonicalAdmission(store, input).kind).toBe("already-bound");
    expect(decideCanonicalAdmission(store, input).kind).toBe("already-bound");
    let writes = 0;
    const noWriteStore = {
      transact<T>(operation: (tx: AdmissionTransaction) => T): T {
        return repository({
          now: -1,
          auth: { ...authorization, usableFrom: 0 },
        }).transact((tx) =>
          operation({
            ...tx,
            insertBinding: () => {
              writes += 1;
            },
          }),
        );
      },
    };
    expect(decideCanonicalAdmission(noWriteStore, input).kind).toBe("rejected");
    expect(writes).toBe(0);
    expect(
      decideCanonicalAdmission(
        repository({ now: -1, auth: { ...authorization, usableFrom: 0 } }),
        input,
      ),
    ).toMatchObject({ kind: "rejected", reason: "server clock is invalid" });
    const expiredStore = {
      transact<T>(operation: (tx: AdmissionTransaction) => T): T {
        return store.transact((tx) =>
          operation({ ...tx, serverNow: () => 151_000 }),
        );
      },
    };
    expect(decideCanonicalAdmission(expiredStore, input).kind).toBe("rejected");
  });
  test("uses bigint timing arithmetic at safe-integer deadline limits", () => {
    const resolutionDeadlineSeconds = Number.MAX_SAFE_INTEGER;
    const largeQuote = {
      ...quote,
      acceptanceDeadlineSeconds: resolutionDeadlineSeconds - 3,
      deliveryDeadlineSeconds: resolutionDeadlineSeconds - 2,
      reviewDeadlineSeconds: resolutionDeadlineSeconds - 1,
      resolutionDeadlineSeconds,
    };
    const largeObservation = {
      ...observation,
      acceptanceDeadlineSeconds: largeQuote.acceptanceDeadlineSeconds,
      deliveryDeadlineSeconds: largeQuote.deliveryDeadlineSeconds,
      reviewDeadlineSeconds: largeQuote.reviewDeadlineSeconds,
      resolutionDeadlineSeconds: largeQuote.resolutionDeadlineSeconds,
    };
    Object.assign(largeQuote, publicConstructorFingerprints(largeQuote));
    Object.assign(largeObservation, publicConstructorFingerprints(largeQuote));
    expect(
      decideCanonicalAdmission(
        repository({
          frozenQuote: largeQuote,
          observed: largeObservation,
          auth: {
            ...authorization,
            usableUntil: Number.MAX_SAFE_INTEGER,
            captureBeforeMs: Number.MAX_SAFE_INTEGER,
          },
        }),
        input,
      ),
    ).toMatchObject({
      kind: "rejected",
      reason:
        "payment authorization expires before the required resolution window",
    });
  });
  test("rejects swapped address, nonce/quote and reverse-address reuse", () => {
    expect(
      decideCanonicalAdmission(repository(), {
        ...input,
        address: "9".repeat(64),
      }).kind,
    ).toBe("rejected");
    const store = repository();
    decideCanonicalAdmission(store, input);
    expect(
      decideCanonicalAdmission(store, { ...input, authorizationId: "auth-2" })
        .kind,
    ).toBe("rejected");
  });
  test("rejects mismatched stored IDs and every conflicting canonical index", () => {
    const base = repository();
    const withPorts = (ports: Partial<AdmissionTransaction>) => ({
      transact<T>(operation: (tx: AdmissionTransaction) => T): T {
        return base.transact((tx) => operation({ ...tx, ...ports }));
      },
    });
    for (const ports of [
      { getFrozenQuote: () => ({ ...quote, id: "wrong-quote" }) },
      {
        getCurrentPaymentAuthorization: () => ({
          ...authorization,
          id: "wrong-auth",
        }),
      },
      {
        getObservedDeployment: () => ({
          ...observation,
          id: "wrong-observation",
        }),
      },
    ])
      expect(decideCanonicalAdmission(withPorts(ports), input).kind).toBe(
        "rejected",
      );
    const result = decideCanonicalAdmission(base, input);
    expect(result.kind).toBe("bound");
    if (result.kind !== "bound") throw new Error("test binding failed");
    const conflict = { ...result.binding, quoteId: "other-quote" };
    for (const ports of [
      { getBinding: () => conflict },
      { getBindingByAddress: () => conflict },
      { getBindingByQuote: () => conflict },
    ])
      expect(decideCanonicalAdmission(withPorts(ports), input).kind).toBe(
        "rejected",
      );
    expect(
      decideCanonicalAdmission(repository(), {
        ...input,
        address: "not-a-ledger-address",
      }).kind,
    ).toBe("rejected");
  });
});
