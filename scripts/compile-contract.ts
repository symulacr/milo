import assert from "node:assert/strict";
import { statSync } from "node:fs";
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

// The compiler is the slowest step in the repo (~2.5 min for 14 circuits) and
// its output tree already carries a receipt naming the source hash, the
// compiler version and every artifact hash. So an unchanged source is proved
// current by re-hashing the artifacts (~0.2 s) instead of recompiling. The
// receipt is written by this script, so trusting it is not a new assumption;
// a missing, extra or altered artifact invalidates the cache, and `--force`
// recompiles regardless.
const receiptPath = `${destination}/compile-receipt.json`;
const cached = async (): Promise<boolean> => {
  const receipt = await Bun.file(receiptPath)
    .json()
    .catch(() => undefined);
  const artifacts: Record<string, string> | undefined = receipt?.artifacts;
  if (
    !artifacts ||
    receipt.compiler !== COMPILER_VERSION ||
    receipt.runtime !== "0.16.0" ||
    receipt.sourceSha256 !== sourceHash
  )
    return false;
  // `scanSync` yields directories as well as files, so compare file sets only:
  // an extra file means the tree is not the one the receipt describes.
  const found = [...new Bun.Glob("**/*").scanSync(destination)].filter((path) =>
    statSync(`${destination}/${path}`).isFile(),
  );
  const expected = [...Object.keys(artifacts), "compile-receipt.json"];
  if (found.length !== expected.length) return false;
  if (found.some((path) => !expected.includes(path))) return false;
  for (const [path, hash] of Object.entries(artifacts))
    if ((await sha256File(`${destination}/${path}`)) !== hash) return false;
  return true;
};

if (!process.argv.includes("--force") && (await cached())) {
  console.log(
    `Cached: ${CIRCUITS.length} protocol circuits match ${sourceHash.slice(0, 12)}.`,
  );
  process.exit(0);
}

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
