import { describe, expect, test } from "bun:test";
import {
  createScenario,
  invalidateFileVerification,
  transition,
} from "../../../packages/domain/src/prototype";
import { sampleFiles } from "./assets";

describe("original sample image integrity", () => {
  for (const file of sampleFiles) {
    test(`${file.name} has the pinned SHA-256, WebP header and 600×720 dimensions`, async () => {
      const bytes = await Bun.file(`apps/web/public${file.src}`).arrayBuffer();
      const view = new DataView(bytes);
      // RIFF container: "RIFF" ... "WEBP" then a lossy "VP8 " frame.
      expect([...new Uint8Array(bytes).slice(0, 4)]).toEqual([82, 73, 70, 70]);
      expect([...new Uint8Array(bytes).slice(8, 12)]).toEqual([87, 69, 66, 80]);
      expect([...new Uint8Array(bytes).slice(12, 16)]).toEqual([
        86, 80, 56, 32,
      ]);
      // VP8 keyframe header: 3-byte sync code, then 14-bit width and height.
      expect([...new Uint8Array(bytes).slice(23, 26)]).toEqual([157, 1, 42]);
      expect(view.getUint16(26, true) & 0x3fff).toBe(600);
      expect(view.getUint16(28, true) & 0x3fff).toBe(720);
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
