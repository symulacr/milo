import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Every transaction the harness submits must be built by tx.mjs, whose staged()
 * guard asserts the shape. Raw L.Transaction.fromParts silently accepts a
 * nested Transaction where an Intent belongs (intents becomes undefined, no
 * throw), which is how the V3 double-wrap regression shipped. This tripwire
 * fails if any other production module in the integration lane constructs a
 * transaction directly. It lives in the contract-test lane because test:unit
 * does not include packages/integration.
 */
const REPO = new URL("../../..", import.meta.url).pathname;
const SRC = `${REPO}packages/integration/src`;

describe("single transaction-construction point", () => {
  test("only tx.mjs builds transactions in the integration source", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SRC).filter((file) =>
      file.endsWith(".mjs"),
    )) {
      const source = readFileSync(`${SRC}/${name}`, "utf8");
      const hits = source.match(/L\.Transaction\.fromParts/g) ?? [];
      if (hits.length > 0 && name !== "tx.mjs")
        offenders.push(`${name}(${hits.length})`);
    }
    expect(offenders).toEqual([]);
  });

  test("the guard asserts the shape it exists to protect", () => {
    const source = readFileSync(`${SRC}/tx.mjs`, "utf8");
    for (const assertion of [
      "intent instanceof L.Intent",
      "tx.intents",
      "tx.intents.size, 1",
      "only.actions.length, 1",
      "only.actions[0] instanceof L.Transaction",
    ]) {
      expect(source).toContain(assertion);
    }
  });
});
