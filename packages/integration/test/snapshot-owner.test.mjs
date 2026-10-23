// Tests for the snapshot-owner gate (wallet-state-verify G12).
//
// A snapshot records the public keys of the wallet it was taken from and nothing else that
// identifies its owner. Restoring one from a different seed yields a wallet whose own public
// key is the snapshot's while every address the lane reports is derived from the seed, so
// balances and receipts describe two different wallets. Every other gate passes: the SDK
// version matches, the indexer host matches, the file shape is valid, and the chain
// cross-checks agree with the foreign snapshot for its own address. These tests pin the one
// comparison that catches it, offline and without a seed.

import assert from "node:assert/strict";
import test from "node:test";
import { snapshotOwnerVerdict } from "../src/wallet-state-verify.mjs";

const OUR_KEYS = Object.freeze({
  unshielded:
    "27ac0e45e3c45a0d57cc8f87ef672ef653bfd022661019ac2a38d87a244217b9",
  dust: "38926421687345672793658911985937872216892240754814808051680930240026080863097",
  shielded: "85446bc7e3cc7a2c74ff1836bf1fad08663973e789a9bfccc882ea5412bf2d9a",
});

const FOREIGN_KEYS = Object.freeze({
  unshielded:
    "4d97bf248ce450f716904c6eba63409484f209589103669318c4fcb9ab456af6",
  dust: "11111111111111111111111111111111111111111111111111111111111111111",
  shielded: "2222222222222222222222222222222222222222222222222222222222222222",
});

const snapshots = (keys) => ({
  unshielded: JSON.stringify({ publicKey: { addressHex: keys.unshielded } }),
  dust: JSON.stringify({ publicKey: { publicKey: keys.dust } }),
  shielded: JSON.stringify({ publicKeys: { coinPublicKey: keys.shielded } }),
});

test("a snapshot taken from this seed passes the owner gate", () => {
  const verdict = snapshotOwnerVerdict(snapshots(OUR_KEYS), OUR_KEYS);
  assert.equal(verdict.status, "PASS");
});

test("a snapshot taken from a different seed fails the owner gate", () => {
  const verdict = snapshotOwnerVerdict(snapshots(FOREIGN_KEYS), OUR_KEYS);
  assert.equal(verdict.status, "FAIL");
  assert.equal(verdict.mismatched.length, 3);
  assert.deepEqual(
    verdict.mismatched.map((m) => m.role),
    ["unshielded", "dust", "shielded"],
  );
});

test("one mismatched role is enough to refuse the snapshot", () => {
  const mixed = { ...snapshots(OUR_KEYS), dust: snapshots(FOREIGN_KEYS).dust };
  const verdict = snapshotOwnerVerdict(mixed, OUR_KEYS);
  assert.equal(verdict.status, "FAIL");
  assert.deepEqual(
    verdict.mismatched.map((m) => m.role),
    ["dust"],
  );
});

test("the verdict carries public keys only, never key material", () => {
  const verdict = snapshotOwnerVerdict(snapshots(FOREIGN_KEYS), OUR_KEYS);
  assert.match(verdict.remedy, /different seed/);
  assert.match(verdict.remedy, /MIDNIGHT_PREPROD_RUN_DIR/);
  // The observed side is the snapshot's own public identifiers; the expected side names the
  // roles compared, never the derived values, so a receipt can be shared.
  assert.doesNotMatch(verdict.expected, /[0-9a-f]{32}/i);
});

test("an unreadable snapshot is skipped, not failed, so the shape gate owns it", () => {
  const verdict = snapshotOwnerVerdict(
    { unshielded: "not json", dust: "{}", shielded: "{}" },
    OUR_KEYS,
  );
  assert.equal(verdict.status, "UNEXERCISED");
});

test("a role with no derived key is not compared", () => {
  const verdict = snapshotOwnerVerdict(snapshots(OUR_KEYS), {
    unshielded: OUR_KEYS.unshielded,
  });
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.observed, /^unshielded$/);
});

test("the comparison is exact, not prefix or case matched", () => {
  const near = {
    ...OUR_KEYS,
    unshielded: `${OUR_KEYS.unshielded.slice(0, -1)}0`,
  };
  const verdict = snapshotOwnerVerdict(snapshots(near), OUR_KEYS);
  assert.equal(verdict.status, "FAIL");
  assert.deepEqual(
    verdict.mismatched.map((m) => m.role),
    ["unshielded"],
  );
});
