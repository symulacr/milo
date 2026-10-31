import { describe, expect, test } from "bun:test";
import {
  authTrustedOrigins,
  bytesToHex,
  HEX64,
  hexToBytes,
} from "../src/encoding";

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

/**
 * R51: production must not trust a localhost origin.
 *
 * Better Auth's security guidance: "Do not leave the localhost origin in a
 * trusted origins list of a production auth instance." Production `SITE_URL`
 * carries both loopback origins so a developer's `.env.local` can reuse one
 * variable, and `convex/auth.ts` used to split it straight into
 * `trustedOrigins` — so the live list contained `http://localhost:3000` and
 * `http://127.0.0.1:3000`.
 *
 * `authTrustedOrigins` drops loopback unless the deployment is itself local.
 * The local signal is derived from the value: a list that is *entirely*
 * loopback cannot be reached from anywhere but the machine, so it is dev.
 */
describe("auth trusted origins drop loopback in production (R51)", () => {
  const PROD =
    "https://milo-nine-delta.vercel.app,https://milo.k2jodz91zi.workers.dev,http://localhost:3000,http://127.0.0.1:3000";

  test("production keeps the public origins and loses both loopback ones", () => {
    expect(authTrustedOrigins(PROD)).toEqual([
      "https://milo-nine-delta.vercel.app",
      "https://milo.k2jodz91zi.workers.dev",
    ]);
  });

  test("a local deployment keeps its loopback origin, so dev sign-in works", () => {
    for (const dev of [
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://[::1]:3000",
      "https://localhost:3000",
      "http://localhost:3000,http://127.0.0.1:3000",
    ])
      expect({ dev, origins: authTrustedOrigins(dev) }).toEqual({
        dev,
        origins: dev.split(","),
      });
  });

  test("a lookalike host is not loopback, so it is never treated as local", () => {
    // Anchoring matters: an unanchored regex would call these local and keep
    // whatever they carried.
    for (const host of [
      "http://localhost.evil.com",
      "http://127.0.0.1.evil.com",
      "http://localhost:3000.evil.com",
    ])
      expect({ host, origins: authTrustedOrigins(host) }).toEqual({
        host,
        origins: [host],
      });
  });

  test("an empty or whitespace value yields no origins", () => {
    expect(authTrustedOrigins("")).toEqual([]);
    expect(authTrustedOrigins("   ")).toEqual([]);
    expect(authTrustedOrigins(" , ")).toEqual([]);
  });

  test("whitespace and empty entries are trimmed away", () => {
    expect(
      authTrustedOrigins(" https://a.test , http://localhost:3000 , "),
    ).toEqual(["https://a.test"]);
  });

  test("the shipped production value loses exactly the two loopback origins", () => {
    // Guards the real env shape, not a hand-written sample.
    const before = PROD.split(",");
    const after = authTrustedOrigins(PROD);
    expect(before.length - after.length).toBe(2);
    expect(after.some((o) => /localhost|127\.0\.0\.1/.test(o))).toBe(false);
  });
});
