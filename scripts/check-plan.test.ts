import { describe, expect, test } from "bun:test";
import {
  collectClaimedIds,
  formatId,
  missingGateIds,
  parseId,
  parseRange,
  scanFences,
} from "./check-plan.ts";

const covers = (text: string, id: string) => {
  const claimed = collectClaimedIds(text);
  return claimed.literal.has(id) || claimed.covered.has(id);
};

describe("parseId", () => {
  test("reads each canonical prefix form", () => {
    expect(parseId("B-07")).toEqual({ prefix: "B-", num: 7 });
    expect(parseId("MID-P4")).toEqual({ prefix: "MID-P", num: 4 });
    expect(parseId("MID-T12")).toEqual({ prefix: "MID-T", num: 12 });
    expect(parseId("M-09")).toEqual({ prefix: "M-", num: 9 });
    expect(parseId("R5")).toEqual({ prefix: "R", num: 5 });
  });

  test("rejects text that is not a gate ID", () => {
    for (const text of [
      "P2",
      "B-",
      "MID-",
      "14",
      "ADR01",
      "SC-01",
      "UC-13",
      "",
    ]) {
      expect(parseId(text)).toBeUndefined();
    }
  });

  test("formatId pads only the prefixes the corpus pads", () => {
    expect(formatId({ prefix: "B-", num: 7 })).toBe("B-07");
    expect(formatId({ prefix: "MID-P", num: 1 })).toBe("MID-P1");
    expect(formatId({ prefix: "MID-T", num: 1 })).toBe("MID-T01");
    expect(formatId({ prefix: "M-", num: 1 })).toBe("M-01");
    expect(formatId({ prefix: "R", num: 0 })).toBe("R0");
  });
});

describe("parseRange", () => {
  test("expands an ascending same-prefix range inclusively", () => {
    expect(parseRange("MID-P", "1", "", "6")).toEqual([
      { prefix: "MID-P", num: 1 },
      { prefix: "MID-P", num: 2 },
      { prefix: "MID-P", num: 3 },
      { prefix: "MID-P", num: 4 },
      { prefix: "MID-P", num: 5 },
      { prefix: "MID-P", num: 6 },
    ]);
  });

  test("accepts an explicitly repeated right-hand prefix", () => {
    expect(parseRange("M-", "01", "M-", "14")).toHaveLength(14);
    expect(parseRange("B-", "09", "B-", "11")).toHaveLength(3);
  });

  test("accepts the abbreviated right-hand tail letter", () => {
    expect(parseRange("MID-P", "1", "P", "6")).toHaveLength(6);
    expect(parseRange("MID-T", "01", "T", "14")).toHaveLength(14);
  });

  test("a cross-prefix range claims nothing", () => {
    expect(parseRange("MID-P", "1", "MID-T", "14")).toEqual([]);
    expect(parseRange("B-", "01", "M-", "14")).toEqual([]);
  });

  test("a descending or absurd range claims nothing", () => {
    expect(parseRange("MID-P", "6", "", "1")).toEqual([]);
    expect(parseRange("MID-P", "1", "", "999")).toEqual([]);
  });

  test("an unknown prefix claims nothing", () => {
    expect(parseRange("X-", "1", "X-", "6")).toEqual([]);
  });
});

describe("collectClaimedIds", () => {
  test("a literal ID is claimed literally", () => {
    expect(covers("the gate MID-P2 applies", "MID-P2")).toBe(true);
    expect(covers("the gate MID-P2 applies", "MID-P3")).toBe(false);
  });

  test("MID-P1–P6 claims every intermediate MID-P ID", () => {
    for (let i = 1; i <= 6; i++)
      expect(covers("Preserve MID-P1–P6 evidence", `MID-P${i}`)).toBe(true);
    expect(covers("Preserve MID-P1–P6 evidence", "MID-P7")).toBe(false);
  });

  test("MID-P1–MID-P6 claims the same set as the abbreviated form", () => {
    const abbreviated = collectClaimedIds(
      "Preserve MID-P1–P6 evidence",
    ).covered;
    const repeated = collectClaimedIds(
      "Preserve MID-P1–MID-P6 evidence",
    ).covered;
    expect([...repeated].sort()).toEqual([...abbreviated].sort());
  });

  test("a range never claims another prefix's IDs", () => {
    const text = "Preserve MID-P1–P6 and MID-T01–T14";
    expect(covers(text, "MID-P2")).toBe(true);
    expect(covers(text, "MID-T07")).toBe(true);
    expect(covers(text, "M-02")).toBe(false);
    expect(covers(text, "B-02")).toBe(false);
    expect(covers(text, "R2")).toBe(false);
  });

  test("a narrow range does not stretch to the canonical count", () => {
    expect(covers("MID-P1–P1", "MID-P2")).toBe(false);
    expect(covers("MID-P2–P3", "MID-P4")).toBe(false);
  });

  test("two ranges in one sentence are both read", () => {
    const text = "Preserve M-01–M-14, B-01–B-11, MID-P1–P6 and MID-T01–T14 IDs";
    expect(covers(text, "M-14")).toBe(true);
    expect(covers(text, "B-11")).toBe(true);
    expect(covers(text, "MID-P6")).toBe(true);
    expect(covers(text, "MID-T14")).toBe(true);
    expect(covers(text, "M-15")).toBe(false);
  });

  test("a single hyphen is not a range separator", () => {
    expect(covers("see IMPLEMENTATION-P2-W3-C3-spec-sync", "MID-P2")).toBe(
      false,
    );
    expect(covers("2026-09-29 snapshot", "MID-P2")).toBe(false);
  });

  test("prose without an ID claims nothing", () => {
    expect(
      missingGateIds(collectClaimedIds("no identifiers here at all")).length,
    ).toBe(51);
  });

  test("a corpus built from ranges alone satisfies all 51 IDs", () => {
    const corpus =
      "B-01–B-11, MID-P1–P6, MID-T01–T14, M-01–M-14 and R0–R5 are the canonical gates.";
    expect(missingGateIds(collectClaimedIds(corpus))).toEqual([]);
  });

  test("a corpus missing one ID reports exactly that ID", () => {
    const corpus =
      "B-01–B-11, MID-P1–P6, MID-T01–T14, M-01–M-14 and R0–R4 are the canonical gates.";
    expect(missingGateIds(collectClaimedIds(corpus))).toEqual(["R5"]);
  });

  test("a shrunken range reports every ID it no longer covers", () => {
    const shrunken = missingGateIds(collectClaimedIds("MID-P1–P2"));
    expect(shrunken).toHaveLength(49);
    for (const id of ["MID-P1", "MID-P2"]) expect(shrunken).not.toContain(id);
    for (const id of ["MID-P3", "MID-P4", "MID-P5", "MID-P6"]) {
      expect(shrunken).toContain(id);
    }
    expect(shrunken).toContain("MID-T01");
  });
});

describe("scanFences", () => {
  test("returns prose without fenced lines", () => {
    const { prose, unclosed } = scanFences("a\n```\nB-01\n```\nb");
    expect(prose).toBe("a\nb");
    expect(unclosed).toBeUndefined();
  });

  test("reports an unclosed fence", () => {
    expect(scanFences("a\n```\nB-01").unclosed).toBe("```");
  });

  test("a longer fence is not closed by a shorter run", () => {
    expect(scanFences("````\nB-01\n```\n").unclosed).toBe("````");
  });
});
