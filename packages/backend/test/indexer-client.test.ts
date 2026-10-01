import { describe, expect, test } from "bun:test";
import { INDEXER_QUERIES, indexerQuery } from "../src/indexer-client";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const okFetch: FetchLike = async () =>
  new Response(JSON.stringify({ data: { block: { height: 1, hash: "h" } } }), {
    status: 200,
  });

describe("indexer-client (CVG2)", () => {
  test("parses data", async () => {
    const ok = await indexerQuery(
      { http: "http://x/gql", ws: "ws://x/gql" },
      INDEXER_QUERIES.block,
      undefined,
      okFetch,
    );
    expect((ok as { block: { height: number } }).block.height).toBe(1);
  });
  test("rejects HTTP errors", async () => {
    await expect(
      indexerQuery(
        { http: "http://x", ws: "ws://x" },
        INDEXER_QUERIES.block,
        undefined,
        async () => new Response("no", { status: 500 }),
      ),
    ).rejects.toThrow(/500/);
  });
  test("rejects GraphQL errors", async () => {
    await expect(
      indexerQuery(
        { http: "http://x", ws: "ws://x" },
        INDEXER_QUERIES.block,
        undefined,
        async () =>
          new Response(JSON.stringify({ errors: ["bad"] }), { status: 200 }),
      ),
    ).rejects.toThrow(/bad/);
  });
});
