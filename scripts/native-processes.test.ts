import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const [signal, code, late] of [
  ["SIGTERM", 143, false],
  ["SIGINT", 130, false],
  ["SIGTERM", 143, true],
  ["SIGINT", 130, true],
] as const) {
  test(`native lifecycle reaps owned children on ${signal}, late=${late}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "milo-native-signal-"));
    const marker = join(directory, "pid");
    const wrapper = Bun.spawn(
      [
        process.execPath,
        resolve("scripts/test-fixtures/native-signal-child.ts"),
        marker,
        late ? "late" : "plain",
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    let pid: number | undefined;
    try {
      const deadline = Date.now() + 5000;
      while (
        !(await Bun.file(marker).exists()) &&
        Date.now() < deadline &&
        wrapper.exitCode === null
      )
        await Bun.sleep(20);
      pid = Number(await Bun.file(marker).text());
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      wrapper.kill(signal);
      expect(await wrapper.exited).toBe(code);
      expect(() => process.kill(pid as number, 0)).toThrow();
      pid = undefined;
      if (late) {
        pid = Number(await Bun.file(`${marker}.late`).text());
        expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
        expect(() => process.kill(pid as number, 0)).toThrow();
        pid = undefined;
      }
    } finally {
      if (wrapper.exitCode === null) {
        wrapper.kill("SIGKILL");
        await wrapper.exited;
      }
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already reaped. */
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
}
