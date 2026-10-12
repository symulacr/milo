// Tests for the Blockfrost Preprod endpoint configuration and token validation.
//
// Every rejection the migration adds is exercised here: a missing token, a Mainnet token, a
// wrong-prefix token, a malformed token, a URL with credentials, a URL with a fragment, and a
// URL that already carries more than one project_id parameter. The happy path proves the
// token is appended exactly once and that the overrides still work.

import assert from "node:assert/strict";
import test from "node:test";
import {
  BlockfrostConfigError,
  blockfrostHost,
  blockfrostPreprodEndpoints,
  blockfrostProjectId,
  PREPROD_BLOCKFROST_BASES,
  redactBlockfrostUrl,
  withBlockfrostKey,
} from "../src/blockfrost.mjs";

const TOKEN = "nightpreprod" + "a".repeat(24);

test("blockfrostProjectId accepts a well-formed Midnight Preprod token", () => {
  assert.equal(
    blockfrostProjectId({ MILO_PREPROD_BLOCKFROST_PROJECT_ID: TOKEN }),
    TOKEN,
  );
  // Surrounding whitespace is trimmed, not rejected.
  assert.equal(
    blockfrostProjectId({
      MILO_PREPROD_BLOCKFROST_PROJECT_ID: `  ${TOKEN}  `,
    }),
    TOKEN,
  );
});

for (const [name, value] of Object.entries({
  missing: undefined,
  empty: "",
  whitespace: "   ",
  mainnet: "nightmainnet" + "a".repeat(24),
  wrongPrefix: "preprod" + "a".repeat(24),
  barePrefix: "nightpreprod",
  malformed: "nightpreprod!!",
  internalSpace: "nightpreprod abc",
  nonString: 12345,
})) {
  test(`blockfrostProjectId rejects ${name}`, () => {
    assert.throws(
      () => blockfrostProjectId({ MILO_PREPROD_BLOCKFROST_PROJECT_ID: value }),
      BlockfrostConfigError,
    );
  });
}

test("a Mainnet token is rejected by name, not as a generic prefix error", () => {
  assert.throws(
    () =>
      blockfrostProjectId({
        MILO_PREPROD_BLOCKFROST_PROJECT_ID: "nightmainnet" + "a".repeat(24),
      }),
    /nightmainnet/,
  );
});

test("withBlockfrostKey appends project_id exactly once", () => {
  const url = withBlockfrostKey(PREPROD_BLOCKFROST_BASES.indexer, TOKEN);
  assert.equal(`${PREPROD_BLOCKFROST_BASES.indexer}?project_id=${TOKEN}`, url);
  assert.equal(new URL(url).searchParams.getAll("project_id").length, 1);
});

test("withBlockfrostKey is idempotent and never doubles the parameter", () => {
  const once = withBlockfrostKey(PREPROD_BLOCKFROST_BASES.indexer, TOKEN);
  const twice = withBlockfrostKey(once, TOKEN);
  assert.equal(twice, once);
  assert.equal(new URL(twice).searchParams.getAll("project_id").length, 1);
});

test("withBlockfrostKey preserves an existing non-token query parameter", () => {
  const url = withBlockfrostKey(
    `${PREPROD_BLOCKFROST_BASES.indexer}?foo=bar`,
    TOKEN,
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("foo"), "bar");
  assert.equal(parsed.searchParams.get("project_id"), TOKEN);
});

test("withBlockfrostKey percent-encodes the token", () => {
  const url = withBlockfrostKey(PREPROD_BLOCKFROST_BASES.indexer, "a b&c");
  assert.equal(new URL(url).searchParams.get("project_id"), "a b&c");
  assert.equal(url.includes("project_id=a+b%26c"), true);
});

for (const [name, url, token] of [
  ["empty url", "", TOKEN],
  ["empty token", PREPROD_BLOCKFROST_BASES.indexer, ""],
  ["non-url", "not a url", TOKEN],
  ["credentials", "https://user:secret@host.example/", TOKEN],
  ["fragment", `${PREPROD_BLOCKFROST_BASES.indexer}#frag`, TOKEN],
  [
    "double project_id",
    `${PREPROD_BLOCKFROST_BASES.indexer}?project_id=a&project_id=b`,
    TOKEN,
  ],
]) {
  test(`withBlockfrostKey rejects ${name}`, () => {
    assert.throws(() => withBlockfrostKey(url, token), BlockfrostConfigError);
  });
}

