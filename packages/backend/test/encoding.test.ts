import { describe, expect, test } from "bun:test";
import { bytesToHex, HEX64, hexToBytes } from "../src/encoding";

describe("HEX64 single definition (convergence)", () => {
  test("accepts exactly lowercase 64-hex and rejects everything else", () => {
    const accepted = [
      "0".repeat(64),
      "f".repeat(64),
      "a".repeat(64),
      "0123456789abcdef".repeat(4),
    ];
    const rejected = [
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      "z".repeat(64),
      `0x${"a".repeat(64)}`,
      `${"a".repeat(63)} `,
      `${"a".repeat(63)}\n`,
    ];
    for (const value of accepted) expect(HEX64.test(value)).toBe(true);
    for (const value of rejected) expect(HEX64.test(value)).toBe(false);
  });
});

describe("encoding hex round-trip", () => {
  test("empty", () => {
    expect(bytesToHex(hexToBytes(""))).toBe("");
  });
  test("round-trip even hex", () => {
    for (let i = 0; i < 100; i++) {
      const h = i
        .toString(16)
        .padStart(2, "0")
        .repeat(1 + (i % 8));
      expect(bytesToHex(hexToBytes(h))).toBe(h);
    }
  });
  test("boundaries", () => {
    expect(bytesToHex(new Uint8Array([0, 255]))).toBe("00ff");
    expect(Array.from(hexToBytes("00ff"))).toEqual([0, 255]);
  });
  test("rejects odd length and invalid hex", () => {
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });
});

describe("hex codec delegates to @noble/hashes", () => {
  test("is byte-identical to the installed encoder for every byte value", async () => {
    const noble = await import("@noble/hashes/utils.js");
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToHex(all)).toBe(noble.bytesToHex(all));
    for (let i = 0; i < 256; i++) {
      const h = i.toString(16).padStart(2, "0");
      expect(bytesToHex(hexToBytes(h))).toBe(
        noble.bytesToHex(noble.hexToBytes(h)),
      );
    }
  });

  test("accepts an ArrayLike of bytes, as the previous signature did", () => {
    expect(bytesToHex([0, 255])).toBe("00ff");
    expect(bytesToHex(Uint8Array.from([0, 255]))).toBe("00ff");
  });
});
