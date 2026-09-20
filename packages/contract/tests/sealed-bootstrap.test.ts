import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The constructor-only bootstrap fields carry the `sealed` modifier so no
 * context reachable from an exported circuit can rewrite them (compile-time
 * guarantee; verified by the V6 circuit experiment to be artifact-identical).
 * The seal is erased from every generated artifact, so nothing else can see
 * it; this source tripwire fails if a future edit silently removes it.
 */
const REPO = new URL("../../..", import.meta.url).pathname;

describe("sealed bootstrap fields", () => {
  const source = readFileSync(
    `${REPO}packages/contract/src/order.compact`,
    "utf8",
  );

  test("protocolVersion and configuration are sealed", () => {
    expect(source).toMatch(/^export sealed ledger protocolVersion\s*:/m);
    expect(source).toMatch(/^export sealed ledger configuration\s*:/m);
  });

  test("no other ledger entry is sealed", () => {
    const sealed = source.match(/^export sealed ledger/gm) ?? [];
    expect(sealed.length).toBe(2);
  });
});
