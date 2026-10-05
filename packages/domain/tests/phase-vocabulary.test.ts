import { describe, expect, test } from "bun:test";
import {
  CHAIN_ORDER_PHASES,
  type ChainOrderPhase,
  chainPhasesForOrderRowPhase,
  isChainOrderPhase,
  isLossy,
  isOrderRowPhase,
  isTerminal,
  ORDER_ROW_PHASES,
  type OrderRowPhase,
  settlementActionFor,
  toOrderRowPhase,
} from "../src/phase-vocabulary";

/**
 * The two phase vocabularies used to be enumerated twice each — once in
 * `convex/schema.ts` and once in `convex/orders.ts` — with nothing connecting
 * them, so they could drift silently. Every pair is pinned here.
 */
describe("phase vocabularies", () => {
  test("chain vocabulary is the contract's seven phases", () => {
    expect(CHAIN_ORDER_PHASES).toEqual([
      "DEPLOYED",
      "RESERVED",
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
      "APPROVED",
      "CANCELLED",
    ]);
  });

  test("order-row vocabulary is four phases, none of them chain-only", () => {
    expect(ORDER_ROW_PHASES).toEqual([
      "ACCEPTED",
      "SUBMITTED",
      "DISPUTED",
      "TERMINAL",
    ]);
    // TERMINAL is not a contract phase. It exists only in orders/deliveries.
    for (const rowPhase of ORDER_ROW_PHASES) {
      if (rowPhase === "TERMINAL") continue;
      expect(CHAIN_ORDER_PHASES).toContain(rowPhase);
    }
  });

  test("guards accept their own vocabulary and nothing else", () => {
    for (const phase of CHAIN_ORDER_PHASES)
      expect(isChainOrderPhase(phase)).toBe(true);
    for (const rowPhase of ORDER_ROW_PHASES)
      expect(isOrderRowPhase(rowPhase)).toBe(true);
    // TERMINAL is the only order-row phase that is not a chain phase.
    for (const rowPhase of ORDER_ROW_PHASES)
      expect(isChainOrderPhase(rowPhase)).toBe(rowPhase !== "TERMINAL");
    // DEPLOYED, RESERVED, APPROVED and CANCELLED have no order-row phase of
    // the same name.
    for (const chainPhase of CHAIN_ORDER_PHASES)
      expect(isOrderRowPhase(chainPhase)).toBe(
        ["ACCEPTED", "SUBMITTED", "DISPUTED"].includes(chainPhase),
      );
    for (const value of ["terminal", "Approved", "", null, 7, undefined])
      expect(isChainOrderPhase(value)).toBe(false);
    for (const value of ["approved", "DEPLOYED", "", null, 7, undefined])
      expect(isOrderRowPhase(value)).toBe(false);
  });
});

describe("toOrderRowPhase — every chain phase, one pinned pair each", () => {
  const expected: Record<ChainOrderPhase, OrderRowPhase | null> = {
    DEPLOYED: null,
    RESERVED: null,
    ACCEPTED: "ACCEPTED",
    SUBMITTED: "SUBMITTED",
    DISPUTED: "DISPUTED",
    APPROVED: "TERMINAL",
    CANCELLED: "TERMINAL",
  };

  test("the table covers the whole chain vocabulary", () => {
    expect(Object.keys(expected).sort()).toEqual(
      [...CHAIN_ORDER_PHASES].sort(),
    );
  });

  for (const [chainPhase, rowPhase] of Object.entries(expected) as [
    ChainOrderPhase,
    OrderRowPhase | null,
  ][]) {
    test(`${chainPhase} -> ${rowPhase ?? "no orders row"}`, () => {
      expect(toOrderRowPhase(chainPhase)).toBe(rowPhase);
    });
  }

  test("DEPLOYED and RESERVED have no orders row because none exists yet", () => {
    // An order row is created at merchant acceptance. Before that the contract
    // holds the order and `orders` holds nothing, so the projection is null
    // rather than a made-up phase.
    expect(toOrderRowPhase("DEPLOYED")).toBeNull();
    expect(toOrderRowPhase("RESERVED")).toBeNull();
  });

  test("APPROVED and CANCELLED both collapse to TERMINAL", () => {
    expect(toOrderRowPhase("APPROVED")).toBe("TERMINAL");
    expect(toOrderRowPhase("CANCELLED")).toBe("TERMINAL");
    expect(toOrderRowPhase("APPROVED")).toBe(toOrderRowPhase("CANCELLED"));
  });

  test("no non-terminal order-row phase is produced by two chain phases", () => {
    for (const rowPhase of ORDER_ROW_PHASES) {
      if (rowPhase === "TERMINAL") continue;
      expect(chainPhasesForOrderRowPhase(rowPhase)).toEqual([rowPhase]);
      expect(isLossy(rowPhase)).toBe(false);
    }
  });
});

