// G13: the receipt on disk must describe the snapshot on disk.
//
// This is the defect the real `.hoplite/artifacts/preprod` pair exhibits: a receipt
// with `safeForFastPath: true` written for shielded.json at 4006 B and dust.json at
// 7893 B, sitting beside files of 3542 B and 14473807 B written a day later. Every
// other gate re-derives its answer from whatever is on disk now, so the stale receipt
// was invisible to all of them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  GATE_DEFINITION,
  verifyWalletState,
  WALLET_STATE_FILES,
} from "../src/wallet-state-verify.mjs";

const dirs = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
const sha = (t) => createHash("sha256").update(t).digest("hex");

/** A triple the real parser accepts, so the only check that can refuse it is G13. */
const SNAPSHOT = {
  "shielded.json": JSON.stringify({
    networkId: "preprod",
    protocolVersion: "1",
    offset: "5",
    state: "00",
    publicKey: { coinPublicKey: "aa" },
  }),
  "unshielded.json": JSON.stringify({
    networkId: "preprod",
    protocolVersion: "1",
    appliedId: "5",
    state: { availableUtxos: [], pendingUtxos: [] },
    publicKey: { address: "mn_addr_preprod1example" },
  }),
  "dust.json": JSON.stringify({
    networkId: "preprod",
    protocolVersion: "1",
    offset: "5",
    state: "00",
    publicKey: { publicKey: "42" },
  }),
};

/** A receipt whose recorded hashes match SNAPSHOT, with per-file overrides. */
const receiptFor = (overrides = {}) => ({
  tool: "wallet-state-verify",
  version: 1,
  verdict: { safeForFastPath: true, passed: 17, failed: 0 },
  snapshotFiles: Object.fromEntries(
    Object.entries(SNAPSHOT).map(([file, text]) => [
      file.replace(".json", ""),
      { file, sha256: sha(text), bytes: text.length, ...overrides[file] },
    ]),
  ),
});

/** Run the real verifier with every network check stubbed out, so only the
 * filesystem checks (including G13) can decide the verdict. */
const runGate = async (receipt) => {
  const dir = await mkdtemp(join(tmpdir(), "w4-g13-"));
  dirs.push(dir);
  for (const [file, text] of Object.entries(SNAPSHOT))
    await writeFile(join(dir, file), text);
  if (receipt !== undefined)
    await writeFile(
      join(dir, "verification-receipt.json"),
      typeof receipt === "string" ? receipt : JSON.stringify(receipt),
    );
  const out = await verifyWalletState(dir, {
    writeReceipt: false,
    timeoutMs: 5_000,
    chainTimeoutMs: 5_000,
    quietMs: 500,
    endpoints: {
      indexer: "http://127.0.0.1:1/graphql",
      indexerWS: "ws://127.0.0.1:1/ws",
      node: "http://127.0.0.1:1",
      nodeWS: "ws://127.0.0.1:1",
    },
  });
  return out.receipt.checks.find((c) => c.id === "receipt-freshness");
};

describe("G13 receipt freshness", () => {
  test("is a declared gate condition, so the written definition stays honest", () => {
    const g13 = GATE_DEFINITION.conditions.find((c) => c.id === "G13");
    assert.ok(g13, "G13 must be in GATE_DEFINITION");
    assert.equal(g13.check, "receipt-freshness");
    assert.match(g13.text, /sha256/);
  });

  test("a receipt written for the files on disk passes", async () => {
    assert.equal((await runGate(receiptFor())).status, "PASS");
  });

  test("a receipt for a different dust.json fails, naming both sides", async () => {
    // The exact shape of the real defect: the receipt says 7893 B, the file on
    // disk is 14473807 B.
    const g13 = await runGate(
      receiptFor({ "dust.json": { sha256: sha("older"), bytes: 7893 } }),
    );
    assert.equal(g13.status, "FAIL");
    assert.match(g13.observed, /dust/);
    assert.match(g13.observed, /7893B/);
    assert.match(g13.observed, /vs disk/);
  });

  test("a receipt for a different shielded.json also fails", async () => {
    const g13 = await runGate(
      receiptFor({ "shielded.json": { sha256: sha("older"), bytes: 4006 } }),
    );
    assert.equal(g13.status, "FAIL");
  });

  test("no receipt at all is UNEXERCISED, not a failure", async () => {
    const g13 = await runGate();
    assert.equal(g13.status, "UNEXERCISED");
    assert.match(g13.requires, /verification-receipt\.json/);
  });

  test("an unreadable receipt fails instead of being ignored", async () => {
    const g13 = await runGate("{ not json");
    assert.equal(g13.status, "FAIL");
    assert.match(g13.observed, /unreadable receipt/);
  });

  test("a receipt recording only some roles still checks the ones it has", async () => {
    const partial = receiptFor();
    delete partial.snapshotFiles["shielded.json"];
    assert.equal((await runGate(partial)).status, "PASS");
  });

  test("the three roles the gate compares are the three snapshots", () => {
    assert.deepEqual(Object.keys(WALLET_STATE_FILES).sort(), [
      "dust",
      "shielded",
      "unshielded",
    ]);
  });
});
