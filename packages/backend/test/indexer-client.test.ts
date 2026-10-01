import { describe, expect, test } from "bun:test";
import { INDEXER_QUERIES, indexerQuery } from "../src/indexer-client";

describe("indexer-client (CVG2)", () => {
  test("parses data and rejects HTTP errors", async () => {
    const ok = await indexerQuery(
      { http: "http://x/gql", ws: "ws://x/gql" },
      INDEXER_QUERIES.block,
      undefined,
      async () =>
        new Response(JSON.stringify({ data: { block: { height: 1, hash: "h" } } }), {
          status: 200,
        }),
    );
    expect((ok as { block: { height: number } }).block.height).toBe(1);
    await expect(
      indexerQuery({ http: "http://x", ws: "ws://x" }, INDEXER_QUERIES.block, undefined, async () => new Response("no", { status: 500 })),
    ).rejects.toThrow(/500/);
    await expect(
      indexerQuery({ http: "http://x", ws: "ws://x" }, INDEXER_QUERIES.block, undefined, async () =>
        new Response(JSON.stringify({ errors: ["bad"] }), { status: 200 }),
      ),
    ).rejects.toThrow(/bad/);
  });
});
