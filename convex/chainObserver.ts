import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { bytesToHex, env, hexToBytes } from "../packages/backend/src/encoding";
import { REFRESH_COOLDOWN_MS } from "../packages/backend/src/order-windows";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import { fail, type ReadContext, unavailable } from "./admissionContext";
import { CHAIN_PHASES } from "./admissionValidators";
import { isOperator } from "./auth";

const PENDING_LIMIT = 25;
// R35 (a): the per-order work is independent, so it runs in bounded waves.
// Blockfrost allows 10 req/s per IP with a 500 burst and auto-bans (418) for
// flooding (docs.blockfrost.io, accessed 2026-10-28), so the pool is small on
// purpose; `POLL_DEADLINE_MS` keeps one slow tick from outlasting its interval.
const POLL_CONCURRENCY = 6;
const POLL_DEADLINE_MS = 40_000;
const FINALITY_DEPTH = 3;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000] as const;
const BACKOFF_JITTER = 0.25;
const REQUEST_TIMEOUT_MS = 15_000;

/** R38: declared once in `admissionValidators.ts`, beside the validator and
 * schema that use it. Re-exported because `Phase`/`PHASE_SET` derive from it. */
export const PHASES = CHAIN_PHASES;

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
  /**
   * R25 O-01: the dispute evidence the ledger commits, or the zero digest.
   * Optional because a decoder built before this field existed (and every test
   * double) legitimately has nothing to report, and "not decoded" must not be
   * confused with "no evidence" — the record simply omits the key.
   */
  evidenceCommitment?: string;
};

export type ObservationPlan =
  | {
      kind: "project";
      stateHex: string;
      phase: Phase;
      revision: number;
      deliveryManifest: string | null;
      evidenceCommitment?: string;
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
    unavailable("decoded ledger phase is not a known order phase");
  if (!isIndex(decoded.revision))
    unavailable("decoded ledger revision is not a safe integer");
  return {
    kind: "project",
    stateHex: action.state,
    phase: decoded.phase,
    revision: decoded.revision,
    deliveryManifest: decoded.deliveryManifest,
    evidenceCommitment: decoded.evidenceCommitment,
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
      unavailable(`chain observation failed: ${result.reason}`);
    if (index === MAX_ATTEMPTS - 1) break;
    await sleep(backoffMs(index, random));
  }
  unavailable(`chain observation exhausted ${MAX_ATTEMPTS} attempts: ${last}`);
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
    fail("INVALID_INPUT", "indexer URL must not carry credentials");
  if (parsed.hash)
    fail("INVALID_INPUT", "indexer URL must not carry a fragment");
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
  if (!isIndex(height)) unavailable("indexer head block is missing");
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
        // R25 O-01: the dispute evidence the contract already commits
        // (`order.compact:40`, `evidenceCommitment`). Reading it costs one
        // `bytesToHex` and makes a resolved dispute auditable: without it the
        // record said "resolved" and nothing about what was resolved on.
        evidenceCommitment: bytesToHex(ledger.evidenceCommitment),
      };
    };
  } catch {
    return null;
  }
}

