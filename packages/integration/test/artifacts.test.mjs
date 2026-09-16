import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  artifactPaths,
  proofCircuits,
  validateArtifacts,
  validateCohort,
} from "../src/artifacts.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "milo-artifact-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "src"));
  await writeFile(
    join(directory, "src/order.compact"),
    "synthetic compiler-receipt fixture",
  );
  const receipt = {
    scope: "full compiler artifacts; not a transaction proof or chain receipt",
    compiler: "0.31.1",
    runtime: "0.16.0",
    source: "packages/contract/src/order.compact",
    sourceSha256: hash("synthetic compiler-receipt fixture"),
    proofCircuits,
    artifacts: {},
  };
  for (const path of artifactPaths) {
    const content =
      path === "compiler/contract-info.json"
        ? JSON.stringify({
            "compiler-version": "0.31.1",
            "language-version": "0.23.0",
            "runtime-version": "0.16.0",
            circuits: proofCircuits.map((name) => ({ name, proof: true })),
          })
        : `synthetic artifact ${path}`;
    await mkdir(dirname(join(directory, "generated", path)), {
      recursive: true,
    });
    await writeFile(join(directory, "generated", path), content);
    receipt.artifacts[path] = hash(content);
  }
  const writeReceipt = () =>
    writeFile(
      join(directory, "generated/compile-receipt.json"),
      JSON.stringify(receipt),
    );
  await writeReceipt();
  return { directory, receipt, writeReceipt };
}

test("MID-T01 validates all 60 actual compiler artifacts and the installed canonical cohort", async () => {
  const receipt = await validateArtifacts();
  const cohort = await validateCohort();
  assert.equal(receipt.artifactCount, 60);
  assert.equal(cohort.node, "24.20.0");
  assert.match(receipt.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(cohort.compilerFilesSha256["compactc.bin"], /^[0-9a-f]{64}$/);
});

test("MID-T01 rejects tampering with each of all 60 artifacts before funding", async (t) => {
  const { directory } = await fixture(t);
  assert.equal((await validateArtifacts(directory)).artifactCount, 60);
  for (const path of artifactPaths) {
    const file = join(directory, "generated", path);
    const original = await readFile(file);
    await writeFile(file, "tampered");
    await assert.rejects(
      validateArtifacts(directory),
      /differs from receipt/,
      path,
    );
    await writeFile(file, original);
  }
});

test("MID-T01 rejects stale source, false compiler/runtime/circuit metadata and incomplete inventory", async (t) => {
  const { directory, receipt, writeReceipt } = await fixture(t);
  const source = join(directory, "src/order.compact");
  const original = await readFile(source);
  await writeFile(source, "changed Compact source");
  await assert.rejects(validateArtifacts(directory), /source differs/);
  await writeFile(source, original);
  for (const [key, badValue] of [
    ["compiler", "0.99.0"],
    ["runtime", "0.99.0"],
    ["source", "../other.compact"],
    ["proofCircuits", []],
  ]) {
    const oldValue = receipt[key];
    receipt[key] = badValue;
    await writeReceipt();
    await assert.rejects(validateArtifacts(directory));
    receipt[key] = oldValue;
  }
  const removed = receipt.artifacts["keys/reserve.prover"];
  delete receipt.artifacts["keys/reserve.prover"];
  await writeReceipt();
  await assert.rejects(validateArtifacts(directory));
  receipt.artifacts["keys/reserve.prover"] = removed;
  receipt.artifacts["../outside"] = "0".repeat(64);
  await writeReceipt();
  await assert.rejects(validateArtifacts(directory));
  delete receipt.artifacts["../outside"];
  await writeReceipt();
  await writeFile(join(directory, "generated/unexpected.js"), "unexpected");
  await assert.rejects(validateArtifacts(directory));
  await rm(join(directory, "generated/unexpected.js"));
  const key = join(directory, "generated/keys/reserve.prover");
  await rm(key);
  await assert.rejects(validateArtifacts(directory));
  await symlink(source, key);
  await assert.rejects(validateArtifacts(directory), /symlinks/);
});
