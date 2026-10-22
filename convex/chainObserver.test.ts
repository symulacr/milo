/**
 * Chain observer tests. Pure: no network, no WASM. The recorded `contractAction`
 * fixture is a real serialized `ContractState` captured from the generated
 * contract at ACCEPTED/revision 2, decoded here through the same
 * hex -> ContractState -> .data -> ledger chain the action uses.
 */
import { describe, expect, test } from "bun:test";
import { ContractState } from "@midnight-ntwrk/compact-runtime";
import { hexToBytes } from "../packages/backend/src/encoding";
import {
  ledger,
  Phase,
} from "../packages/contract/generated/contract/index.js";
import {
  backoffMs,
  ChainRuntimeUnavailableError,
  type ContractAction,
  createIndexerTransport,
  type DecodedState,
  indexerEndpoint,
  isRetryableStatus,
  planObservation,
  redactIndexerUrl,
  requireDecoder,
  runPoll,
  withRetry,
} from "./chainObserver";

const ACCEPTED_STATE_HEX =
  "6d69646e696768743a636f6e74726163742d73746174655b76365d3a60000801020400040100a1038a60010101010101" +
  "010101010101010101010101010101010101010101010101010101600102020202020202020202020202020202020202" +
  "0202020202020202020202020260017c68af34735b1d625d04b25c2d3cbab71ef846d9d1a3bf3e7d27ffae0fd95d0360" +
  "0181586615c936a2037460d22d94d53f57f77d2e505c668a22e5a46a90ea36c65560019e73fbd5b0cd5c8009d7fc848e" +
  "ad5052e3dff117e8a1d2a8ded7fa5e5898e5ce6001be5ec6902796ad9a7f0f3d0dfc21318a3c165885707c9a1a999d3c" +
  "1ef0bd5315416441c8422c01429001ca2001200120012001200120010808080804080401040c08010400080201041404" +
  "01041808010400080208042004010424080104000c402001042c040104300801040004004038101c2834343838383838" +
  "383838383808021408043c080418044004030444000448080104044ce1010304e6cd0120012001200120012001200108" +
  "0808080001080104040104010401080201000108010404010401040108020800010801040401040104010c4020010001" +
  "0801040401040104010c4020010001040000010400000104000001040000010400000104000001040000010400000104" +
  "000001040000045015020304ff0102846d9d1a3bf3e7d27ffae0fd95d03600181586615c936a2037460d22d94d53f57f" +
  "77d2e505c668a22e5a46a90ea36c65560019e73fbd5b0cd5c8009d7fc848ead5052e3dff117e8a1d2a8ded7fa5e5898e" +
  "5ce6001be5ec6902796ad9a7f0f3d0dfc21318a3c165885707c9a1a999d3c1ef0bd5315416441c8422c01429001ca004" +
  "5415020304ff010201040304010804180801040104010801020001080214400104000001080104040104010401a1038a" +
  "600101010101010101010101010101010101010101010101010101010101010101016001020202020202020202020202" +
  "020202020202020202020202020202020202020260017c68af34735b1d625d04b25c2d3cbab71ef01440385838381003" +
  "000400";

const HEAD_HEIGHT = 2_769_087;
const BLOCK_HEIGHT = 2_639_638;
const BLOCK_HASH =
  "5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58";
const TOKEN = "nightpreprod1deadbeefdeadbeefdeadbeef";
const INDEXER = "https://midnight-preprod.blockfrost.io/api/v0";

function decodeFixture(stateHex: string): DecodedState {
  const state = ContractState.deserialize(hexToBytes(stateHex));
  const view = ledger(state.data);
  const phase = Phase[view.phase] as DecodedState["phase"];
  const commitment = Buffer.from(view.deliveryCommitment).toString("hex");
  return {
    phase,
    revision: Number(view.revision),
    deliveryManifest:
      phase === "SUBMITTED" && commitment !== "0".repeat(64)
        ? commitment
        : null,
  };
}

function actionFixture(
  overrides: { state?: string; height?: number } = {},
): ContractAction {
  return {
    state: overrides.state ?? ACCEPTED_STATE_HEX,
    transaction: {
      hash: BLOCK_HASH,
      block: { height: overrides.height ?? BLOCK_HEIGHT, hash: BLOCK_HASH },
    },
  };
}

