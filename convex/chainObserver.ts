import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { bytesToHex, hexToBytes } from "../packages/backend/src/encoding";

const PENDING_LIMIT = 25;
const FINALITY_DEPTH = 3;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000] as const;
const BACKOFF_JITTER = 0.25;
const REQUEST_TIMEOUT_MS = 15_000;

export const PHASES = [
  "DEPLOYED",
  "RESERVED",
  "ACCEPTED",
  "SUBMITTED",
  "DISPUTED",
  "APPROVED",
  "CANCELLED",
] as const;

export type Phase = (typeof PHASES)[number];

const PHASE_SET: ReadonlySet<string> = new Set(PHASES);
const THROTTLE_PATTERN = /throttl|rate.?limit|too many requests/i;
const ZERO_COMMITMENT = "0".repeat(64);

const LATEST_CONTRACT_STATE = `query LatestContractState($address: HexEncoded!) {
  contractAction(address: $address) {
    __typename
    address
    state
    transaction { id hash block { height hash protocolVersion } }
  }
}`;

const HEAD_BLOCK = `query { block { height } }`;

export type ContractAction = {
  state: string;
  transaction: {
    hash: string;
    block: { height: number; hash: string };
  } | null;
};

export type DecodedState = {
  phase: Phase;
  revision: number;
  deliveryManifest: string | null;
};

export type ObservationPlan =
  | {
      kind: "project";
      stateHex: string;
      phase: Phase;
      revision: number;
      deliveryManifest: string | null;
      blockHeight: number;
      blockHash: string;
    }
  | { kind: "unchanged" }
  | { kind: "immature"; headHeight: number; blockHeight: number }
  | { kind: "absent" };

const isPhase = (value: unknown): value is Phase =>
  typeof value === "string" && PHASE_SET.has(value);

const isIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function planObservation(input: {
  action: ContractAction | null | undefined;
  headHeight: number;
  lastStateHex?: string | null;
  decode: (stateHex: string) => DecodedState;
}): ObservationPlan {
  const action = input.action;
  if (!action || typeof action.state !== "string" || action.state.length === 0)
    return { kind: "absent" };
  const block = action.transaction?.block;
  if (!block || !isIndex(block.height)) return { kind: "absent" };
  if (!isIndex(input.headHeight)) return { kind: "absent" };
  if (input.headHeight - block.height < FINALITY_DEPTH)
    return {
      kind: "immature",
      headHeight: input.headHeight,
      blockHeight: block.height,
    };
  if (input.lastStateHex === action.state) return { kind: "unchanged" };
  const decoded = input.decode(action.state);
  if (!isPhase(decoded.phase))
    throw new Error("decoded ledger phase is not a known order phase");
  if (!isIndex(decoded.revision))
    throw new Error("decoded ledger revision is not a safe integer");
  return {
    kind: "project",
    stateHex: action.state,
    phase: decoded.phase,
    revision: decoded.revision,
    deliveryManifest: decoded.deliveryManifest,
    blockHeight: block.height,
    blockHash: block.hash,
  };
}

export type AttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; retryable: boolean; reason: string };

export function isRetryableStatus(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 403) return THROTTLE_PATTERN.test(body);
  return false;
}

export function backoffMs(attempt: number, random: () => number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  return base + Math.floor(random() * base * BACKOFF_JITTER);
}

export async function withRetry<T>(
  attempt: () => Promise<AttemptResult<T>>,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Promise<T> {
  let last = "no attempt was made";
  for (let index = 0; index < MAX_ATTEMPTS; index++) {
    const result = await attempt();
    if (result.ok) return result.value;
    last = result.reason;
    if (!result.retryable)
      throw new Error(`chain observation failed: ${result.reason}`);
    if (index === MAX_ATTEMPTS - 1) break;
    await sleep(backoffMs(index, random));
  }
  throw new Error(
    `chain observation exhausted ${MAX_ATTEMPTS} attempts: ${last}`,
  );
}

export function redactIndexerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("project_id"))
      parsed.searchParams.set("project_id", "<redacted>");
    return parsed.href;
  } catch {
    return "<unparseable indexer url>";
  }
}

export function indexerEndpoint(url: string, token: string): string {
  const parsed = new URL(url);
  if (parsed.username || parsed.password)
    throw new Error("indexer URL must not carry credentials");
  if (parsed.hash) throw new Error("indexer URL must not carry a fragment");
  parsed.searchParams.set("project_id", token);
  return parsed.href;
}

