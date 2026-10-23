export type IndexerEndpoints = {
  http: string;
  ws: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const INDEXER_TIMEOUT_MS = 15_000;
const INDEXER_HEADERS = { "content-type": "application/json" } as const;

export async function indexerQuery<T>(
  endpoints: IndexerEndpoints,
  query: string,
  variables?: Record<string, unknown>,
  fetchImpl: FetchLike = fetch as never,
): Promise<T> {
  const res = await fetchImpl(endpoints.http, {
    method: "POST",
    headers: INDEXER_HEADERS,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(INDEXER_TIMEOUT_MS),
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
