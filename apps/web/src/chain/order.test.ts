import { describe, expect, test } from "bun:test";
import {
  assertOrderConfiguration,
  assertOrderPrivateState,
  assertOrderTerms,
  capabilityCommitment,
  circuitArguments,
  ORDER_CIRCUITS,
  ORDER_PHASES,
  type OrderConfiguration,
  type OrderPrivateState,
  type OrderTerms,
  termsCommitment,
} from "./order";

const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);

const terms: OrderTerms = {
  serviceVersion: 1n,
  packQuantity: 1n,
  outputCount: 3n,
  unitPrice: 36_000n,
  total: 36_000n,
  currency: new TextEncoder().encode("USD"),
  scopeDigest: bytes32(4),
  rightsDigest: bytes32(5),
  paymentPolicy: bytes32(6),
  salt: bytes32(7),
};

const configuration: OrderConfiguration = {
  network: bytes32(0),
  orderNonce: bytes32(1),
  termsCommitment: bytes32(2),
  buyerCommitment: bytes32(3),
  merchantCommitment: bytes32(8),
  operatorCommitment: bytes32(9),
  acceptanceDeadline: 1_000n,
  deliveryDeadline: 2_000n,
  reviewDeadline: 3_000n,
  resolutionDeadline: 4_000n,
};

const privateState: OrderPrivateState = {
  actor: "buyer",
  secret: bytes32(1),
  terms,
  limit: 36_000n,
};

describe("ORDER_CIRCUITS mirrors the compiled contract", () => {
  test("lists exactly the fourteen provable circuits", () => {
    expect([...ORDER_CIRCUITS].sort()).toEqual([
      "accept",
      "approve",
      "cancelReserved",
      "decline",
      "disputeBuyer",
      "disputeMerchant",
      "escalateUnreviewed",
      "expireBootstrap",
      "expireDispute",
      "expireReserved",
      "expireUndelivered",
      "reserve",
      "resolve",
      "submitDelivery",
    ]);
  });

  test("lists the seven phases in contract order", () => {
    expect([...ORDER_PHASES]).toEqual([
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
      "APPROVED",
      "CANCELLED",
    ]);
  });
});

describe("assertOrderTerms", () => {
  test("accepts the terms the contract accepts", () => {
    expect(assertOrderTerms(terms)).toBe(terms);
  });

  test("refuses an unsupported service version", () => {
    expect(() => assertOrderTerms({ ...terms, serviceVersion: 2n })).toThrow(
      /service version/,
    );
  });

  test("refuses an unsupported pack quantity", () => {
    expect(() => assertOrderTerms({ ...terms, packQuantity: 2n })).toThrow(
      /pack quantity/,
    );
  });

  test("refuses an unsupported output count", () => {
    expect(() => assertOrderTerms({ ...terms, outputCount: 4n })).toThrow(
      /output count/,
    );
  });

  test("refuses a total that does not equal unitPrice times packQuantity", () => {
    expect(() =>
      assertOrderTerms({ ...terms, total: 1n, unitPrice: 2n }),
    ).toThrow(/total must equal/);
  });

  test("refuses an unsupported currency", () => {
    expect(() =>
      assertOrderTerms({ ...terms, currency: new TextEncoder().encode("EUR") }),
    ).toThrow(/currency/);
  });

  test("refuses a digest that is not 32 bytes", () => {
    expect(() =>
      assertOrderTerms({ ...terms, salt: new Uint8Array(31) }),
    ).toThrow(/32 bytes/);
  });

  test("refuses a negative unit price", () => {
    expect(() => assertOrderTerms({ ...terms, unitPrice: -1n })).toThrow(
      /Uint<64>/,
    );
  });
});

describe("assertOrderConfiguration", () => {
  test("accepts a well-formed configuration", () => {
    expect(assertOrderConfiguration(configuration)).toBe(configuration);
  });

  test("refuses duplicate role commitments", () => {
    expect(() =>
      assertOrderConfiguration({
        ...configuration,
        merchantCommitment: configuration.buyerCommitment,
      }),
    ).toThrow(/must differ/);
  });

  test("refuses unordered deadlines", () => {
    expect(() =>
      assertOrderConfiguration({
        ...configuration,
        deliveryDeadline: configuration.acceptanceDeadline,
      }),
    ).toThrow(/strictly increasing/);
  });

  test("refuses a zero acceptance deadline", () => {
    expect(() =>
      assertOrderConfiguration({
        ...configuration,
        acceptanceDeadline: 0n,
      }),
    ).toThrow(/strictly increasing/);
  });

  test("refuses a non-32-byte network label", () => {
    expect(() =>
      assertOrderConfiguration({
        ...configuration,
        network: new Uint8Array(31),
      }),
    ).toThrow(/32 bytes/);
  });
});

