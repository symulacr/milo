import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The indexer subscription must be handed a WebSocket constructor.
 *
 * `indexerPublicDataProvider` defaults its third parameter to `ws.WebSocket`, and
 * the SDK imports isomorphic-ws as a namespace. `isomorphic-ws/browser.js` has
 * only a default export, so that namespace has no WebSocket member and the
 * default is undefined; graphql-ws then falls back to a global lookup. The
 * browser passes its own constructor instead, from one helper, so the two call
 * sites cannot drift.
 */
const source = readFileSync(
  new URL("./runtime.ts", import.meta.url).pathname,
  "utf8",
);

describe("the indexer subscription gets an explicit WebSocket", () => {
  test("one helper, two call sites, and it passes globalThis.WebSocket", () => {
    expect([...source.matchAll(/indexerPublicDataProvider\(/g)]).toHaveLength(
      1,
    );
    expect([...source.matchAll(/browserIndexerProvider\(/g)]).toHaveLength(2);
    const helper = /const browserIndexerProvider = [\s\S]*?\n {2}\);/.exec(
      source,
    );
    expect(helper?.[0]).toMatch(/subscriptionUri,\s*globalThis\.WebSocket/);
  });

  test("no call site passes only two arguments", () => {
    expect(source).not.toMatch(
      /indexerPublicDataProvider\(\s*[^,]+,\s*[^,)]+,?\s*\)/,
    );
  });

  test("the third argument reaches the provider as a constructor", async () => {
    const calls: unknown[][] = [];
    const fake = (q: string, s: string, impl: unknown) => {
      calls.push([q, s, impl]);
      return { queryContractState: async () => null };
    };
    const provider = fake(
      "https://indexer.example/graphql",
      "wss://indexer.example/graphql",
      globalThis.WebSocket,
    );
    expect(calls[0][1]).toBe("wss://indexer.example/graphql");
    expect(calls[0][2]).toBe(globalThis.WebSocket);
    expect(await provider.queryContractState()).toBeNull();
  });
});
