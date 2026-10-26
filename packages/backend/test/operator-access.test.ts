/**
 * Item 8: who may become an operator.
 *
 * `MILO_OPERATOR_EMAILS` is the allowlist. The membership row is what
 * `orders:list` and `orders:order` read, so this test pins the rule that
 * creates it: allowlisted email, own scope, never a studio scope.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { OPERATOR_SCOPE } from "../../../convex/auth";
import { operatorEmails } from "../src/session-identity";

const original = process.env.MILO_OPERATOR_EMAILS;
afterEach(() => {
  if (original === undefined) delete process.env.MILO_OPERATOR_EMAILS;
  else process.env.MILO_OPERATOR_EMAILS = original;
});

describe("item 8 operator allowlist", () => {
  test("an unset list grants nobody", () => {
    delete process.env.MILO_OPERATOR_EMAILS;
    expect(operatorEmails()).toEqual([]);
  });

  test("emails are trimmed and lowercased so case cannot widen access", () => {
    process.env.MILO_OPERATOR_EMAILS =
      " Ops@Milo.Example , ,second@milo.example";
    expect(operatorEmails()).toEqual([
      "ops@milo.example",
      "second@milo.example",
    ]);
  });

  test("the operator scope is not a studio scope", () => {
    expect(OPERATOR_SCOPE).toBe("milo-operators");
    expect(OPERATOR_SCOPE.startsWith("studio_")).toBe(false);
  });
});
