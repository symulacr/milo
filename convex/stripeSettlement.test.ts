import { describe, expect, test } from "bun:test";
import { run, providerIntent } from "./stripeSettlement";

describe("stripeSettlement:run provider action (D1d)", () => {
  test("exports a scheduler-runnable action and provider query", () => {
    expect(typeof run === "object" || typeof run === "function").toBe(true);
    expect(typeof providerIntent === "object" || typeof providerIntent === "function").toBe(true);
    expect((run as { isAction?: boolean }).isAction).toBe(true);
  });

  test("action args fence settlement begin", () => {
    const def = run as unknown as { exportArgs?: () => string };
    const args = def.exportArgs?.() ?? "";
    expect(args).toContain("opId");
    expect(args).toContain("generation");
    expect(args).toContain("attempt");
  });

  test("provider paths and fail-closed key gate exist in source", async () => {
    const src = await Bun.file(
      new URL(import.meta.url).pathname.replace(
        "stripeSettlement.test.ts",
        "stripeSettlement.ts",
      ),
    ).text();
    expect(src).toContain("STRIPE_SECRET_KEY missing");
    expect(src).toContain("/capture");
    expect(src).toContain("/cancel");
    expect(src).toContain("idempotency_key");
    expect(src).toContain("outcome: \"failed\"");
    expect(src).toContain("outcome: \"ambiguous\"");
  });
});
