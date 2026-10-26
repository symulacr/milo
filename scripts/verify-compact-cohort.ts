import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { ContractState as OnchainState } from "@midnight-ntwrk/onchain-runtime-v3";

const require = createRequire(import.meta.url);
const compactEntry = require.resolve("@midnight-ntwrk/compact-runtime");
const onchainEntry = require.resolve("@midnight-ntwrk/onchain-runtime-v3");
const fromCompact = createRequire(compactEntry);

/** The vendored compiler, resolved from the repo root so the check does not depend
 * on the caller's cwd. */
const COMPILER = join(
  import.meta.dir,
  "..",
  ".tools/compact/compiler/compactc",
);
const CONTRACT_SOURCE = join(
  import.meta.dir,
  "..",
  "packages/contract/src/order.compact",
);

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

const reported = new Map<string, string>();
for (const [flag, expected] of EXPECTED_VERSIONS) {
  const result = Bun.spawnSync([COMPILER, flag]);
  assert.equal(result.exitCode, 0, `Compiler ${flag} failed`);
  const actual = result.stdout.toString().trim();
  reported.set(flag, actual);
  assert.equal(actual, expected, flag);
}

// A bare `compact update` installs the newest toolchain and makes it the default;
// toolchains 0.34/0.35 target ledger 9 and cannot deploy to a ledger-8 network
// (docs.midnight.network/relnotes/support-matrix, 2026-10-23). The version flags
// above catch that only if this exact binary is the one that runs, so two more
// assertions close the gap the flags cannot:
//
// 1. No shadowing compiler. A toolchain manager puts its own `compactc` on PATH,
//    and a build that resolved that one instead would report ledger 9 while this
//    file kept asserting the vendored path.
const shadow = Bun.which("compactc");
assert.ok(
  shadow === null || shadow === COMPILER,
  `PATH resolves compactc to ${shadow}, not the pinned ${COMPILER}`,
);

// 2. The source pragma agrees with the compiler's language version. This is the
//    silent-switch detector: a newer default toolchain requires a newer pragma, so
//    a stale pragma means the two have diverged. Compared as major.minor because
//    the pragma is written `0.23` and the compiler reports `0.23.0`.
const pragma = (await Bun.file(CONTRACT_SOURCE).text()).match(
  /^\s*pragma\s+language_version\s+([0-9]+\.[0-9]+)/m,
);
assert.ok(pragma, `No pragma language_version in ${CONTRACT_SOURCE}`);
const language = reported.get("--language-version") ?? "";
assert.equal(
  pragma[1],
  language.split(".").slice(0, 2).join("."),
  `pragma ${pragma[1]} does not match compiler language ${language}`,
);

console.log("Compact cohort verified:", versions);
