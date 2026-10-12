// Tests for the snapshot/indexer-marker decision (wallet-state-verify G11).
//
// The migration makes old sync state non-portable: a snapshot written against the
// Midnight-hosted indexer cannot be restored against Blockfrost. The lane records the indexer
// host beside each snapshot and refuses to restore one whose host does not match. These tests
// cover the pure decision function and the marker read/write round-trip, offline.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  INDEXER_MARKER_FILE,
  indexerMarkerVerdict,
  inspectIndexerMarker,
  writeIndexerMarker,
} from "../src/wallet-state-verify.mjs";

const HOST = "midnight-preprod.blockfrost.io";
const OLD_HOST = "indexer.preprod.midnight.network";

test("a matching indexer host passes the marker gate", () => {
  const verdict = indexerMarkerVerdict(
    { exists: true, indexerHost: HOST, path: "/x" },
    HOST,
  );
  assert.equal(verdict.status, "PASS");
});

test("a snapshot from a different indexer fails the marker gate", () => {
  const verdict = indexerMarkerVerdict(
    { exists: true, indexerHost: OLD_HOST, path: "/x" },
    HOST,
  );
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.remedy, /not portable/);
  assert.match(verdict.observed, new RegExp(OLD_HOST));
});

test("the refusal remedy never prescribes a genesis sync", () => {
  // The operator rule forbids starting from genesis. Refusing the fast path must point at
  // the dust re-seed from the current collapsed update, not at a full from-genesis sync.
  for (const marker of [
    { exists: true, indexerHost: OLD_HOST, path: "/x" },
    { exists: true, indexerHost: null, path: "/x" },
  ]) {
    const verdict = indexerMarkerVerdict(marker, HOST);
    assert.equal(verdict.status, "FAIL");
    assert.doesNotMatch(verdict.remedy, /genesis/i);
    assert.match(verdict.remedy, /collapsed update/);
    assert.match(verdict.remedy, /tip/);
  }
});

test("a snapshot with no marker is unexercised, so the fast path is refused", () => {
  const verdict = indexerMarkerVerdict(
    { exists: false, indexerHost: null, path: "/x/indexer.json" },
    HOST,
  );
  assert.equal(verdict.status, "UNEXERCISED");
  assert.equal(verdict.requires, "/x/indexer.json");
});

test("a marker without a readable host fails the gate", () => {
  const verdict = indexerMarkerVerdict(
    { exists: true, indexerHost: null, path: "/x" },
    HOST,
  );
  assert.equal(verdict.status, "FAIL");
});

test("writeIndexerMarker records the host, never the token, and round-trips", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "milo-marker-"));
  try {
    const url = `https://${HOST}/api/v0?project_id=nightpreprodSECRET`;
    const host = await writeIndexerMarker(dir, url);
    assert.equal(host, HOST);
    const raw = await (await import("node:fs/promises")).readFile(
      resolve(dir, INDEXER_MARKER_FILE),
      "utf8",
    );
    assert.equal(raw.includes("nightpreprodSECRET"), false);
    const inspected = await inspectIndexerMarker(dir);
    assert.equal(inspected.exists, true);
    assert.equal(inspected.indexerHost, HOST);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inspectIndexerMarker reports a missing marker and an unreadable one", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "milo-marker-"));
  try {
    const missing = await inspectIndexerMarker(dir);
    assert.equal(missing.exists, false);
    assert.equal(missing.indexerHost, null);

    await writeFile(resolve(dir, INDEXER_MARKER_FILE), "not json");
    const unreadable = await inspectIndexerMarker(dir);
    assert.equal(unreadable.exists, true);
    assert.equal(unreadable.indexerHost, null);

    await writeFile(
      resolve(dir, INDEXER_MARKER_FILE),
      '{"networkId":"preprod"}',
    );
    const noHost = await inspectIndexerMarker(dir);
    assert.equal(noHost.exists, true);
    assert.equal(noHost.indexerHost, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeIndexerMarker refuses a non-URL endpoint", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "milo-marker-"));
  try {
    await assert.rejects(writeIndexerMarker(dir, "not a url"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
