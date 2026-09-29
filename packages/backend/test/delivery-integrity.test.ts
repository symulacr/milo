import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  deliveryCommitment,
  GRANT_GRACE_MS,
  GRANT_TTL_MS,
  inspectBytes,
  verifyRetrievedBytes,
} from "../src/delivery-policy";
import { deliveryCommitment as deliveryCommitmentNode } from "../src/delivery-commitment.mjs";

function hexDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pngBytes(extra: Uint8Array = new Uint8Array([1, 2, 3])): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...extra,
  ]);
}

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

function webpBytes(): Uint8Array {
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ]);
}

describe("RECONSTRUCTED delivery integrity pure helpers", () => {
  test("inspectBytes accepts PNG/JPEG/WebP magic and pins digest, type, size", () => {
    const png = inspectBytes(pngBytes());
    expect(png.contentType).toBe("image/png");
    expect(png.byteLength).toBe(pngBytes().byteLength);
    expect(png.sha256).toBe(
      createHash("sha256").update(pngBytes()).digest("hex"),
    );

    const jpeg = inspectBytes(jpegBytes());
    expect(jpeg.contentType).toBe("image/jpeg");
    expect(jpeg.sha256).toHaveLength(64);

    const webp = inspectBytes(webpBytes());
    expect(webp.contentType).toBe("image/webp");
    expect(webp.sha256).toHaveLength(64);
  });

  test("inspectBytes rejects non-magic, empty, and oversized payloads", () => {
    expect(() => inspectBytes(new Uint8Array())).toThrow();
    expect(() => inspectBytes(Uint8Array.from([0x00, 0x01, 0x02]))).toThrow();
    expect(() =>
      inspectBytes(Uint8Array.from([0x3c, 0x73, 0x76, 0x67])), // <svg
    ).toThrow();
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => inspectBytes(oversized)).toThrow();
  });

  test("deliveryCommitment is digest of ordered inspected file digests, no randomness", () => {
    const digests = ["0".repeat(64), "1".repeat(64), "2".repeat(64)];
    const files = digests.map((sha256, index) => ({
      grantId: `g${index}`,
      sha256,
      contentType: "image/png" as const,
      byteLength: 1,
    }));
    const first = deliveryCommitment(files);
    const second = deliveryCommitment(files);
    expect(first).toBe(second);
    expect(first).toBe(
      createHash("sha256").update(digests.join("")).digest("hex"),
    );
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("deliveryCommitment is order-sensitive and mismatch-sensitive", () => {
    const files = ["0".repeat(64), "1".repeat(64), "2".repeat(64)].map(
      (sha256, index) => ({
        grantId: `g${index}`,
        sha256,
        contentType: "image/png" as const,
        byteLength: 1,
      }),
    );
    const reordered = [files[1], files[0], files[2]];
    expect(deliveryCommitment(files)).not.toBe(deliveryCommitment(reordered));
    const mutated = [
      files[0],
      { ...files[1], sha256: "f".repeat(64) },
      files[2],
    ];
    expect(deliveryCommitment(files)).not.toBe(deliveryCommitment(mutated));
  });

  test("deliveryCommitment matches the Node/ESM twin", () => {
    const files = ["a".repeat(64), "b".repeat(64), "c".repeat(64)].map(
      (sha256, index) => ({
        grantId: `g${index}`,
        sha256,
        contentType: "image/jpeg" as const,
        byteLength: 9,
      }),
    );
    expect(deliveryCommitment(files)).toBe(deliveryCommitmentNode(files));
  });

  test("verifyRetrievedBytes re-checks witnessed bytes against the frozen descriptor", () => {
    const bytes = pngBytes();
    const inspected = inspectBytes(bytes);
    const descriptor = {
      grantId: "grant",
      storageId: "storage",
      ...inspected,
      contentType: "image/png" as const,
    };
    expect(verifyRetrievedBytes(descriptor, bytes)).toEqual(descriptor);
    expect(() =>
      verifyRetrievedBytes(descriptor, pngBytes(Uint8Array.from([9]))),
    ).toThrow();
    expect(() =>
      verifyRetrievedBytes(
        { ...descriptor, byteLength: descriptor.byteLength + 1 },
        bytes,
      ),
    ).toThrow();
  });

  test("grant TTL is 5 minutes with a 1 hour grace window", () => {
    expect(GRANT_TTL_MS).toBe(5 * 60 * 1000);
    expect(GRANT_GRACE_MS).toBe(60 * 60 * 1000);
    expect(GRANT_TTL_MS).toBeLessThan(GRANT_GRACE_MS);
  });
});