describe("assertOrderPrivateState", () => {
  test("accepts a well-formed buyer state", () => {
    expect(assertOrderPrivateState(privateState)).toBe(privateState);
  });

  test("refuses an unknown actor", () => {
    expect(() =>
      assertOrderPrivateState({ ...privateState, actor: "seller" as never }),
    ).toThrow(/buyer, merchant or operator/);
  });

  test("refuses a secret that is not 32 bytes", () => {
    expect(() =>
      assertOrderPrivateState({ ...privateState, secret: new Uint8Array(31) }),
    ).toThrow(/32 bytes/);
  });

  test("refuses a negative approval limit", () => {
    expect(() =>
      assertOrderPrivateState({ ...privateState, limit: -1n }),
    ).toThrow(/Uint<64>/);
  });
});

describe("circuitArguments matches the compiled signatures", () => {
  test("revision-only circuits take one argument", () => {
    for (const circuit of [
      "reserve",
      "accept",
      "cancelReserved",
      "decline",
      "expireBootstrap",
      "expireReserved",
      "expireUndelivered",
      "escalateUnreviewed",
      "expireDispute",
    ] as const)
      expect(circuitArguments(circuit, { expectedRevision: 3n })).toEqual([3n]);
  });

  test("submitDelivery takes the revision and a 32-byte commitment", () => {
    const commitment = bytes32(11);
    expect(
      circuitArguments("submitDelivery", {
        expectedRevision: 2n,
        commitment,
      }),
    ).toEqual([2n, commitment]);
  });

  test("approve takes the revision and the expected delivery", () => {
    const expectedDelivery = bytes32(12);
    expect(
      circuitArguments("approve", {
        expectedRevision: 3n,
        expectedDelivery,
      }),
    ).toEqual([3n, expectedDelivery]);
  });

  test("both dispute circuits take the revision and evidence", () => {
    const evidence = bytes32(13);
    for (const circuit of ["disputeBuyer", "disputeMerchant"] as const)
      expect(
        circuitArguments(circuit, { expectedRevision: 2n, evidence }),
      ).toEqual([2n, evidence]);
  });

  test("resolve takes the revision, the decision and evidence", () => {
    const evidence = bytes32(14);
    expect(
      circuitArguments("resolve", {
        expectedRevision: 4n,
        approveOrder: true,
        evidence,
      }),
    ).toEqual([4n, true, evidence]);
  });

  test("resolve refuses a missing decision", () => {
    expect(() =>
      circuitArguments("resolve", {
        expectedRevision: 4n,
        evidence: bytes32(14),
      }),
    ).toThrow(/approveOrder/);
  });

  test("refuses a commitment that is not 32 bytes", () => {
    expect(() =>
      circuitArguments("submitDelivery", {
        expectedRevision: 2n,
        commitment: new Uint8Array(31),
      }),
    ).toThrow(/32 bytes/);
  });

  // The revision bound is checked for every circuit that takes one, so one table
  // covers the low and high end of Uint<64> instead of a case per circuit.
  for (const [name, revision] of [
    ["negative", -1n],
    ["above Uint<64>", 18446744073709551616n],
  ] as const)
    test(`refuses a ${name} revision`, () => {
      expect(() =>
        circuitArguments("reserve", { expectedRevision: revision }),
      ).toThrow(/Uint<64>/);
    });
});

describe("the pure commitments", () => {
  // These run on the onchain runtime alone, so they are the one chain path the
  // quote form can reach without a wallet or the ledger wasm. Their output must
  // match what the contract computes on chain, or every quote is unprovable.
  const NETWORK = (() => {
    const value = new Uint8Array(32);
    value.set(new TextEncoder().encode("preprod"));
    return value;
  })();

  test("capabilityCommitment maps each actor to its contract role", () => {
    const nonce = bytes32(7);
    const secret = bytes32(9);
    const hashes = (["buyer", "merchant", "operator"] as const).map((actor) =>
      capabilityCommitment(NETWORK, nonce, actor, secret),
    );
    // Three distinct roles, three distinct hashes: a mis-mapped role would collide.
    expect(new Set(hashes.map((hash) => hash.toHex())).size).toBe(3);
    for (const hash of hashes) expect(hash).toHaveLength(32);
    // Deterministic: the same inputs always give the same commitment.
    expect(capabilityCommitment(NETWORK, nonce, "buyer", secret)).toEqual(
      hashes[0],
    );
    // And a different secret changes it.
    expect(
      capabilityCommitment(NETWORK, nonce, "buyer", bytes32(10)),
    ).not.toEqual(hashes[0]);
  });

  test("termsCommitment binds the network, the nonce and the terms", () => {
    const nonce = bytes32(7);
    const base = termsCommitment(NETWORK, nonce, terms);
    expect(base).toHaveLength(32);
    expect(termsCommitment(NETWORK, nonce, terms)).toEqual(base);
    // Each field is bound: changing any one changes the commitment.
    const variants: readonly OrderTerms[] = [
      { ...terms, unitPrice: 1n, total: 1n },
      { ...terms, scopeDigest: bytes32(11) },
      { ...terms, salt: bytes32(12) },
    ];
    for (const variant of variants)
      expect(termsCommitment(NETWORK, nonce, variant)).not.toEqual(base);
    expect(termsCommitment(bytes32(13), nonce, terms)).not.toEqual(base);
    expect(termsCommitment(NETWORK, bytes32(14), terms)).not.toEqual(base);
  });
});