export type IndexerTransport = {
  post: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<AttemptResult<unknown>>;
};

export function createIndexerTransport(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  log: (line: string) => void = () => {},
): IndexerTransport {
  const endpoint = indexerEndpoint(url, token);
  const redacted = redactIndexerUrl(endpoint);
  return {
    async post(query, variables) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) {
          log(`chain observer indexer HTTP ${response.status} at ${redacted}`);
          return {
            ok: false,
            retryable: isRetryableStatus(response.status, text),
            reason: `indexer HTTP ${response.status}`,
          };
        }
        const body = JSON.parse(text) as { data?: unknown; errors?: unknown[] };
        if (body.errors && body.errors.length > 0)
          return {
            ok: false,
            retryable: false,
            reason: "indexer GraphQL error",
          };
        return { ok: true, value: body.data };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          reason: error instanceof Error ? error.name : "indexer network error",
        };
      }
    },
  };
}

function parseHead(data: unknown): number {
  const height = (data as { block?: { height?: unknown } } | null)?.block
    ?.height;
  if (!isIndex(height)) throw new Error("indexer head block is missing");
  return height;
}

function parseAction(data: unknown): ContractAction | null {
  const action = (
    data as {
      contractAction?: {
        state?: unknown;
        transaction?: {
          hash?: unknown;
          block?: { height?: unknown; hash?: unknown };
        } | null;
      } | null;
    } | null
  )?.contractAction;
  if (!action || typeof action.state !== "string") return null;
  const transaction = action.transaction;
  const height = transaction?.block?.height;
  const hash = transaction?.block?.hash;
  if (
    !transaction ||
    typeof transaction.hash !== "string" ||
    !isIndex(height) ||
    typeof hash !== "string"
  )
    return null;
  return {
    state: action.state,
    transaction: { hash: transaction.hash, block: { height, hash } },
  };
}

