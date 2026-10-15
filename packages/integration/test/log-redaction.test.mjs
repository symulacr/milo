// Tests for the process-boundary token redaction.
//
// The Blockfrost token cannot leave the endpoint URL (the wallet SDK's indexer client takes a
// plain URL and browser WebSockets cannot set headers), and the Midnight SDK's RPC logger
// writes those URLs on a disconnect. These tests hold the boundary guard to its contract:
// the token never reaches a stream, while every other byte of the diagnostic does.

import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import {
  installLogRedaction,
  REDACTED,
  redactText,
} from "../src/log-redaction.mjs";

const TOKEN = `nightpreprod${"a".repeat(24)}`;

class Capture extends Writable {
  constructor() {
    super();
    this.text = "";
  }
  _write(chunk, _encoding, callback) {
    this.text += chunk.toString("utf8");
    callback();
  }
}

test("redactText removes the token and leaves the rest of the line intact", () => {
  const line = `RPC-CORE: disconnected from wss://host/api/v0/ws?project_id=${TOKEN}: 1000`;
  const out = redactText(line, TOKEN);
  assert.ok(!out.includes(TOKEN), "token must not survive");
  assert.ok(out.includes(REDACTED), "the redaction marker must appear");
  assert.ok(
    out.startsWith("RPC-CORE: disconnected from wss://host"),
    "the diagnostic around the token must survive",
  );
});

test("redactText is a no-op without a token and when the token is absent", () => {
  assert.equal(redactText("plain", ""), "plain");
  assert.equal(redactText("plain", TOKEN), "plain");
});

test("installLogRedaction strips the token from a string write", () => {
  const stream = new Capture();
  assert.equal(installLogRedaction(TOKEN, [stream]), 1);
  stream.write(`url=wss://host/ws?project_id=${TOKEN}\n`);
  assert.ok(!stream.text.includes(TOKEN));
  assert.ok(stream.text.includes("wss://host/ws"));
});

test("installLogRedaction strips the token from a Buffer write", () => {
  const stream = new Capture();
  installLogRedaction(TOKEN, [stream]);
  stream.write(Buffer.from(`url=wss://host/ws?project_id=${TOKEN}`, "utf8"));
  assert.ok(!stream.text.includes(TOKEN));
  assert.ok(stream.text.includes("wss://host/ws"));
});

test("installLogRedaction is a no-op for an absent token", () => {
  const stream = new Capture();
  assert.equal(installLogRedaction("", [stream]), 0);
  const before = stream.write;
  stream.write("untouched\n");
  assert.equal(stream.write, before, "the stream must not be patched");
  assert.equal(stream.text, "untouched\n");
});

test("installLogRedaction does not wrap an already-patched stream twice", () => {
  const stream = new Capture();
  assert.equal(installLogRedaction(TOKEN, [stream]), 1);
  assert.equal(
    installLogRedaction(TOKEN, [stream]),
    0,
    "second install is a no-op",
  );
  stream.write(`wss://host/ws?project_id=${TOKEN}`);
  assert.ok(!stream.text.includes(TOKEN));
  assert.equal(
    stream.text.split(REDACTED).length - 1,
    1,
    "the marker must appear exactly once, not once per wrapping",
  );
});
