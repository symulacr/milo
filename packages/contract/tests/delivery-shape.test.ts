import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  CompactTypeBytes,
  CompactTypeUnsignedInteger,
} from "@midnight-ntwrk/compact-runtime";
import {
  deliveryCommitment,
  deliveryCommitmentBytes32,
  submitDeliveryArgs,
} from "../../backend/src/delivery-policy";
import { deliveryCommitment as deliveryCommitmentNode } from "../../backend/src/delivery-commitment.mjs";

const digests = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const files = digests.map((sha256, index) => ({
  grantId: `g${index}`,
  sha256,
  contentType: "image/png" as const,
  byteLength: 1,
}));

const orderCompact = readFileSync(
  new URL("../src/order.compact", import.meta.url),
  "utf8",
);
const generatedDts = readFileSync(
  new URL("../generated/contract/index.d.ts", import.meta.url),
  "utf8",
);

describe("deliveryCommitment equals on-chain submitDelivery arg shape", () => {
  test("submitDelivery args are (Uint<64>, Bytes<32>) and carry the digest bytes", () => {
    const manifest = deliveryCommitment(files);
    expect(manifest).toMatch(/^[0-9a-f]{64}$/);

    const args = submitDeliveryArgs(2n, files);
    expect(args.expectedRevision).toBe(2n);
    expect(typeof args.expectedRevision).toBe("bigint");
    expect(args.commitment).toBeInstanceOf(Uint8Array);
    expect(args.commitment.byteLength).toBe(32);

    // The on-chain commitment is exactly the deliveryCommitment digest bytes.
    const expected = createHash("sha256").update(digests.join(""), "utf8").digest();
    expect(Array.from(args.commitment)).toEqual(Array.from(expected));
    expect(Buffer.from(args.commitment).toString("hex")).toBe(manifest);
  });

  test("deliveryCommitmentBytes32 round-trips through CompactTypeBytes(32)", () => {
    const manifest = deliveryCommitment(files);
    const commitment = deliveryCommitmentBytes32(manifest);
    const b32 = new CompactTypeBytes(32);
    const encoded = b32.toValue(commitment);
    expect(b32.fromValue(encoded)).toEqual(commitment);
    expect(commitment.byteLength).toBe(32);
  });

  test("rejects a non-hex or wrong-length manifest at the arg boundary", () => {
    expect(() => deliveryCommitmentBytes32("not-hex")).toThrow();
    expect(() => deliveryCommitmentBytes32("ab".repeat(16))).toThrow();
    expect(() =>
      submitDeliveryArgs(0n, [{ sha256: "zz" }, ...files.slice(1)]),
    ).toThrow();
  });

  test("order.compact submitDelivery takes commitment: Bytes<32>", () => {
    expect(orderCompact).toContain(
      "export circuit submitDelivery(expectedRevision: Uint<64>, commitment: Bytes<32>)",
    );
    expect(orderCompact).toContain("deliveryCommitment = c;");
    expect(orderCompact).toContain("export ledger deliveryCommitment: Bytes<32>;");
  });

  test("generated TS surface types commitment as Uint8Array (Bytes<32>)", () => {
    expect(generatedDts).toContain("commitment_0: Uint8Array");
    expect(generatedDts).toContain("readonly deliveryCommitment: Uint8Array");
  });

  test("Node/ESM twin produces the same submitDelivery commitment bytes", () => {
    const twin = deliveryCommitmentNode(files);
    expect(twin).toBe(deliveryCommitment(files));
    expect(deliveryCommitmentBytes32(twin)).toEqual(
      submitDeliveryArgs(0n, files).commitment,
    );
  });

  test("U64 revision encoding matches CompactTypeUnsignedInteger(64)", () => {
    const u64 = new CompactTypeUnsignedInteger((1n << 64n) - 1n, 8);
    const args = submitDeliveryArgs(150, files);
    expect(args.expectedRevision).toBe(150n);
    expect(u64.toValue(args.expectedRevision)).toBeInstanceOf(Array);
    expect(u64.fromValue(u64.toValue(args.expectedRevision))).toBe(150n);
  });
});
