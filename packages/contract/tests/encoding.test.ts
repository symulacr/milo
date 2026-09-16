import { expect, test } from "bun:test";
import {
  type CompactType,
  CompactTypeBytes,
  CompactTypeUnsignedInteger,
  persistentHash,
} from "@midnight-ntwrk/compact-runtime";
import { pureCircuits, Role, type Terms } from "../generated/contract/index.js";

const b32 = new CompactTypeBytes(32);
const uint = (bits: number) =>
  new CompactTypeUnsignedInteger((1n << BigInt(bits)) - 1n, bits / 8);
const fields: { [K in keyof Terms]: CompactType<Terms[K]> } = {
  serviceVersion: uint(16),
  packQuantity: uint(8),
  outputCount: uint(8),
  unitPrice: uint(64),
  total: uint(64),
  currency: new CompactTypeBytes(3),
  scopeDigest: b32,
  rightsDigest: b32,
  paymentPolicy: b32,
  salt: b32,
};
const keys = Object.keys(fields) as (keyof Terms)[];
const encodeField = <K extends keyof Terms>(key: K, value: Terms) =>
  fields[key].toValue(value[key]);
const descriptor: CompactType<Terms> = {
  alignment: () => keys.flatMap((key) => fields[key].alignment()),
  toValue: (value) => keys.flatMap((key) => encodeField(key, value)),
  fromValue: (value) => ({
    serviceVersion: fields.serviceVersion.fromValue(value),
    packQuantity: fields.packQuantity.fromValue(value),
    outputCount: fields.outputCount.fromValue(value),
    unitPrice: fields.unitPrice.fromValue(value),
    total: fields.total.fromValue(value),
    currency: fields.currency.fromValue(value),
    scopeDigest: fields.scopeDigest.fromValue(value),
    rightsDigest: fields.rightsDigest.fromValue(value),
    paymentPolicy: fields.paymentPolicy.fromValue(value),
    salt: fields.salt.fromValue(value),
  }),
};
const bytes = (n: number) => new Uint8Array(32).fill(n);
const network = bytes(1);
const nonce = bytes(2);
const opening: Terms = {
  serviceVersion: 1n,
  packQuantity: 1n,
  outputCount: 3n,
  unitPrice: 36_000n,
  total: 36_000n,
  currency: new TextEncoder().encode("USD"),
  scopeDigest: bytes(8),
  rightsDigest: bytes(9),
  paymentPolicy: bytes(10),
  salt: bytes(11),
};
const domain = new Uint8Array(32);
domain.set(new TextEncoder().encode("milo:terms:v1"));
const version = uint(16);
type Preimage = { network: Uint8Array; nonce: Uint8Array; terms: Terms };
const preimage: CompactType<Preimage> = {
  alignment: () => [
    ...b32.alignment(),
    ...version.alignment(),
    ...b32.alignment(),
    ...b32.alignment(),
    ...descriptor.alignment(),
  ],
  toValue: (p) => [
    ...b32.toValue(domain),
    ...version.toValue(1n),
    ...b32.toValue(p.network),
    ...b32.toValue(p.nonce),
    ...descriptor.toValue(p.terms),
  ],
  fromValue: (value) => {
    expect(b32.fromValue(value)).toEqual(domain);
    expect(version.fromValue(value)).toBe(1n);
    return {
      network: b32.fromValue(value),
      nonce: b32.fromValue(value),
      terms: descriptor.fromValue(value),
    };
  },
};

test("M-02 typed TS/Compact commitment encoding and exact round trip", () => {
  const p = { network, nonce, terms: opening };
  const encoded = preimage.toValue(p);
  expect(preimage.fromValue(encoded)).toEqual(p);
  expect(encoded).toHaveLength(0);
  expect(persistentHash(preimage, p)).toEqual(
    pureCircuits.hashTerms(network, nonce, opening),
  );
  expect(
    Buffer.from(pureCircuits.hashTerms(network, nonce, opening)).toString(
      "hex",
    ),
  ).toBe("7c68af34735b1d625d04b25c2d3cbab71ef846d9d1a3bf3e7d27ffae0fd95d03");
});

test("M-02 every terms field, salt, network, nonce and capability role is bound", () => {
  const commitment = pureCircuits.hashTerms(network, nonce, opening);
  for (const key of keys) {
    const value = opening[key];
    const changed =
      typeof value === "bigint" ? value + 1n : value.map((byte) => byte ^ 1);
    expect(
      pureCircuits.hashTerms(network, nonce, { ...opening, [key]: changed }),
    ).not.toEqual(commitment);
  }
  expect(pureCircuits.hashTerms(bytes(99), nonce, opening)).not.toEqual(
    commitment,
  );
  expect(pureCircuits.hashTerms(network, bytes(99), opening)).not.toEqual(
    commitment,
  );
  const buyer = pureCircuits.hashCapability(
    network,
    nonce,
    Role.BUYER,
    bytes(3),
  );
  expect(Buffer.from(buyer).toString("hex")).toBe(
    "81586615c936a2037460d22d94d53f57f77d2e505c668a22e5a46a90ea36c655",
  );
  for (const role of [Role.MERCHANT, Role.OPERATOR]) {
    expect(
      pureCircuits.hashCapability(network, nonce, role, bytes(3)),
    ).not.toEqual(buyer);
  }
  expect(
    pureCircuits.hashCapability(bytes(99), nonce, Role.BUYER, bytes(3)),
  ).not.toEqual(buyer);
  expect(
    pureCircuits.hashCapability(network, bytes(99), Role.BUYER, bytes(3)),
  ).not.toEqual(buyer);
  expect(
    pureCircuits.hashCapability(network, nonce, Role.BUYER, bytes(99)),
  ).not.toEqual(buyer);
});
