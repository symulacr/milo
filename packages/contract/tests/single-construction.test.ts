import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Every transaction the harness submits must be built by tx.mjs, whose staged()
 * guard asserts the shape. Raw L.Transaction.fromParts silently accepts a
 * nested Transaction where an Intent belongs (intents becomes undefined, no
 * throw), which is how the V3 double-wrap regression shipped. The scan covers
 * source and test files and tolerates whitespace/newlines inside the member
 * expression; identifier aliasing (const T = L.Transaction) remains a known
 * limit of a text tripwire. It lives in the contract lane because test:unit
 * does not include packages/integration.
 */
const REPO = new URL("../../..", import.meta.url).pathname;
const INTEGRATION = `${REPO}packages/integration`;

const files = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => `${dir}/${name}`);

// One file must build the invalid form on purpose: the guard's own bite test
// constructs the nested double-wrap to prove staged() rejects it.
const EXCEPTIONS = new Set(["maintenance-audit.test.mjs"]);

describe("single transaction-construction point", () => {
  test("only tx.mjs builds transactions or intents in the integration package", () => {
    const offenders: string[] = [];
    for (const path of [
      ...files(`${INTEGRATION}/src`),
      ...files(`${INTEGRATION}/test`),
    ]) {
      const source = readFileSync(path, "utf8");
      const raw = source.match(
        /L\s*\.\s*Transaction\s*\.\s*fromParts|L\s*\.\s*Intent\s*\.\s*new/g,
      );
      const name = path.split("/").pop() ?? "";
      if (!raw || path.endsWith("/tx.mjs")) continue;
      if (EXCEPTIONS.has(name)) {
        // The exemption is exact: the guard-bite test builds the invalid form
        // once. A second raw construction there is a violation.
        if (raw.length !== 1) offenders.push(`${name}(${raw.length})`);
      } else {
        offenders.push(`${name}(${raw.length})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the guard asserts the shape it exists to protect", () => {
    const source = readFileSync(`${INTEGRATION}/src/tx.mjs`, "utf8");
    // Anchored on calls, not on comment text: commenting the assertion out
    // (the mutation that reopens the double-wrap) must fail this check.
    const required = [
      /assert\(\s*intent instanceof L\.Intent/,
      /assert\.notEqual\(\s*tx\.intents,\s*undefined/,
      /assert\.equal\(\s*tx\.intents\.size,\s*1/,
      /assert\.equal\(\s*only\.actions\.length,\s*1/,
      /assert\(\s*!\(\s*only\.actions\[0\] instanceof L\.Transaction/,
    ];
    for (const pattern of required) expect(source).toMatch(pattern);
  });
});
