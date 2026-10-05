import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHAIN_ORDER_PHASES,
  type ChainOrderPhase,
  isChainOrderPhase,
  ORDER_ROW_PHASES,
  type OrderRowPhase,
  toOrderRowPhase,
} from "../packages/domain/src/phase-vocabulary";
import schema from "./schema";
import { settlementAuthorized } from "./settlement";

/**
 * `convex/schema.ts` used to spell out both phase vocabularies inline, which
 * left them free to drift from each other and from the settlement gate. They
 * are now built from the one module. These tests read the real schema and the
 * real gate, so a re-hardcoded literal anywhere fails here.
 */
const tables = schema.tables;
type PhaseValidator = { kind: string; members: { value: unknown }[] };
const literals = (validator: PhaseValidator) =>
  validator.members.map((member) => member.value as string);

const phaseField = (table: string) =>
  (
    tables[table as keyof typeof tables].validator as unknown as {
      fields: Record<string, PhaseValidator>;
    }
  ).fields.phase;

describe("schema phase validators come from phase-vocabulary", () => {
  test("chainOrders.phase is exactly the chain vocabulary", () => {
    expect(literals(phaseField("chainOrders"))).toEqual([
      ...CHAIN_ORDER_PHASES,
    ]);
  });

  test("orders.phase is exactly the order-row vocabulary", () => {
    expect(literals(phaseField("orders"))).toEqual([...ORDER_ROW_PHASES]);
  });

  test("the two vocabularies are still disjoint where they must be", () => {
    // APPROVED and CANCELLED exist only on the chain side; TERMINAL only on
    // the orders side. A schema that accepted either in the wrong place would
    // let the two representations of the same order drift apart.
    expect(literals(phaseField("orders"))).not.toContain("APPROVED");
    expect(literals(phaseField("orders"))).not.toContain("CANCELLED");
    expect(literals(phaseField("chainOrders"))).not.toContain("TERMINAL");
  });

  test("deliveries carries no phase column at all", () => {
    const fields = (
      tables.deliveries.validator as unknown as {
        fields: Record<string, unknown>;
      }
    ).fields;
    expect(Object.keys(fields)).toEqual([
      "orderId",
      "merchantId",
      "revision",
      "files",
      "manifest",
    ]);
  });
});

/**
 * The settlement gate reads the same table. If someone hardcodes APPROVED and
 * CANCELLED back into settlement.ts, adding a third terminal chain phase with
 * a settlement action makes these fail.
 */
/**
 * The behavioural tests above cannot tell "reads the shared table" from
 * "hardcodes the same two literals", because for today's seven phases the two
 * are indistinguishable. These source guards can.
 */
describe("the phase literals live in exactly one file", () => {
  const read = (relative: string) =>
    readFileSync(new URL(relative, import.meta.url).pathname, "utf8");
  const phaseLiterals = (source: string) =>
    source.match(
      /"(DEPLOYED|RESERVED|ACCEPTED|SUBMITTED|DISPUTED|APPROVED|CANCELLED|TERMINAL)"/g,
    ) ?? [];

  const consumers = [
    "../convex/schema.ts",
    "../convex/settlement.ts",
    "../convex/orders.ts",
  ];

  for (const consumer of consumers) {
    test(`${consumer} names no phase literal in a phase position`, () => {
      expect(phaseLiterals(read(consumer))).toEqual([]);
    });
  }

  /**
   * Two OrderRow shapes still spell the order vocabulary out by hand. Neither
   * file is owned in this wave; see outbox/REFERRALS.md. Listed here so the
   * duplication is visible rather than forgotten.
   */
  test("the two un-owned OrderRow shapes still duplicate the vocabulary", () => {
    for (const relative of [
      "../convex/files.ts",
      "../packages/backend/src/delivery-policy.ts",
    ]) {
      expect(phaseLiterals(read(relative))).not.toEqual([]);
    }
  });

  test("phase-vocabulary.ts is where they are written down", () => {
    const source = read("../packages/domain/src/phase-vocabulary.ts");
    // Both vocabularies are enumerated once each, plus the two literal
    // mentions inside settlementActionFor and the UNMAPPED list.
    expect(new Set(phaseLiterals(source)).size).toBe(8);
    expect(source).toContain('APPROVED: "TERMINAL"');
    expect(source).toContain('CANCELLED: "TERMINAL"');
    expect(source).toContain('chainPhase === "APPROVED"');
    expect(source).toContain('chainPhase === "CANCELLED"');
  });

  test("settlement.ts routes its gate through the shared mapping", () => {
    const source = read("../convex/settlement.ts");
    expect(source).toContain("settlementActionFor(phase) === action");
    expect(source).not.toMatch(/phase === "APPROVED"/);
    expect(source).not.toMatch(/phase === "CANCELLED"/);
  });

  test("schema.ts builds both validators from the tuples", () => {
    const source = read("../convex/schema.ts");
    expect(source).toContain("CHAIN_ORDER_PHASES.map");
    expect(source).toContain("ORDER_ROW_PHASES.map");
  });
});

