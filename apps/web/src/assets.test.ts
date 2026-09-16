import { describe, expect, test } from "bun:test";
import {
  createScenario,
  invalidateFileVerification,
  transition,
} from "../../../packages/domain/src/prototype";
import { sampleFiles } from "./assets";

describe("original sample image integrity", () => {
  for (const file of sampleFiles) {
    test(`${file.name} has the pinned SHA-256, PNG header and 600×720 dimensions`, async () => {
      const bytes = await Bun.file(`apps/web/public${file.src}`).arrayBuffer();
      const view = new DataView(bytes);
      expect([...new Uint8Array(bytes).slice(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      expect(view.getUint32(16)).toBe(600);
      expect(view.getUint32(20)).toBe(720);
      const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      expect(hash).toBe(file.hash);
    });
  }
  test("a recheck invalidates old evidence before I/O and blocks approval until all files pass again", () => {
    const checked = transition(createScenario("review"), "verify", {
      verifiedFileIds: ["01", "02", "03"],
    });
    const pending = invalidateFileVerification(checked);
    expect(pending.filesVerified).toBe(false);
    expect(checked.filesVerified).toBe(true);
    expect(() => transition(pending, "approve")).toThrow();
    expect(() =>
      transition(pending, "verify", { verifiedFileIds: ["01", "02"] }),
    ).toThrow();
    expect(
      transition(pending, "verify", { verifiedFileIds: ["01", "02", "03"] })
        .filesVerified,
    ).toBe(true);
  });
});
