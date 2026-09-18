import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The 14 proof-bearing circuit names are declared in four hand-maintained
 * planes (compiler script, integration artifact loader, backend admission
 * entrypoints, lace lifecycle list) plus the generated compiler manifest.
 * A drift in the backend copy is a fail-closed runtime outage; a drift in the
 * others is silent. This tripwire pins all of them to the generated truth.
 * The lace copy is a TEST-ONLY module, but it is the design surface for the
 * browser authority path, so its order (deploy first, then the admission
 * lifecycle) is asserted too.
 */
const REPO = new URL("../../..", import.meta.url).pathname;

const generated: string[] = (() => {
  const info = JSON.parse(
    readFileSync(
      `${REPO}packages/contract/generated/compiler/contract-info.json`,
      "utf8",
    ),
  ) as { circuits: { name: string; proof: boolean }[] };
  if (!info.circuits?.length)
    throw new Error(
      "generated circuit manifest is empty; run contract:compile",
    );
  return info.circuits
    .filter((circuit) => circuit.proof)
    .map((circuit) => circuit.name)
    .sort();
})();

const list = (file: string, name: string): string[] => {
  const source = readFileSync(`${REPO}${file}`, "utf8");
  const body = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1];
  if (!body) throw new Error(`${name} not found in ${file}`);
  return [...body.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
};

const artifacts = list(
  "packages/integration/src/artifacts.mjs",
  "proofCircuits",
);
const required = list(
  "packages/backend/src/admission-policy.ts",
  "REQUIRED_ENTRYPOINTS",
);
const lifecycle = list(
  "apps/web/src/lace-transaction-runtime.ts",
  "lifecycleOperations",
);

describe("circuit manifest parity", () => {
  test("every hand-maintained plane matches the generated compiler manifest", () => {
    expect(generated.length).toBe(14);
    expect([...artifacts].sort()).toEqual(generated);
    expect([...required].sort()).toEqual(generated);
  });

  test("lace lifecycle is deploy followed by the admission lifecycle, in order", () => {
    expect(lifecycle).toEqual(["deploy", ...required]);
  });
});
