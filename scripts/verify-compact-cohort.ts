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

const versions = {
  compactRuntime: (
    await Bun.file(
      require.resolve("@midnight-ntwrk/compact-runtime/package.json"),
    ).json()
  ).version as string,
  onchainRuntime: (
    await Bun.file(join(dirname(onchainEntry), "package.json")).json()
  ).version as string,
};
assert.equal(versions.compactRuntime, "0.16.0");
assert.equal(versions.onchainRuntime, "3.0.0");

for (const [flag, expected] of [
  ["--version", "0.31.1"],
  ["--language-version", "0.23.0"],
  ["--runtime-version", "0.16.0"],
  ["--ledger-version", "ledger-8.0.2"],
] as const) {
  const result = Bun.spawnSync([".tools/compact/compiler/compactc", flag]);
  assert.equal(result.exitCode, 0, `Compiler ${flag} failed`);
  assert.equal(result.stdout.toString().trim(), expected, flag);
}

console.log("Compact cohort verified:", versions);
