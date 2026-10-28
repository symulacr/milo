/**
 * R34 / V2 — the zk artifact base URL must point at the content-addressed,
 * immutable copy the build already emits.
 *
 * Why this exists. `scripts/build.ts` writes every artifact twice:
 *
 *   /zk/keys/reserve.prover                      -> Cache-Control: public, max-age=0, must-revalidate
 *   /zk/<sourceSha256[0:16]>/keys/reserve.prover -> Cache-Control: public, max-age=31536000, immutable
 *
 * and `vercel.json` marks only the second immutable. The client asks for the
 * first (`runtime.ts:72 DEFAULT_ZK_BASE_URL = "/zk"`), so a returning user
 * revalidates 14 files over the network on every visit. W1 measured the
 * difference directly: the unversioned path returns `transferSize: 300` (a
 * conditional request went out), the versioned path returns `transferSize: 0`
 * (served from cache).
 *
 * The fix is a build-time constant, so the logic under test is the derivation and
 * its fail-safe, not the bundler. Testing it as a pure function avoids ESM
 * hoisting games: a test cannot reliably set a global before `runtime.ts` is
 * imported, because imports evaluate first.
 */
import { describe, expect, test } from "bun:test";
import { zkBaseUrlFor } from "./runtime";

describe("zk artifact base URL", () => {
  test("uses the content-addressed path when the build supplies a version", () => {
    // The exact shape build.ts emits: sourceSha256.slice(0, 16).
    expect(zkBaseUrlFor("453af640523557a4")).toBe("/zk/453af640523557a4");
  });

  test("falls back to the unversioned path when the build supplies nothing", () => {
    // `bun test`, the dev server and any build without a compile receipt take
    // this path. It is the must-revalidate copy, which is correct there: those
    // environments serve the unversioned directory.
    expect(zkBaseUrlFor(undefined)).toBe("/zk");
    expect(zkBaseUrlFor(null)).toBe("/zk");
  });

  test("ignores a malformed version rather than trusting it", () => {
    // A bad constant must not produce a URL that 404s every key. Falling back to
    // the unversioned path degrades to today's behaviour instead of breaking.
    for (const bad of [
      "",
      "ABC",
      "453af640523557a", // 15 chars
      "453af640523557a4f", // 17 chars
      "453af640523557zz", // not hex
      "../../etc/passwd",
      "/zk/453af640523557a4",
    ])
      expect(zkBaseUrlFor(bad)).toBe("/zk");
  });

  test("the versioned path is a strict suffix of the unversioned one", () => {
    // Guards against a future edit that produces `/zk//hash` or `zk/hash`, either
    // of which would miss the vercel.json rule and silently lose `immutable`.
    const base = zkBaseUrlFor("453af640523557a4");
    expect(base.startsWith("/zk/")).toBe(true);
    expect(base).not.toContain("//");
    expect(base.split("/")).toHaveLength(3);
  });
});
