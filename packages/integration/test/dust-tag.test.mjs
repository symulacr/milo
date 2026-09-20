import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { isInsufficientDust } from "../src/dust.mjs";

/**
 * The insufficiency predicate matches the literal tag "Wallet.InsufficientFunds".
 * Nothing in the source tree proves that literal still exists in the installed
 * SDK, so a rename in a future dependency bump would silently turn a recoverable
 * DUST shortfall into a hard abort. This pins the literal to the installed dist.
 */
const NODE_MODULES = "packages/integration/node_modules/@midnight-ntwrk";

/** The package the DUST retry path actually depends on. */
const DUST_PACKAGE = "wallet-sdk-dust-wallet";

async function distFiles(packageName) {
  const dist = join(NODE_MODULES, packageName, "dist");
  let names = [];
  try {
    names = await readdir(dist, { recursive: true });
  } catch {
    return [];
  }
  return names
    .filter(
      (name) =>
        typeof name === "string" &&
        (name.endsWith(".js") || name.endsWith(".d.ts")),
    )
    .map((name) => join(dist, name));
}

test("the installed dust package still declares the insufficiency tag verbatim", async () => {
  const files = await distFiles(DUST_PACKAGE);
  assert.ok(files.length > 0, `no dist files found for ${DUST_PACKAGE}`);
  // Exact-tag match: a renamed variant such as Wallet.InsufficientFundsV2 must
  // not satisfy this, because the predicate matches the tag exactly.
  const exact = /"Wallet\.InsufficientFunds"/;
  let hits = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (exact.test(source)) hits += 1;
  }
  assert.ok(
    hits > 0,
    `"Wallet.InsufficientFunds" is absent from the installed ${DUST_PACKAGE} dist`,
  );
});

test("the predicate only matches that tag shape", () => {
  assert.equal(
    isInsufficientDust({ _tag: "Wallet.InsufficientFunds", tokenType: "dust" }),
    true,
  );
  assert.equal(isInsufficientDust({ _tag: "Wallet.Transacting" }), false);
  assert.equal(isInsufficientDust(null), false);
});
