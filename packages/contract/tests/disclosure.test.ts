import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("M-02 explicit-disclosure compiler canary rejects an undisclosed role secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "milo-disclosure-"));
  try {
    const source = await Bun.file("packages/contract/src/order.compact").text();
    const assignment = "deliveryCommitment = c;";
    expect(source.split(assignment)).toHaveLength(2);
    const path = join(directory, "order.compact");
    await writeFile(
      path,
      source.replace(assignment, "deliveryCommitment = buyerSecret();"),
    );
    const compiler = Bun.spawn(
      [
        resolve(".tools/compact/compiler/compactc"),
        "--skip-zk",
        path,
        join(directory, "generated"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(compiler.stdout).text(),
      new Response(compiler.stderr).text(),
      compiler.exited,
    ]);
    expect(exitCode).not.toBe(0);
    expect(`${stdout}\n${stderr}`).toMatch(/disclos/i);
    expect(`${stdout}\n${stderr}`).toContain("buyerSecret");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
