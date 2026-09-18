import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
  reconstructPublicConstructor,
  validPublicConstructor,
} from "../src/public-constructor.mjs";

const inputs = {
  constructorVersion: 1 as const,
  constructorEncoding: CONSTRUCTOR_ENCODING,
  network: "preprod",
  nonce: "1".repeat(64),
  termsCommitment: "2".repeat(64),
  buyerCommitment: "3".repeat(64),
  merchantCommitment: "4".repeat(64),
  operatorCommitment: "5".repeat(64),
  acceptanceDeadlineSeconds: 100,
  deliveryDeadlineSeconds: 200,
  reviewDeadlineSeconds: 300,
  resolutionDeadlineSeconds: 400,
};
const quote = { ...inputs, ...publicConstructorFingerprints(inputs) };

describe("versioned public constructor", () => {
  test("reconstructs exact bytes and integers without private witness inputs", () => {
    const config = reconstructPublicConstructor(quote);
    expect(validPublicConstructor(quote)).toBe(true);
    expect(Array.from(config.network)).toEqual([
      ...new TextEncoder().encode("preprod"),
      ...Array(25).fill(0),
    ]);
    expect(config.orderNonce).toEqual(new Uint8Array(32).fill(0x11));
    expect(config.resolutionDeadline).toBe(400n);
    expect(Object.keys(config)).toHaveLength(10);
  });

  test("missing, unsupported, malformed, zero and colliding inputs fail closed", () => {
    for (const key of Object.keys(inputs)) {
      const missing = { ...quote } as Record<string, unknown>;
      delete missing[key];
      expect(validPublicConstructor(missing)).toBe(false);
    }
    for (const patch of [
      { constructorVersion: 2 },
      { constructorEncoding: "utf8-variable" },
      { network: "preprod\0" },
      { nonce: "nonce" },
      { nonce: "0".repeat(64) },
      { termsCommitment: "0".repeat(64) },
      { buyerCommitment: "AB".repeat(32) },
      { merchantCommitment: inputs.buyerCommitment },
      { operatorCommitment: "0".repeat(64) },
      { acceptanceDeadlineSeconds: 0 },
      { deliveryDeadlineSeconds: 100 },
      { reviewDeadlineSeconds: 300.5 },
      { resolutionDeadlineSeconds: Number.MAX_SAFE_INTEGER + 1 },
      { rolesFingerprint: "a".repeat(64) },
      { initialStateFingerprint: "a".repeat(64) },
    ])
      expect(validPublicConstructor({ ...quote, ...patch })).toBe(false);
  });

  test("programmer errors propagate instead of reading as invalid quotes (DEBT-071)", () => {
    const hostile = { ...quote };
    Object.defineProperty(hostile, "nonce", {
      get() {
        throw new Error("getter boom");
      },
    });
    expect(() => validPublicConstructor(hostile)).toThrow("getter boom");
  });

  test("every public constructor change invalidates the old fingerprints", () => {
    for (const patch of [
      { network: "undeployed" },
      { nonce: "6".repeat(64) },
      { termsCommitment: "6".repeat(64) },
      { buyerCommitment: "6".repeat(64) },
      { merchantCommitment: "6".repeat(64) },
      { operatorCommitment: "6".repeat(64) },
      { acceptanceDeadlineSeconds: 101 },
      { deliveryDeadlineSeconds: 201 },
      { reviewDeadlineSeconds: 301 },
      { resolutionDeadlineSeconds: 401 },
    ]) {
      const changed = { ...quote, ...patch };
      expect(validPublicConstructor(changed)).toBe(false);
      expect(
        validPublicConstructor({
          ...changed,
          ...publicConstructorFingerprints(changed),
        }),
      ).toBe(true);
    }
  });
});

// The admission-observation fingerprint is defined twice on purpose: the
// integration observer (node:crypto) and this backend reconstruction
// (@noble/hashes) must produce byte-identical values or admission silently
// diverges. A shared module would cross the TS/mjs package boundary, so this
// tripwire pins the encoding on both sides instead.
describe("fingerprint parity with the integration observer", () => {
  const canonical = (kind: string, value: unknown) =>
    createHash("sha256")
      .update(JSON.stringify(["milo:admission-observation:v2", kind, value]))
      .digest("hex");

  test("backend fingerprints equal the canonical sha256 encoding", () => {
    const roles = [
      quote.buyerCommitment,
      quote.merchantCommitment,
      quote.operatorCommitment,
    ];
    const { rolesFingerprint, initialStateFingerprint } =
      publicConstructorFingerprints(quote);
    expect(rolesFingerprint).toBe(canonical("roles", roles));
    expect(typeof initialStateFingerprint).toBe("string");
    expect(initialStateFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test("both sides use the same tag and JSON array encoding", () => {
    const shape =
      /JSON\.stringify\(\[(?<literal>"milo:[^"]+"|[a-z]+), (?<kind>[a-z]+), (?<value>[a-z]+)\]\)/;
    const backend = readFileSync(
      new URL("../src/public-constructor.mjs", import.meta.url),
      "utf8",
    );
    const observer = readFileSync(
      new URL(
        "../../../packages/integration/src/admission-observation.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    // Anchor on the fingerprint call itself: each file's first milo: literal
    // is a different constant, so only the JSON.stringify shape identifies it.
    const tagShape = /JSON\.stringify\(\["(?<tag>milo:[a-z0-9:-]+)",/;
    const backendLiteral = backend.match(tagShape)?.groups?.tag;
    const observerLiteral = observer.match(tagShape)?.groups?.tag;
    expect(backendLiteral).toBe(observerLiteral);
    expect(backendLiteral).toBe("milo:admission-observation:v2");
    expect(observer).toMatch(shape);
  });
});
