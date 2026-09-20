import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ACTION_NAMES } from "../src/prototype";

/**
 * The 22-action vocabulary was enumerated twice (the ActionName union and the
 * action-candidates list). ACTION_NAMES is now the single source; this guard
 * fails if a second full literal list reappears in the module.
 */
describe("ACTION_NAMES single source", () => {
  test("holds 22 unique names", () => {
    expect(ACTION_NAMES.length).toBe(22);
    expect(new Set(ACTION_NAMES).size).toBe(22);
  });

  test("the module no longer enumerates the list twice", () => {
    const source = readFileSync(
      new URL("../src/prototype.ts", import.meta.url).pathname,
      "utf8",
    );
    const occurrences = source.match(/"pending"/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});