describe("planObservation: recorded contractAction decodes", () => {
  test("the recorded ACCEPTED/revision-2 state decodes to phase and revision", () => {
    const plan = planObservation({
      action: actionFixture(),
      headHeight: HEAD_HEIGHT,
      decode: decodeFixture,
    });
    expect(plan.kind).toBe("project");
    if (plan.kind !== "project") throw new Error("expected a projection");
    expect(plan.phase).toBe("ACCEPTED");
    expect(plan.revision).toBe(2);
    expect(plan.deliveryManifest).toBeNull();
    expect(plan.blockHeight).toBe(BLOCK_HEIGHT);
    expect(plan.blockHash).toBe(BLOCK_HASH);
    expect(plan.stateHex).toBe(ACCEPTED_STATE_HEX);
  });

  test("the fixture is the raw serialized state, not a re-encoding", () => {
    const decoded = decodeFixture(ACCEPTED_STATE_HEX);
    expect(decoded.phase).toBe("ACCEPTED");
    expect(decoded.revision).toBe(2);
    expect(
      ACCEPTED_STATE_HEX.startsWith(
        "6d69646e696768743a636f6e74726163742d7374617465",
      ),
    ).toBe(true);
  });
});

describe("planObservation: change detection", () => {
  test("an unchanged state hex produces no write and no decode", () => {
    let decodes = 0;
    const plan = planObservation({
      action: actionFixture(),
      headHeight: HEAD_HEIGHT,
      lastStateHex: ACCEPTED_STATE_HEX,
      decode: (hex) => {
        decodes += 1;
        return decodeFixture(hex);
      },
    });
    expect(plan).toEqual({ kind: "unchanged" });
    expect(decodes).toBe(0);
  });

  test("a different state hex is decoded and projected", () => {
    const plan = planObservation({
      action: actionFixture(),
      headHeight: HEAD_HEIGHT,
      lastStateHex: "00".repeat(8),
      decode: decodeFixture,
    });
    expect(plan.kind).toBe("project");
  });

  test("an absent action is skipped without decoding", () => {
    let decodes = 0;
    const plan = planObservation({
      action: null,
      headHeight: HEAD_HEIGHT,
      decode: (hex) => {
        decodes += 1;
        return decodeFixture(hex);
      },
    });
    expect(plan).toEqual({ kind: "absent" });
    expect(decodes).toBe(0);
  });
});

describe("planObservation: finality gate", () => {
  test("a state at headHeight - 2 is skipped as immature", () => {
    const plan = planObservation({
      action: actionFixture({ height: HEAD_HEIGHT - 2 }),
      headHeight: HEAD_HEIGHT,
      decode: decodeFixture,
    });
    expect(plan.kind).toBe("immature");
    if (plan.kind !== "immature") throw new Error("expected immature");
    expect(plan.headHeight - plan.blockHeight).toBe(2);
  });

  test("a state at exactly headHeight - 3 is projected", () => {
    const plan = planObservation({
      action: actionFixture({ height: HEAD_HEIGHT - 3 }),
      headHeight: HEAD_HEIGHT,
      decode: decodeFixture,
    });
    expect(plan.kind).toBe("project");
  });

  test("an immature action never reaches the decoder", () => {
    let decodes = 0;
    planObservation({
      action: actionFixture({ height: HEAD_HEIGHT - 1 }),
      headHeight: HEAD_HEIGHT,
      decode: (hex) => {
        decodes += 1;
        return decodeFixture(hex);
      },
    });
    expect(decodes).toBe(0);
  });
});

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("retry policy", () => {
  test("a 429 then 200 retries and succeeds", async () => {
    const statuses = [429, 200];
    let calls = 0;
    const fetchImpl = (async () => {
      const status = statuses[calls++];
      return status === 200
        ? response(200, { data: { block: { height: 10 } } })
        : response(429, { status_code: 429 });
    }) as unknown as typeof fetch;
    const transport = createIndexerTransport(INDEXER, TOKEN, fetchImpl);
    const sleeps: number[] = [];
    const value = await withRetry(
      () => transport.post("query { block { height } }"),
      async (ms) => {
        sleeps.push(ms);
      },
      () => 0,
    );
    expect(value).toEqual({ block: { height: 10 } });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1_000]);
  });

  test("a 400 does not retry", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return response(400, { error: "bad request" });
    }) as unknown as typeof fetch;
    const transport = createIndexerTransport(INDEXER, TOKEN, fetchImpl);
    const sleeps: number[] = [];
    await expect(
      withRetry(
        () => transport.post("query { block { height } }"),
        async (ms) => {
          sleeps.push(ms);
        },
        () => 0,
      ),
    ).rejects.toThrow("indexer HTTP 400");
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("a GraphQL error does not retry", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return response(200, { errors: [{ message: "unknown field" }] });
    }) as unknown as typeof fetch;
    const transport = createIndexerTransport(INDEXER, TOKEN, fetchImpl);
    await expect(
      withRetry(
        () => transport.post("query { nope }"),
        async () => {},
        () => 0,
      ),
    ).rejects.toThrow("indexer GraphQL error");
    expect(calls).toBe(1);
  });

  test("three retryable failures exhaust the attempts", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return response(503, {});
    }) as unknown as typeof fetch;
    const transport = createIndexerTransport(INDEXER, TOKEN, fetchImpl);
    await expect(
      withRetry(
        () => transport.post("query { block { height } }"),
        async () => {},
        () => 0,
      ),
    ).rejects.toThrow("exhausted 3 attempts");
    expect(calls).toBe(3);
  });

  test("403 retries only when the body reports throttling", () => {
    expect(isRetryableStatus(403, "Slow down: throttled")).toBe(true);
    expect(isRetryableStatus(403, "rate limit exceeded")).toBe(true);
    expect(isRetryableStatus(403, "invalid project token")).toBe(false);
    expect(isRetryableStatus(402, "")).toBe(false);
    expect(isRetryableStatus(418, "")).toBe(false);
    expect(isRetryableStatus(500, "")).toBe(true);
    expect(isRetryableStatus(429, "")).toBe(true);
  });

  test("backoff grows 1s/4s/16s with bounded jitter", () => {
    expect(backoffMs(0, () => 0)).toBe(1_000);
    expect(backoffMs(1, () => 0)).toBe(4_000);
    expect(backoffMs(2, () => 0)).toBe(16_000);
    expect(backoffMs(2, () => 0.999)).toBeLessThan(16_000 * 1.25);
    expect(backoffMs(9, () => 0)).toBe(16_000);
  });
});

