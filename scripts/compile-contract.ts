import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import "./verify-compact-cohort";

const source = "packages/contract/src/order.compact";
const destination = "packages/contract/generated";
const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");
const sourceHash = await sha256(source);
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
  assert.equal(await sha256(source), sourceHash, "Source changed during build");

  const metadata = await Bun.file(
    `${temporary}/compiler/contract-info.json`,
  ).json();
  assert.equal(metadata["compiler-version"], "0.31.1");
  const circuits = [
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
  assert.deepEqual(
    metadata.circuits
      .filter((c: { proof: boolean }) => c.proof)
      .map((c: { name: string }) => c.name)
      .sort(),
    circuits,
    "The complete protocol circuit set must be present",
  );

  // The compiler may exit successfully without keys when zkir is unavailable.
  for (const name of circuits) {
    for (const artifact of [
      `zkir/${name}.zkir`,
      `keys/${name}.prover`,
      `keys/${name}.verifier`,
    ]) {
      const file = Bun.file(`${temporary}/${artifact}`);
      assert(await file.exists(), `Missing ${artifact}`);
      assert(file.size > 0, `Empty ${artifact}`);
    }
  }

  const artifacts: Record<string, string> = {};
  const paths = [...new Bun.Glob("**/*").scanSync(temporary)].sort();
  for (const path of paths)
    artifacts[path] = await sha256(`${temporary}/${path}`);
  await Bun.write(
    `${temporary}/compile-receipt.json`,
    `${JSON.stringify(
      {
        scope:
          "full compiler artifacts; not a transaction proof or chain receipt",
        compiler: "0.31.1",
        runtime: "0.16.0",
        source,
        sourceSha256: sourceHash,
        proofCircuits: circuits,
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
  console.log(
    `Verified full artifacts for ${circuits.length} protocol circuits.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