export class ChainRuntimeUnavailableError extends Error {
  constructor(
    message = "chain state decoding requires the Compact runtime, which is unavailable in this runtime",
  ) {
    super(message);
    this.name = "ChainRuntimeUnavailableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function requireDecoder<T>(decode: T | null): T {
  if (!decode) throw new ChainRuntimeUnavailableError();
  return decode;
}

async function loadRuntimeDecoder(): Promise<
  ((stateHex: string) => DecodedState) | null
> {
  try {
    const [runtime, generated] = await Promise.all([
      import("@midnight-ntwrk/compact-runtime"),
      import("../packages/contract/generated/contract/index.js"),
    ]);
    return (stateHex) => {
      const state = runtime.ContractState.deserialize(hexToBytes(stateHex));
      const ledger = generated.ledger(state.data);
      const phase = generated.Phase[ledger.phase];
      const commitment = bytesToHex(ledger.deliveryCommitment);
      return {
        phase: phase as Phase,
        revision: Number(ledger.revision),
        deliveryManifest:
          phase === "SUBMITTED" && commitment !== ZERO_COMMITMENT
            ? commitment
            : null,
      };
    };
  } catch {
    return null;
  }
}

function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function indexerConfig(): { url: string; token: string } {
  const url =
    env("MIDNIGHT_PREPROD_INDEXER_HTTP") ?? env("MILO_PREPROD_INDEXER_HTTP");
  const token = env("MILO_PREPROD_BLOCKFROST_PROJECT_ID");
  if (!url)
    throw new Error(
      "MIDNIGHT_PREPROD_INDEXER_HTTP or MILO_PREPROD_INDEXER_HTTP is required",
    );
  if (!token) throw new Error("MILO_PREPROD_BLOCKFROST_PROJECT_ID is required");
  return { url, token };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type PendingOrder = {
  orderId: string;
  address: string;
  nonce: string;
  artifactFingerprint: string;
  lastStateHex: string | null;
};

const pendingOrderValidator = v.object({
  orderId: v.string(),
  address: v.string(),
  nonce: v.string(),
  artifactFingerprint: v.string(),
  lastStateHex: v.union(v.string(), v.null()),
});

const pendingOrdersRef = makeFunctionReference<
  "query",
  Record<string, never>,
  PendingOrder[]
>("chainObserver:pendingOrders");

const recordObservationRef = makeFunctionReference<"mutation">(
  "orders:recordObservation",
);

const markObservedRef = makeFunctionReference<"mutation">(
  "chainObserver:markObserved",
);

export const pendingOrders = internalQueryGeneric({
  args: {},
  returns: v.array(pendingOrderValidator),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("chainOrders")
      .withIndex("by_terminal", (q) => q.eq("terminal", false))
      .take(PENDING_LIMIT);
    return rows.map((row) => ({
      orderId: row.orderId,
      address: row.address,
      nonce: row.nonce,
      artifactFingerprint: row.artifactFingerprint,
      lastStateHex: row.lastStateHex ?? null,
    }));
  },
});

export const markObserved = internalMutationGeneric({
  args: {
    orderId: v.string(),
    lastStateHex: v.string(),
    blockHeight: v.number(),
    blockHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("chainOrders")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .unique();
    if (!row) return null;
    await ctx.db.patch(row._id, {
      lastStateHex: args.lastStateHex,
      blockHeight: args.blockHeight,
      blockHash: args.blockHash,
    });
    return null;
  },
});

export type PollSummary = {
  polled: number;
  projected: number;
  skipped: number;
  failed: number;
};

export type PollDeps = {
  runQuery: () => Promise<PendingOrder[]>;
  runMutation: (
    ref: unknown,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  loadDecoder: () => Promise<((stateHex: string) => DecodedState) | null>;
  config: () => { url: string; token: string };
  fetchImpl: typeof fetch;
};

const retryParse = <T>(
  transport: IndexerTransport,
  query: string,
  variables: Record<string, unknown> | undefined,
  parse: (data: unknown) => T,
  fallback: string,
): Promise<T> =>
  withRetry(
    async () => {
      const result = await transport.post(query, variables);
      if (!result.ok) return result;
      try {
        return { ok: true as const, value: parse(result.value) };
      } catch (error) {
        return {
          ok: false as const,
          retryable: false,
          reason: error instanceof Error ? error.message : fallback,
        };
      }
    },
    sleep,
    Math.random,
  );

export async function runPoll(deps: PollDeps): Promise<PollSummary> {
  const pending = await deps.runQuery();
  const summary: PollSummary = {
    polled: pending.length,
    projected: 0,
    skipped: 0,
    failed: 0,
  };
  if (pending.length === 0) return summary;
  const decode = requireDecoder(await deps.loadDecoder());
  const { url, token } = deps.config();
  const transport = createIndexerTransport(url, token, deps.fetchImpl);
  const headHeight = await retryParse(
    transport,
    HEAD_BLOCK,
    undefined,
    parseHead,
    "bad head block",
  );
  for (const order of pending) {
    try {
      const action = await retryParse(
        transport,
        LATEST_CONTRACT_STATE,
        { address: order.address },
        parseAction,
        "bad contract action",
      );
      const plan = planObservation({
        action,
        headHeight,
        lastStateHex: order.lastStateHex,
        decode,
      });
      if (plan.kind !== "project") {
        summary.skipped += 1;
        continue;
      }
      const verdict = (await deps.runMutation(recordObservationRef, {
        orderId: order.orderId,
        address: order.address,
        nonce: order.nonce,
        artifactFingerprint: order.artifactFingerprint,
        phase: plan.phase,
        revision: plan.revision,
        deliveryManifest: plan.deliveryManifest,
      })) as { kind: string } | null;
      if (verdict?.kind !== "bind") {
        summary.skipped += 1;
        continue;
      }
      await deps.runMutation(markObservedRef, {
        orderId: order.orderId,
        lastStateHex: plan.stateHex,
        blockHeight: plan.blockHeight,
        blockHash: plan.blockHash,
      });
      summary.projected += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export const poll = internalActionGeneric({
  args: {},
  returns: v.object({
    polled: v.number(),
    projected: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx) =>
    runPoll({
      runQuery: () => ctx.runQuery(pendingOrdersRef, {}),
      runMutation: (ref, args) =>
        ctx.runMutation(ref as never, args as never) as Promise<unknown>,
      loadDecoder: loadRuntimeDecoder,
      config: indexerConfig,
      fetchImpl: fetch,
    }),
});

export const chainObserver = { pendingOrders, markObserved, poll };
