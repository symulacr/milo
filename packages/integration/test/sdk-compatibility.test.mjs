import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  MidnightBech32m,
  UnshieldedAddress,
  WalletFacade,
} from "@midnight-ntwrk/wallet-sdk";

test("installed wallet barrel is the exact official Preprod cohort pin", async () => {
  const installed = JSON.parse(
    await readFile(
      findPackageJSON("@midnight-ntwrk/wallet-sdk", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(installed.version, "1.2.0");
});

test("installed 1.2.0 codec round-trips preprod and rejects cross-network decoding", () => {
  assert.equal(process.versions.node, "24.20.0");
  const address = new UnshieldedAddress(Buffer.alloc(32, 7));
  const encoded = MidnightBech32m.encode("preprod", address).asString();
  assert.equal(
    MidnightBech32m.parse(encoded).decode(UnshieldedAddress, "preprod")
      .hexString,
    address.hexString,
  );
  for (const network of ["undeployed", "preview", "mainnet"]) {
    assert.throws(() =>
      MidnightBech32m.parse(encoded).decode(UnshieldedAddress, network),
    );
  }
});

test("SDK deployment exports and wallet recipe interfaces load without constructing wallets", () => {
  assert.equal(typeof deployContract, "function");
  assert.equal(typeof findDeployedContract, "function");
  for (const method of [
    "transferTransaction",
    "signRecipe",
    "finalizeRecipe",
    "submitTransaction",
  ]) {
    assert.equal(typeof WalletFacade.prototype[method], "function");
  }
});

test("testkit's retained 1.1.0 barrel shares concrete facade and ledger with 1.2.0", async () => {
  const testkitEntry = import.meta.resolve("@midnight-ntwrk/testkit-js");
  const walletPackage = findPackageJSON(
    "@midnight-ntwrk/wallet-sdk",
    testkitEntry,
  );
  const walletEntry = pathToFileURL(
    join(dirname(walletPackage), "dist/index.js"),
  );
  for (const dependency of [
    "@midnight-ntwrk/ledger-v8",
    "@midnight-ntwrk/wallet-sdk-facade",
    "@midnight-ntwrk/wallet-sdk-address-format",
  ]) {
    assert.equal(
      findPackageJSON(dependency, walletEntry),
      findPackageJSON(dependency, import.meta.url),
    );
  }
  const testkitWallet = await import(walletEntry);
  assert.equal(testkitWallet.WalletFacade, WalletFacade);
  assert.equal(testkitWallet.UnshieldedAddress, UnshieldedAddress);
});
