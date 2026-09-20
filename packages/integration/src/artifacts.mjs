import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The pinned toolchain cohort. Consumers assert against these, never literals. */
export const TOOLCHAIN = Object.freeze({
  compiler: "0.31.1",
  runtime: "0.16.0",
  language: "0.23.0",
});

export const proofCircuits = [
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
export const artifactPaths = [
  "compiler/contract-info.json",
  "contract/index.d.ts",
  "contract/index.js",
  "contract/index.js.map",
  ...proofCircuits.flatMap((name) => [
    `keys/${name}.prover`,
    `keys/${name}.verifier`,
    `zkir/${name}.bzkir`,
    `zkir/${name}.zkir`,
  ]),
].sort();
const contractDirectory = fileURLToPath(
  new URL("../../contract/", import.meta.url),
);
const sourcePath = "packages/contract/src/order.compact";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fileHash(path) {
  assert((await lstat(path)).isFile(), "Expected a regular artifact file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function inventory(directory, prefix = "") {
  assert(
    (await lstat(directory)).isDirectory(),
    "Expected a regular artifact directory",
  );
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Artifact symlinks are forbidden");
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      paths.push(...(await inventory(join(directory, entry.name), `${path}/`)));
    else {
      assert(entry.isFile(), "Expected a regular artifact file");
      paths.push(path);
    }
  }
  return paths.sort();
}

export async function validateArtifacts(directory = contractDirectory) {
  const generated = join(directory, "generated");
  const receiptBytes = await readFile(join(generated, "compile-receipt.json"));
  const receipt = JSON.parse(receiptBytes);
  assert.equal(
    receipt.scope,
    "full compiler artifacts; not a transaction proof or chain receipt",
  );
  assert.equal(receipt.compiler, TOOLCHAIN.compiler);
  assert.equal(receipt.runtime, TOOLCHAIN.runtime);
  assert.equal(receipt.source, sourcePath);
  assert.deepEqual(receipt.proofCircuits, proofCircuits);
  assert.deepEqual(Object.keys(receipt.artifacts).sort(), artifactPaths);
  assert.deepEqual(
    await inventory(generated),
    [...artifactPaths, "compile-receipt.json"].sort(),
  );
  const sourceSha256 = await fileHash(join(directory, "src/order.compact"));
  assert.equal(
    receipt.sourceSha256,
    sourceSha256,
    "Compact source differs from compiler receipt",
  );
  const artifacts = {};
  for (const path of artifactPaths) {
    assert.match(receipt.artifacts[path], /^[0-9a-f]{64}$/);
    assert(
      (await lstat(join(generated, path))).size > 0,
      "Empty compiler artifact",
    );
    artifacts[path] = await fileHash(join(generated, path));
    assert.equal(
      artifacts[path],
      receipt.artifacts[path],
      "Compiler artifact differs from receipt",
    );
  }
  const metadata = JSON.parse(
    await readFile(join(generated, "compiler/contract-info.json")),
  );
  assert.equal(metadata["compiler-version"], "0.31.1");
  assert.equal(metadata["language-version"], "0.23.0");
  assert.equal(metadata["runtime-version"], "0.16.0");
  assert.deepEqual(
    metadata.circuits
      .filter((circuit) => circuit.proof)
      .map((circuit) => circuit.name)
      .sort(),
    proofCircuits,
  );
  return {
    source: sourcePath,
    sourceSha256,
    compiler: receipt.compiler,
    language: "0.23.0",
    runtime: receipt.runtime,
    compileReceiptSha256: sha256(receiptBytes),
    artifactCount: artifactPaths.length,
    artifactSetSha256: sha256(JSON.stringify(artifacts)),
    artifacts,
  };
}

export async function validateCohort() {
  assert.equal(
    process.versions.node,
    "24.20.0",
    "Canonical isolated Node runtime required",
  );
  const sdkPackages = [
    "testkit-js",
    "midnight-js-compact",
    "midnight-js-contracts",
    "midnight-js-network-id",
    "midnight-js-protocol",
    "midnight-js-node-zk-config-provider",
    "midnight-js-http-client-proof-provider",
    "midnight-js-indexer-public-data-provider",
  ];
  const expected = {
    ...Object.fromEntries(
      sdkPackages.map((name) => [`@midnight-ntwrk/${name}`, "4.1.1"]),
    ),
    "@midnight-ntwrk/compact-runtime": "0.16.0",
    "@midnight-ntwrk/onchain-runtime-v3": "3.1.1",
    "@midnight-ntwrk/ledger-v8": "8.1.2",
    "@midnight-ntwrk/wallet-sdk": "1.2.0",
    "@polkadot/api": "16.5.6",
    rxjs: "7.8.2",
  };
  const packageBytes = await readFile(
    new URL("../package.json", import.meta.url),
  );
  const lockBytes = await readFile(
    new URL("../package-lock.json", import.meta.url),
  );
  const manifest = JSON.parse(packageBytes);
  const lock = JSON.parse(lockBytes);
  assert.deepEqual(manifest.dependencies, expected);
  assert.deepEqual(lock.packages[""].dependencies, expected);
  assert.equal(manifest.engines.node, "24.20.0");
  assert.equal(lock.packages[""].engines.node, "24.20.0");
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    const entry =
      name === "@midnight-ntwrk/midnight-js-compact"
        ? `${name}/dist/fetch-compact.mjs`
        : name;
    let directory = dirname(fileURLToPath(import.meta.resolve(entry)));
    let installed;
    while (directory !== dirname(directory)) {
      try {
        const candidate = JSON.parse(
          await readFile(join(directory, "package.json")),
        );
        if (candidate.name === name) {
          installed = candidate;
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      directory = dirname(directory);
    }
    assert.equal(
      installed?.version,
      version,
      "Installed direct dependency differs from cohort",
    );
  }
  const compilerDirectory = fileURLToPath(
    new URL("../../../.tools/compact/compiler/", import.meta.url),
  );
  const compilerFiles = {};
  for (const name of ["compactc", "compactc.bin", "zkir", "zkir-v3"]) {
    compilerFiles[name] = await fileHash(join(compilerDirectory, name));
  }
  return {
    node: process.versions.node,
    packages: expected,
    packageSha256: sha256(packageBytes),
    lockfileSha256: sha256(lockBytes),
    compilerFilesSha256: compilerFiles,
  };
}
