import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { sha256File } from "./sha256-file";
import "./verify-compact-cohort";

const source = "packages/contract/src/order.compact";
const destination = "packages/contract/generated";
const COMPILER_VERSION = "0.31.1";
const sourceHash = await sha256File(source);

const CIRCUITS = [
  "accept",
  "approve",
  "cancelReserved",
  "decline",
  "disputeBuyer",
  "disputeMerchant",
  "escalateUnreviewed",
  "expireBootstrap",
  "expireDispute",
  "expireReserved",
  "expireUndelivered",
  "reserve",
  "resolve",
  "submitDelivery",
];

const artifactPaths = (name: string): string[] => [
  `zkir/${name}.zkir`,
  `keys/${name}.prover`,
  `keys/${name}.verifier`,
];

await mkdir(".tools", { recursive: true });
const temporary = await mkdtemp(".tools/contract-build-");

try {
  const process = Bun.spawn(
    [
      ".tools/compact/compiler/compactc",
      "--sourceRoot",
      "../../src",
      source,
      temporary,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  assert.equal(await process.exited, 0, "Full Compact compilation failed");
  assert.equal(
    await sha256File(source),
    sourceHash,
    "Source changed during build",
  );

  const metadata = await Bun.file(
    `${temporary}/compiler/contract-info.json`,
  ).json();
  assert.equal(metadata["compiler-version"], COMPILER_VERSION);
  assert.deepEqual(
    metadata.circuits
      .filter((c: { proof: boolean }) => c.proof)
      .map((c: { name: string }) => c.name)
      .sort(),
    CIRCUITS,
    "The complete protocol circuit set must be present",
  );

  for (const name of CIRCUITS) {
    for (const artifact of artifactPaths(name)) {
      const file = Bun.file(`${temporary}/${artifact}`);
      assert(await file.exists(), `Missing ${artifact}`);
      assert(file.size > 0, `Empty ${artifact}`);
    }
  }

  const artifacts: Record<string, string> = {};
  const paths = [...new Bun.Glob("**/*").scanSync(temporary)].sort();
  for (const path of paths)
    artifacts[path] = await sha256File(`${temporary}/${path}`);

  await Bun.write(
    `${temporary}/compile-receipt.json`,
    `${JSON.stringify(
      {
        scope:
          "full compiler artifacts; not a transaction proof or chain receipt",
        compiler: COMPILER_VERSION,
        runtime: "0.16.0",
        source,
        sourceSha256: sourceHash,
        proofCircuits: CIRCUITS,
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
  console.log(
    `Verified full artifacts for ${CIRCUITS.length} protocol circuits.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
