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

async function distFiles() {
  const files = [];
  for (const entry of await readdir(NODE_MODULES, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("wallet-sdk")) continue;
    const dist = join(NODE_MODULES, entry.name, "dist");
    let names = [];
    try {
      names = await readdir(dist, { recursive: true });
    } catch {
      continue;
    }
    for (const name of names) {
      if (
        typeof name === "string" &&
        (name.endsWith(".js") || name.endsWith(".d.ts"))
      )
        files.push(join(dist, name));
    }
  }
  return files;
}

test("the installed wallet-sdk still declares the insufficiency tag", async () => {
  const files = await distFiles();
  assert.ok(files.length > 0, "no wallet-sdk dist files found");
  let hits = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("Wallet.InsufficientFunds")) hits += 1;
  }
  assert.ok(
    hits > 0,
    "Wallet.InsufficientFunds is absent from the installed wallet-sdk dist",
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