function indexerConfig(): { url: string; token: string } {
  const url =
    env("MIDNIGHT_PREPROD_INDEXER_HTTP") ?? env("MILO_PREPROD_INDEXER_HTTP");
  const token = env("MILO_PREPROD_BLOCKFROST_PROJECT_ID");
  if (!url)
    unavailable(
      "MIDNIGHT_PREPROD_INDEXER_HTTP or MILO_PREPROD_INDEXER_HTTP is required",
    );
  if (!token) unavailable("MILO_PREPROD_BLOCKFROST_PROJECT_ID is required");
  return { url, token };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const pendingOrderValidator = v.object({
  orderId: v.string(),
  address: v.string(),
  nonce: v.string(),
  artifactFingerprint: v.string(),
  lastStateHex: v.union(v.string(), v.null()),
});

export type PendingOrder = Infer<typeof pendingOrderValidator>;

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
  deferred: number;
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
  now: () => number;
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

type ProjectedPlan = Extract<ObservationPlan, { kind: "project" }>;

type RunMutation = (ref: unknown, args: unknown) => Promise<unknown>;

/**
 * Record one observed state, then stamp it. Both callers (the cron poll and the
 * on-demand refresh) must do exactly this, in this order: the stamp is only
 * written once the observation writer has bound the state.
 */
async function commitObservation(
  runMutation: RunMutation,
  order: PendingOrder,
  plan: ProjectedPlan,
): Promise<boolean> {
  const verdict = (await runMutation(recordObservationRef, {
    orderId: order.orderId,
    address: order.address,
    nonce: order.nonce,
    artifactFingerprint: order.artifactFingerprint,
    phase: plan.phase,
    revision: plan.revision,
    deliveryManifest: plan.deliveryManifest,
    evidenceCommitment: plan.evidenceCommitment,
  })) as { kind: string } | null;
  if (verdict?.kind !== "bind") return false;
  await runMutation(markObservedRef, {
    orderId: order.orderId,
    lastStateHex: plan.stateHex,
    blockHeight: plan.blockHeight,
    blockHash: plan.blockHash,
  });
  return true;
}

export async function runPoll(deps: PollDeps): Promise<PollSummary> {
  const pending = await deps.runQuery();
  const summary: PollSummary = {
    polled: pending.length,
    projected: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
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

  const startedAt = deps.now();
  const queue = [...pending];
  const worker = async (): Promise<void> => {
    for (;;) {
      // Deadline first: a tick that has run out of time must not start new
      // work, or the whole run is killed and the next one is skipped.
      if (deps.now() - startedAt >= POLL_DEADLINE_MS) return;
      const order = queue.shift();
      if (!order) return;
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
        const committed = await commitObservation(
          (ref, args) => deps.runMutation(ref, args as Record<string, unknown>),
          order,
          plan,
        );
        if (!committed) {
          summary.skipped += 1;
          continue;
        }
        summary.projected += 1;
      } catch {
        summary.failed += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(POLL_CONCURRENCY, pending.length) }, worker),
  );
  // Whatever the pool never reached is deferred, not lost: the next tick
  // re-reads it from `pendingOrders`.
  summary.deferred = queue.length;
  return summary;
}

/**
 * R37: one line, only when the tick did something or went wrong.
 *
 * The cron was invisible: `runPoll` logs nothing on success, so "running with an
 * empty queue" and "broken" looked identical in `convex logs`. Logging every
 * tick would be 1,440 lines/day of "nothing happened", which is how a real
 * failure gets scrolled past — so this fires only when `projected` or `failed`
 * is non-zero. Silence then means "empty or unchanged", which is honest.
 */
export function pollLogLine(summary: PollSummary): string | null {
  if (summary.projected === 0 && summary.failed === 0) return null;
  return JSON.stringify({
    polled: summary.polled,
    projected: summary.projected,
    skipped: summary.skipped,
    failed: summary.failed,
    deferred: summary.deferred,
  });
}

export const poll = internalActionGeneric({
  args: {},
  returns: v.object({
    polled: v.number(),
    projected: v.number(),
    skipped: v.number(),
    failed: v.number(),
    deferred: v.number(),
  }),
  handler: async (ctx) => {
    const summary = await runPoll({
      runQuery: () => ctx.runQuery(pendingOrdersRef, {}),
      runMutation: (ref, args) =>
        ctx.runMutation(ref as never, args as never) as Promise<unknown>,
      loadDecoder: loadRuntimeDecoder,
      config: indexerConfig,
      fetchImpl: fetch,
      now: Date.now,
    });
    const line = pollLogLine(summary);
    if (line) console.log("chain-poll", line);
    return summary;
  },
});

export const chainObserver = { pendingOrders, markObserved, poll };

const orderForQuoteRef = makeFunctionReference<
  "query",
  { quoteId: string },
  {
    orderId: string;
    address: string;
    nonce: string;
    artifactFingerprint: string;
    lastStateHex: string | null;
    observedAt: number | null;
  } | null
>("chainObserver:orderForQuote");

export const orderForQuote = internalQueryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(
    v.object({
      orderId: v.string(),
      address: v.string(),
      nonce: v.string(),
      artifactFingerprint: v.string(),
      lastStateHex: v.union(v.string(), v.null()),
      /** R29 AC-03: when this order was last observed, for the refresh cap. */
      observedAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("chainOrders")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    return row
      ? {
          orderId: row.orderId,
          address: row.address,
          nonce: row.nonce,
          artifactFingerprint: row.artifactFingerprint,
          lastStateHex: row.lastStateHex ?? null,
          observedAt: row.observedAt ?? null,
        }
      : null;
  },
});

const orderScopeMemberRef = makeFunctionReference<
  "query",
  { quoteId: string; subject: string },
  boolean
>("chainObserver:orderScopeMember");

/**
 * True when the subject may read the quote's order: an active member of its
 * scope, or an operator allowed to see a DISPUTED order they are not a member
 * of. The second branch mirrors `orders:order`; without it an operator could
 * read a dispute but never refresh the chain state behind it.
 */
export const orderScopeMember = internalQueryGeneric({
  args: { quoteId: v.string(), subject: v.string() },
  returns: v.boolean(),
  handler: async (ctx: ReadContext, args) => {
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    if (!draft) return false;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_subject_scope", (q) =>
        q.eq("privySubject", args.subject).eq("scopeId", draft.scopeId),
      )
      .unique();
    if (membership?.status === "active") return true;
    const chain = await ctx.db
      .query("chainOrders")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    return chain?.phase === "DISPUTED" && (await isOperator(ctx));
  },
});

