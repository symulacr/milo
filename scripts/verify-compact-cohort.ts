import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { ContractState as OnchainState } from "@midnight-ntwrk/onchain-runtime-v3";

const require = createRequire(import.meta.url);
const compactEntry = require.resolve("@midnight-ntwrk/compact-runtime");
const onchainEntry = require.resolve("@midnight-ntwrk/onchain-runtime-v3");
const fromCompact = createRequire(compactEntry);

assert.equal(
  fromCompact.resolve("@midnight-ntwrk/onchain-runtime-v3"),
  onchainEntry,
  "Compact must not load a second on-chain runtime cohort",
);
assert.equal(CompactState, OnchainState, "WASM runtime identities must match");

const packageVersion = async (path: string): Promise<string> =>
  (await Bun.file(path).json()).version as string;

const versions = {
  compactRuntime: await packageVersion(
    require.resolve("@midnight-ntwrk/compact-runtime/package.json"),
  ),
  onchainRuntime: await packageVersion(
    join(dirname(onchainEntry), "package.json"),
  ),
};
assert.equal(versions.compactRuntime, "0.16.0");
assert.equal(versions.onchainRuntime, "3.1.2");

const EXPECTED_VERSIONS = [
  ["--version", "0.31.1"],
  ["--language-version", "0.23.0"],
  ["--runtime-version", "0.16.0"],
  ["--ledger-version", "ledger-8.0.2"],
] as const;

for (const [flag, expected] of EXPECTED_VERSIONS) {
  const result = Bun.spawnSync([".tools/compact/compiler/compactc", flag]);
  assert.equal(result.exitCode, 0, `Compiler ${flag} failed`);
  assert.equal(result.stdout.toString().trim(), expected, flag);
}

console.log("Compact cohort verified:", versions);