test("blockfrostPreprodEndpoints resolves the four Blockfrost bases with the token once", () => {
  const ep = blockfrostPreprodEndpoints({
    MILO_PREPROD_BLOCKFROST_PROJECT_ID: TOKEN,
  });
  assert(Object.isFrozen(ep));
  for (const [key, base] of Object.entries(PREPROD_BLOCKFROST_BASES)) {
    const expected = new URL(base);
    expected.searchParams.set("project_id", TOKEN);
    assert.equal(ep[key], expected.href);
    assert.equal(new URL(ep[key]).searchParams.getAll("project_id").length, 1);
  }
  assert.equal(
    ep.indexer,
    "https://midnight-preprod.blockfrost.io/api/v0?project_id=" + TOKEN,
  );
  assert.equal(
    ep.indexerWS,
    "wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=" + TOKEN,
  );
  // A bare-host base canonicalises to a trailing slash before the query.
  assert.equal(
    ep.node,
    "https://rpc.midnight-preprod.blockfrost.io/?project_id=" + TOKEN,
  );
});

test("blockfrostPreprodEndpoints honours the MIDNIGHT_PREPROD_* overrides", () => {
  const ep = blockfrostPreprodEndpoints({
    MILO_PREPROD_BLOCKFROST_PROJECT_ID: TOKEN,
    MIDNIGHT_PREPROD_INDEXER_HTTP: "http://127.0.0.1:9999/graphql",
    MIDNIGHT_PREPROD_INDEXER_WS: "ws://127.0.0.1:9999/graphql/ws",
    MIDNIGHT_PREPROD_NODE: "http://127.0.0.1:9944",
    MIDNIGHT_PREPROD_NODE_WS: "ws://127.0.0.1:9944",
  });
  assert.equal(ep.indexer, `http://127.0.0.1:9999/graphql?project_id=${TOKEN}`);
  assert.equal(
    ep.indexerWS,
    `ws://127.0.0.1:9999/graphql/ws?project_id=${TOKEN}`,
  );
  // A bare-host override canonicalises to a trailing slash before the query.
  assert.equal(ep.node, `http://127.0.0.1:9944/?project_id=${TOKEN}`);
  assert.equal(ep.nodeWS, `ws://127.0.0.1:9944/?project_id=${TOKEN}`);
});

test("blockfrostPreprodEndpoints also accepts the MILO_PREPROD_* override names", () => {
  const ep = blockfrostPreprodEndpoints({
    MILO_PREPROD_BLOCKFROST_PROJECT_ID: TOKEN,
    MILO_PREPROD_INDEXER_HTTP: "http://127.0.0.1:9999/graphql",
  });
  assert.equal(ep.indexer, `http://127.0.0.1:9999/graphql?project_id=${TOKEN}`);
});

for (const [name, env] of Object.entries({
  "https indexer on a ws override": {
    MIDNIGHT_PREPROD_INDEXER_WS:
      "https://midnight-preprod.blockfrost.io/api/v0/ws",
  },
  "credentials in an override": {
    MIDNIGHT_PREPROD_NODE: "https://user:secret@rpc.example/",
  },
  "fragment in an override": {
    MIDNIGHT_PREPROD_INDEXER_HTTP: "https://host.example/api/v0#frag",
  },
  "non-url override": { MIDNIGHT_PREPROD_NODE: "not a url" },
})) {
  test(`blockfrostPreprodEndpoints rejects ${name}`, () => {
    assert.throws(
      () =>
        blockfrostPreprodEndpoints({
          MILO_PREPROD_BLOCKFROST_PROJECT_ID: TOKEN,
          ...env,
        }),
      BlockfrostConfigError,
    );
  });
}

test("blockfrostPreprodEndpoints requires a token before any endpoint is built", () => {
  assert.throws(() => blockfrostPreprodEndpoints({}), BlockfrostConfigError);
});

test("blockfrostHost returns the host without the token", () => {
  assert.equal(
    blockfrostHost(`${PREPROD_BLOCKFROST_BASES.indexer}?project_id=${TOKEN}`),
    "midnight-preprod.blockfrost.io",
  );
  assert.equal(blockfrostHost("not a url"), null);
});

test("redactBlockfrostUrl replaces the token and leaves other parameters", () => {
  const redacted = redactBlockfrostUrl(
    `${PREPROD_BLOCKFROST_BASES.indexer}?foo=bar&project_id=${TOKEN}`,
  );
  assert.equal(redacted.includes(TOKEN), false);
  const parsed = new URL(redacted);
  assert.equal(parsed.searchParams.get("project_id"), "<redacted>");
  assert.equal(parsed.searchParams.get("foo"), "bar");
  // A URL with no token is returned unchanged, and a non-URL is passed through.
  assert.equal(
    redactBlockfrostUrl("https://example.com/"),
    "https://example.com/",
  );
  assert.equal(redactBlockfrostUrl("not a url"), "not a url");
});