/**
 * R36 R-14: the shape of every "did not read the indexer" return from
 * `refreshOrder`, declared once so the four early exits cannot disagree.
 */
const NOT_REFRESHED = {
  phase: null,
  revision: null,
  refreshed: false,
  since: null,
} as const;

export const refreshOrder = actionGeneric({
  args: { quoteId: v.string() },
  returns: v.object({
    phase: v.union(v.string(), v.null()),
    revision: v.union(v.number(), v.null()),
    /**
     * R36 R-14: whether this call actually spent an indexer read. `false` on
     * every early return, so the client can tell "read it, nothing changed"
     * from "did not read it" — both used to look identical (`phase: null`).
     */
    refreshed: v.boolean(),
    /**
     * When the network was last read for this order (epoch ms), or null if it
     * never has been. On a cooldown return this is the timestamp the client
     * needs to say "already checked N seconds ago". Reuses the `observedAt` the
     * observer already writes — no new field, index or read.
     */
    since: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    // Only a participant in the order's scope may spend an indexer read.
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const allowed = await ctx.runQuery(orderScopeMemberRef, {
      quoteId: args.quoteId,
      subject,
    });
    if (!allowed) return NOT_REFRESHED;
    const order = await ctx.runQuery(orderForQuoteRef, {
      quoteId: args.quoteId,
    });
    if (!order) return NOT_REFRESHED;
    // R29 AC-03: each refresh spends two Blockfrost reads against the SAME
    // project id that `poll` uses, so a member looping this action can exhaust
    // the daily allowance and stop chain observation for every order. The cap
    // is per order and reuses `observedAt`, which the observer already writes —
    // no new table, no new index. A refresh inside the window is not an error:
    // it answers from the recorded state, so the caller still sees the order.
    //
    // R36 R-14: it now also says WHEN, so the caller can report it instead of
    // silently doing nothing.
    if (
      order.observedAt !== null &&
      Date.now() - order.observedAt < REFRESH_COOLDOWN_MS
    )
      return { ...NOT_REFRESHED, since: order.observedAt };
    const decode = requireDecoder(await loadRuntimeDecoder());
    const { url, token } = indexerConfig();
    const transport = createIndexerTransport(url, token, fetch);
    const headHeight = await retryParse(
      transport,
      HEAD_BLOCK,
      undefined,
      parseHead,
      "bad head block",
    );
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
    if (plan.kind !== "project")
      return { ...NOT_REFRESHED, since: order.observedAt };
    const committed = await commitObservation(
      (ref, args) => ctx.runMutation(ref as never, args as never),
      order,
      plan,
    );
    if (!committed) return { ...NOT_REFRESHED, since: order.observedAt };
    return {
      phase: plan.phase,
      revision: plan.revision,
      refreshed: true,
      since: Date.now(),
    };
  },
});