describe("the Blockfrost token never reaches a log line", () => {
  test("a failing request logs a redacted endpoint", async () => {
    const lines: string[] = [];
    const fetchImpl = (async () =>
      response(500, "upstream failure")) as unknown as typeof fetch;
    const transport = createIndexerTransport(
      INDEXER,
      TOKEN,
      fetchImpl,
      (line) => lines.push(line),
    );
    await expect(
      withRetry(
        () => transport.post("query { block { height } }"),
        async () => {},
        () => 0,
      ),
    ).rejects.toThrow();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(TOKEN);
      const logged = new URL(line.slice(line.indexOf("https://")));
      expect(logged.searchParams.get("project_id")).toBe("<redacted>");
    }
  });

  test("a thrown error message carries no token", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const transport = createIndexerTransport(INDEXER, TOKEN, fetchImpl);
    let message = "";
    try {
      await withRetry(
        () => transport.post("query { block { height } }"),
        async () => {},
        () => 0,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("exhausted 3 attempts");
    expect(message).not.toContain(TOKEN);
  });

  test("redactIndexerUrl replaces the token and keeps other parameters", () => {
    const redacted = redactIndexerUrl(
      `${indexerEndpoint(INDEXER, TOKEN)}&network=preprod`,
    );
    expect(redacted).not.toContain(TOKEN);
    expect(redacted).toContain("project_id=%3Credacted%3E");
    expect(redacted).toContain("network=preprod");
  });

  test("indexerEndpoint refuses a URL carrying credentials", () => {
    expect(() => indexerEndpoint("https://user:pass@host/api", TOKEN)).toThrow(
      "credentials",
    );
  });
});

