/**
 * Typed Midnight indexer GraphQL client (convergence CVG2).
 * Single place for GraphQL strings used by ingest/observer/diagnostics.
 */
export type IndexerEndpoints = {
  http: string;
  ws: string;
};

export async function indexerQuery<T>(
  endpoints: IndexerEndpoints,
  query: string,
  variables?: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(endpoints.http, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: unknown[] };
  if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
  if (!body.data) throw new Error("indexer empty data");
  return body.data;
}

export const INDEXER_QUERIES = {
  block: `query { block { height hash } }`,
  txByHash: `query ($hash: String!) { transactions(offset: { hash: $hash }) { hash block { height } } }`,
  contractAction: `query ($address: String!) { contractAction(address: $address) { __address address state transaction { hash block { height } } } }`,
} as const;