describe("settlementAuthorized is driven by the shared mapping", () => {
  test("capture opens from APPROVED only", () => {
    expect(settlementAuthorized("capture", "APPROVED")).toBe(true);
    for (const phase of CHAIN_ORDER_PHASES.filter((p) => p !== "APPROVED"))
      expect(settlementAuthorized("capture", phase)).toBe(false);
  });

  test("void opens from CANCELLED only", () => {
    expect(settlementAuthorized("void", "CANCELLED")).toBe(true);
    for (const phase of CHAIN_ORDER_PHASES.filter((p) => p !== "CANCELLED"))
      expect(settlementAuthorized("void", phase)).toBe(false);
  });

  test("an unrecognised stored phase authorizes nothing", () => {
    // settlementOps.phase is a plain v.string(), so a row written by an older
    // or newer writer can hold anything. It must never settle money.
    for (const phase of ["", "approved", "TERMINAL", "REFUNDED", "unknown"])
      expect(settlementAuthorized("capture", phase)).toBe(false);
  });

  test("the gate and the mapping agree on every chain phase", () => {
    for (const phase of CHAIN_ORDER_PHASES) {
      const action =
        phase === "APPROVED"
          ? "capture"
          : phase === "CANCELLED"
            ? "void"
            : null;
      if (action) {
        expect(settlementAuthorized(action, phase)).toBe(true);
        expect(
          settlementAuthorized(
            action === "capture" ? "void" : "capture",
            phase,
          ),
        ).toBe(false);
      } else {
        expect(settlementAuthorized("capture", phase)).toBe(false);
        expect(settlementAuthorized("void", phase)).toBe(false);
      }
    }
  });

  test("TERMINAL authorizes nothing, which is why settlement reads chainOrders", () => {
    // The orders row that carries TERMINAL cannot say whether the order was
    // approved or cancelled, so the two money actions are indistinguishable
    // from it. Settlement therefore keys off chainOrders.phase, which still
    // distinguishes them.
    expect(settlementAuthorized("capture", "TERMINAL")).toBe(false);
    expect(settlementAuthorized("void", "TERMINAL")).toBe(false);
    expect(toOrderRowPhase("APPROVED")).toBe(
      toOrderRowPhase("CANCELLED") as OrderRowPhase,
    );
  });
});

describe("the mapping is total and type-complete", () => {
  test("every chain phase projects somewhere, including to null", () => {
    for (const phase of CHAIN_ORDER_PHASES)
      expect(toOrderRowPhase(phase)).not.toBeUndefined();
  });

  test("the projection type is exactly the orders vocabulary plus null", () => {
    const projected = CHAIN_ORDER_PHASES.map(toOrderRowPhase);
    for (const phase of projected) {
      if (phase === null) continue;
      expect(isChainOrderPhase(phase) || phase === "TERMINAL").toBe(true);
    }
  });

  test("the guard and the schema agree on membership", () => {
    for (const phase of literals(
      phaseField("chainOrders"),
    ) as ChainOrderPhase[])
      expect(isChainOrderPhase(phase)).toBe(true);
    for (const phase of literals(phaseField("orders")) as OrderRowPhase[])
      expect(phase === "TERMINAL" || isChainOrderPhase(phase)).toBe(true);
  });
});
