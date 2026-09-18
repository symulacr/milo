import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The order phase machine is declared in the Compact source, re-declared by
 * the compiler output, and mirrored as a UI-facing union in the domain
 * simulator (which adds the off-chain DRAFT state). These are different
 * authority planes and stay separate on purpose; this tripwire only fails if
 * the three declarations fall out of step.
 */
const REPO = new URL("../../..", import.meta.url).pathname;

const compactEnum = (() => {
  const source = readFileSync(
    `${REPO}packages/contract/src/order.compact`,
    "utf8",
  );
  const body = source.match(/enum Phase \{([^}]*)\}/)?.[1];
  if (!body) throw new Error("enum Phase not found in order.compact");
  return body
    .split(",")
    .map((member) => member.trim().split(/\s+/)[0])
    .filter(Boolean);
})();

const generatedEnum = (() => {
  const declaration = readFileSync(
    `${REPO}packages/contract/generated/contract/index.d.ts`,
    "utf8",
  );
  const body = declaration.match(/export enum Phase \{([^}]*)\}/)?.[1];
  if (!body)
    throw new Error("generated Phase enum not found; run contract:compile");
  return [...body.matchAll(/([A-Z_]+)\s*=/g)].map((member) => member[1]);
})();

const domainUnion = (() => {
  const source = readFileSync(
    `${REPO}packages/domain/src/prototype.ts`,
    "utf8",
  );
  const body = source.match(/export type Phase =([^;]*);/)?.[1];
  if (!body) throw new Error("domain Phase union not found");
  return [...body.matchAll(/"([A-Z_]+)"/g)].map((member) => member[1]);
})();

describe("order phase parity", () => {
  test("generated enum matches the compact source, in order", () => {
    expect(generatedEnum).toEqual(compactEnum);
  });

  test("domain union is the contract set plus the off-chain DRAFT state", () => {
    expect(domainUnion).toEqual(["DRAFT", ...compactEnum]);
  });
});