describe("the mapping is lossy and does not pretend otherwise", () => {
  test("TERMINAL has two chain phases behind it and is flagged lossy", () => {
    expect(chainPhasesForOrderRowPhase("TERMINAL").sort()).toEqual([
      "APPROVED",
      "CANCELLED",
    ]);
    expect(isLossy("TERMINAL")).toBe(true);
  });

  test("TERMINAL cannot expand back to a single chain phase", () => {
    // There is deliberately no `fromOrderRowPhase`. Two chain phases produce
    // this row phase, so any single-value answer would be a guess. This test
    // pins the ambiguity rather than picking one.
    const preimage = chainPhasesForOrderRowPhase("TERMINAL");
    expect(preimage.length).toBeGreaterThan(1);
    expect(new Set(preimage.map(toOrderRowPhase)).size).toBe(1);
  });

  test("the round trip holds exactly where the mapping is injective", () => {
    for (const rowPhase of ORDER_ROW_PHASES) {
      if (isLossy(rowPhase)) continue;
      const [only] = chainPhasesForOrderRowPhase(rowPhase);
      expect(only).toBeDefined();
      expect(toOrderRowPhase(only)).toBe(rowPhase);
    }
  });

  test("the whole image of the mapping is exactly the order vocabulary", () => {
    const image = CHAIN_ORDER_PHASES.map(toOrderRowPhase).filter(
      (phase): phase is NonNullable<typeof phase> => phase !== null,
    );
    expect([...new Set(image)].sort()).toEqual([...ORDER_ROW_PHASES].sort());
  });

  test("chain phases with no orders row are absent from every preimage", () => {
    const mapped = ORDER_ROW_PHASES.flatMap(chainPhasesForOrderRowPhase);
    expect(mapped).not.toContain("DEPLOYED");
    expect(mapped).not.toContain("RESERVED");
  });
});

describe("isTerminal", () => {
  test("only TERMINAL is terminal", () => {
    expect(ORDER_ROW_PHASES.filter(isTerminal)).toEqual(["TERMINAL"]);
    expect(isTerminal("ACCEPTED")).toBe(false);
    expect(isTerminal("DISPUTED")).toBe(false);
  });
});

describe("settlementActionFor", () => {
  test("capture opens only from APPROVED", () => {
    expect(settlementActionFor("APPROVED")).toBe("capture");
    for (const phase of CHAIN_ORDER_PHASES.filter((p) => p !== "APPROVED"))
      expect(settlementActionFor(phase)).not.toBe("capture");
  });

  test("void opens only from CANCELLED", () => {
    expect(settlementActionFor("CANCELLED")).toBe("void");
    for (const phase of CHAIN_ORDER_PHASES.filter((p) => p !== "CANCELLED"))
      expect(settlementActionFor(phase)).not.toBe("void");
  });

  test("the two terminal chain phases split into the two money actions", () => {
    expect(settlementActionFor("APPROVED")).not.toBe(
      settlementActionFor("CANCELLED"),
    );
    // TERMINAL hides which of the two happened; chainOrders.phase is what
    // still knows, which is why settlement reads that column and not the
    // orders-row projection.
    expect(
      chainPhasesForOrderRowPhase("TERMINAL").map(settlementActionFor),
    ).toEqual(["capture", "void"]);
  });

  test("five of seven chain phases open no settlement action", () => {
    expect(
      CHAIN_ORDER_PHASES.filter(
        (phase) => settlementActionFor(phase) === null,
      ).sort(),
    ).toEqual(["ACCEPTED", "DEPLOYED", "DISPUTED", "RESERVED", "SUBMITTED"]);
  });
});
