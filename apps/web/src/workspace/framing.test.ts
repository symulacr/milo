import { describe, expect, test } from "bun:test";
import type { Payment } from "../../../../packages/domain/src/prototype";
import { paymentLine, phaseFrame } from "./framing";

describe("paymentLine", () => {
  test("covers every payment state with a non-empty clause", () => {
    const payments: Payment[] = [
      "none",
      "authorized",
      "captured",
      "voided",
      "expired",
      "failed",
    ];
    for (const payment of payments) {
      const line = paymentLine(payment);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  test("failed attempt is unresolved, not a captured or released hold", () => {
    expect(paymentLine("failed")).toBe("attempt failed; payment unresolved");
  });
});

describe("phaseFrame", () => {
  test("every phase frames heading, next, and consequence", () => {
    const phases = [
      "DRAFT",
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
      "APPROVED",
      "CANCELLED",
    ] as const;
    for (const phase of phases) {
      const frame = phaseFrame(phase, "buyer");
      expect(frame.heading.length).toBeGreaterThan(0);
      expect(frame.next.length).toBeGreaterThan(0);
      expect(frame.consequence.length).toBeGreaterThan(0);
    }
  });
});