describe("the decoder guard fails closed with a named error", () => {
  test("a missing decoder raises ChainRuntimeUnavailableError", () => {
    expect(() => requireDecoder(null)).toThrow(ChainRuntimeUnavailableError);
  });

  test("the error names itself rather than reading as a generic failure", () => {
    try {
      requireDecoder(null);
      throw new Error("expected requireDecoder to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ChainRuntimeUnavailableError);
      expect((error as Error).name).toBe("ChainRuntimeUnavailableError");
      expect((error as Error).message).toContain("Compact runtime");
    }
  });

  test("a present decoder is returned unchanged", () => {
    const decode = decodeFixture;
    expect(requireDecoder(decode)).toBe(decode);
  });
});

type PollOrder = {
  orderId: string;
  address: string;
  nonce: string;
  artifactFingerprint: string;
  lastStateHex: string | null;
};

const HEAD_HEIGHT_RESPONSE = { data: { block: { height: HEAD_HEIGHT } } };
const ACTION_RESPONSE = {
  data: {
    contractAction: {
      __typename: "ContractAction",
      address: "1".repeat(64),
      state: ACCEPTED_STATE_HEX,
      transaction: {
        id: "tx",
        hash: BLOCK_HASH,
        block: {
          height: BLOCK_HEIGHT,
          hash: BLOCK_HASH,
          protocolVersion: 1,
        },
      },
    },
  },
};

function pendingFixture(overrides: Partial<PollOrder> = {}): PollOrder {
  return {
    orderId: "order_1",
    address: "1".repeat(64),
    nonce: "4".repeat(64),
    artifactFingerprint: "a".repeat(64),
    lastStateHex: null,
    ...overrides,
  };
}

/**
 * Poll deps double. The function references are opaque, so `runMutation` records
 * call order and the assertions read that order rather than identifying a ref.
 * The fetch stub answers the head query and the action query, so nothing here
 * reaches the Preprod indexer or spends the retry backoff.
 */
function pollDeps(options: {
  pending: PollOrder[];
  verdict?: { kind: string } | null;
  decoder?: ((stateHex: string) => DecodedState) | null;
}) {
  const mutations: { args: Record<string, unknown> }[] = [];
  const requests: string[] = [];
  const deps = {
    runQuery: async () => options.pending,
    runMutation: async (
      _ref: unknown,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      mutations.push({ args });
      if ("phase" in args) return options.verdict ?? null;
      return null;
    },
    loadDecoder: async () =>
      options.decoder === undefined ? decodeFixture : options.decoder,
    config: () => ({ url: INDEXER, token: TOKEN }),
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      requests.push(body);
      return response(
        200,
        body.includes("contractAction")
          ? ACTION_RESPONSE
          : HEAD_HEIGHT_RESPONSE,
      );
    }) as unknown as typeof fetch,
  };
  return { deps, mutations, requests };
}

describe("runPoll: markObserved is gated on a bind verdict", () => {
  test("a bind verdict writes the observation and then the hex", async () => {
    const { deps, mutations } = pollDeps({
      pending: [pendingFixture()],
      verdict: { kind: "bind" },
    });
    const summary = await runPoll(deps);
    expect(mutations).toHaveLength(2);
    expect(mutations[0].args).toMatchObject({ orderId: "order_1" });
    expect(mutations[1].args).toMatchObject({
      orderId: "order_1",
      lastStateHex: ACCEPTED_STATE_HEX,
    });
    expect(summary.projected).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  test("a non-bind verdict never stamps the hex", async () => {
    for (const kind of ["stale", "contradictory", "address-claimed"]) {
      const { deps, mutations } = pollDeps({
        pending: [pendingFixture()],
        verdict: { kind },
      });
      const summary = await runPoll(deps);
      expect(mutations).toHaveLength(1);
      expect(mutations[0].args).not.toHaveProperty("lastStateHex");
      expect(summary.projected).toBe(0);
      expect(summary.skipped).toBe(1);
    }
  });

  test("a null verdict never stamps the hex", async () => {
    const { deps, mutations } = pollDeps({
      pending: [pendingFixture()],
      verdict: null,
    });
    const summary = await runPoll(deps);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].args).not.toHaveProperty("lastStateHex");
    expect(summary.skipped).toBe(1);
  });

  test("an empty pending set does no work and needs no decoder", async () => {
    const { deps, mutations, requests } = pollDeps({
      pending: [],
      decoder: null,
    });
    const summary = await runPoll(deps);
    expect(mutations).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(summary).toEqual({
      polled: 0,
      projected: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe("runPoll: a missing decoder fails closed and spends nothing", () => {
  test("it raises the named error rather than skipping the order", async () => {
    const { deps } = pollDeps({
      pending: [pendingFixture()],
      decoder: null,
    });
    await expect(runPoll(deps)).rejects.toBeInstanceOf(
      ChainRuntimeUnavailableError,
    );
  });

  test("it raises before any indexer request is made", async () => {
    const { deps, requests, mutations } = pollDeps({
      pending: [pendingFixture()],
      decoder: null,
    });
    await expect(runPoll(deps)).rejects.toThrow("Compact runtime");
    expect(requests).toHaveLength(0);
    expect(mutations).toHaveLength(0);
  });
});
