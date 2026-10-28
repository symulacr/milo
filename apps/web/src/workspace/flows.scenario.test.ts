import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type FunctionReference, getFunctionName } from "convex/server";
import * as chainObserver from "../../../../convex/chainObserver";
import * as files from "../../../../convex/files";
import {
  type Row,
  readSurface,
  writeSurface,
} from "../../../../convex/orderProjection.double";
import * as orders from "../../../../convex/orders";
import * as stripeProvisioning from "../../../../convex/stripeProvisioning";
import * as trustedProvisioning from "../../../../convex/trustedProvisioning";
import {
  checkArgs,
  checkReturns,
  handlerOf,
} from "../../../../packages/backend/test/fixtures";
import { api } from "../api";
import { installMemoryStorage } from "./test-storage";

// The deployment settings the real handlers read. A real deployment sets these
// with `convex env set`; the harness stands in for that, so the handlers run
// their real configuration checks instead of being bypassed.
process.env.CONVEX_SITE_URL ??= "https://test.convex.site";
process.env.SITE_URL ??= "https://test.example";
process.env.MILO_OPERATOR_SECRET ??= "a".repeat(64);
process.env.STRIPE_SECRET_KEY ??= "sk_test_harness";
process.env.STRIPE_ACCOUNT_ID ??= "acct_harness";
process.env.MAIL_FROM ??= "milo@test.example";
process.env.RESEND_API_KEY ??= "re_harness";
process.env.RESEND_BASE_URL ??= "https://mail.test";

// The Better Auth component is an external service. Its own function references
// (`_reference/childComponent/betterAuth/...`) are not ours to run, and its
// `getAuth` needs a real auth deployment. Stubbing this one module is the same
// boundary `convex/orders.test.ts` draws; every other handler stays real.
const AUTH_USER = { value: null as { email: string } | null };
mock.module("../../../../convex/auth", () => ({
  authComponent: {
    safeGetAuthUser: async () => AUTH_USER.value,
    getAuth: async () => {
      throw new Error("The auth component is stubbed in this harness.");
    },
  },
  operatorAllowed: () => false,
  OPERATOR_SCOPE: "milo-operators",
}));

/**
 * The React bindings, pointed at realBackend. `useConvex` hands the route the
 * same router the flow tests use, `useQuery` runs the real query, and `useMe`
 * sees an account, so a real route can be mounted and driven. The active
 * backend is set per test.
 */
const ACTIVE = { backend: null as ReturnType<typeof realBackend> | null };
/** The object form, which returns a status instead of throwing (G-12). */
const asState = (value: unknown) =>
  value instanceof Error
    ? { status: "error" as const, error: value }
    : value === undefined
      ? { status: "pending" as const }
      : { status: "success" as const, data: value };
mock.module("convex/react", () => ({
  ConvexReactClient: class {},
  useConvex: () => ACTIVE.backend?.client,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
  useQuery: (ref: unknown, args: unknown) =>
    ACTIVE.backend
      ? ACTIVE.backend.client.query(ref as FunctionReference<"query">, args)
      : undefined,
  useQuery_experimental: (options: { query: unknown; args: unknown }) =>
    asState(
      ACTIVE.backend
        ? ACTIVE.backend.client.query(
            options.query as FunctionReference<"query">,
            options.args,
          )
        : undefined,
    ),
}));

// Scenario suite: each test walks one named user path through the real
// flows.ts. The chain is a fake that records what was signed, and the Convex
// client is the real handler router, so nothing touches a network or a ledger.

type Call = { circuit: string; expectedRevision: bigint; extra: unknown };
type Report = { id: string; state: string };

const calls: Call[] = [];
const reports: Report[] = [];
let chainFailure: Error | null = null;
let holdState = "held";
let attachOk = true;
let acceptOk = true;

const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);
const hex32 = (fill: number) => bytes32(fill).toHex();

// startOrder recomputes both of these and compares them with the order, so the
// fixture has to agree or every start path fails its integrity check.
const SCOPE_DIGEST = new Bun.CryptoHasher("sha256")
  .update("Product stills\nThree images.")
  .digest("hex");
const TERMS_COMMITMENT = hex32(0x22);

/** Set by a test that needs to observe WHEN the chain leg was entered. */
let onChainStart: (() => void) | undefined;

mock.module("../chain", () => ({
  orderCommitments: async () => ({
    terms: () => bytes32(0x22),
    capability: () => bytes32(0x33),
  }),
  deployOrder: async () => ({ contractAddress: "0xcontract" }),
  readDeployStatus: () => ({ state: "none" }),
  callOrder: async (
    input: Call & { circuit: string; expectedRevision: bigint },
  ) => {
    if (chainFailure) throw chainFailure;
    calls.push({
      circuit: input.circuit,
      expectedRevision: input.expectedRevision,
      extra: input,
    });
    return { revision: Number(input.expectedRevision) + 1 };
  },
  // A route warms the chain on mount; the real module needs wasm, so the fake
  // answers it. Without this, mounting any order route throws.
  warmOrderChain: async () => {},
  // The real provider calls back with on-chain state; deliver it next tick so
  // the promise in flows.ts resolves instead of waiting for its timeout.
  watchOrderContract: (input: {
    onState: (state: { evidenceCommitment: string | null }) => void;
  }) => {
    onChainStart?.();
    const timer = setTimeout(
      () => input.onState({ evidenceCommitment: "cd".repeat(32) }),
      0,
    );
    return () => clearTimeout(timer);
  },
}));

installMemoryStorage();

/**
 * The real backend, behind the fake client.
 *
 * Every `api.*` reference the web code hands to `convex.action/mutation/query`
 * is resolved to the **real exported Convex function** by its registered name,
 * its arguments are checked against that function's own `args` validator, the
 * real `_handler` runs against an in-memory db, and the result is checked
 * against its own `returns` validator. A form that sends a field the server
 * never reads, omits one it requires, or reads a result field the server does
 * not return fails here instead of in production.
 *
 * `ctx.runQuery/runMutation/runAction` route the same way, so a handler that
 * calls another handler (createStudioAndQuote -> writeQuoteDraft) stays real.
 * Only two things are not: the chain module (W4's boundary, no wasm in a unit
 * test) and the Better Auth component, which is an external service.
 */
const TABLES = [
  "trustedProvisioning",
  "trustedProvisioningAudit",
  "approvedQuotes",
  "stripeCustomers",
  "paymentJobs",
  "frozenQuotes",
  "paymentMonitors",
  "deploymentObservations",
  "paymentObservations",
  "admissionTimingPolicies",
  "canonicalBindings",
  "chainOrders",
  "chainObservations",
  "memberships",
  "quoteDrafts",
  "orders",
  "fileGrants",
  "deliveries",
  "paymentIntents",
  "paymentInbox",
  "settlementOps",
  "studios",
] as const;

const MODULES: Record<string, Record<string, unknown>> = {
  stripeProvisioning: stripeProvisioning as unknown as Record<string, unknown>,
  trustedProvisioning: trustedProvisioning as unknown as Record<
    string,
    unknown
  >,
  orders: orders as unknown as Record<string, unknown>,
  files: files as unknown as Record<string, unknown>,
  chainObserver: chainObserver as unknown as Record<string, unknown>,
};

/** `module:export` -> the registered function, which carries both descriptors. */
const REGISTERED = new Map<string, unknown>();
for (const [module, exports] of Object.entries(MODULES))
  for (const [name, value] of Object.entries(exports))
    if (
      typeof value === "function" &&
      typeof (value as { _handler?: unknown })._handler === "function"
    )
      REGISTERED.set(`${module}:${name}`, value);

export const realBackend = (
  subject = "did:privy:buyer",
  existing?: Record<string, Row[]>,
) => {
  const tables: Record<string, Row[]> =
    existing ?? Object.fromEntries(TABLES.map((name) => [name, []]));
  const calls: string[] = [];
  const call = async (name: string, args: unknown) => {
    // `auth:me` belongs to the Better Auth component, which this harness
    // stubs. Answer it from the stub identity so a real route can read `useMe`.
    if (name === "auth:me")
      return {
        subject,
        email: AUTH_USER.value?.email ?? null,
        studio: null,
        operator: false,
        walletAddress: null,
      };
    const fn = REGISTERED.get(name);
    if (!fn) throw new Error(`no registered function for ${name}`);
    checkArgs(fn, args);
    calls.push(name);
    const out = await handlerOf(fn)(ctx as never, args as never);
    checkReturns(fn, out);
    return out;
  };
  /** The one surface: a Convex reference becomes a real call. */
  const invoke = (ref: unknown, args: unknown) =>
    call(getFunctionName(ref as FunctionReference<"query">), args);
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        issuer: process.env.CONVEX_SITE_URL,
        subject,
      }),
    },
    storage: {
      getMetadata: async () => null,
      generateUploadUrl: async () => "https://upload.invalid",
      get: async () => null,
    },
    scheduler: { runAfter: async () => null },
    db: {
      ...readSurface(tables),
      ...writeSurface(tables),
      normalizeId: (table: string, id: string) =>
        id.startsWith(`${table}-`) ? id : null,
    },
    // A handler that calls another handler must reach the real one too.
    runQuery: invoke,
    runMutation: invoke,
    runAction: invoke,
  } as never;
  return {
    tables,
    calls,
    ctx,
    /** The fake client the web code sees; every branch is the same real call. */
    client: {
      query: invoke,
      mutation: invoke,
      action: invoke,
    } as unknown as Parameters<typeof createQuote>[0],
  };
};

const { createQuote, evidenceBytes, openOrder, reviewDelivery, runAction } =
  await import("./flows");

const CHAIN = {
  network: hex32(0x00),
  orderNonce: hex32(0x11),
  termsCommitment: TERMS_COMMITMENT,
  buyerCommitment: hex32(0x33),
  merchantCommitment: hex32(0x44),
  operatorCommitment: hex32(0x55),
};
const TERMS = {
  unitPrice: "360000",
  total: "360000",
  scopeDigest: SCOPE_DIGEST,
  rightsDigest: hex32(0x77),
  paymentPolicy: hex32(0x88),
  salt: hex32(0x99),
};
const DEADLINES = {
  acceptance: "1700003600",
  delivery: "1700086400",
  review: "1700172800",
  resolution: "1700259200",
};
const INVITE = { network: CHAIN.network, orderNonce: CHAIN.orderNonce };
const CONTRACT = (phase: string, revision: number) => ({
  address: "0xcontract",
  phase,
  revision,
});

const detail = (over: Record<string, unknown> = {}) =>
  ({
    quoteId: "q1",
    orderId: "o1",
    title: "Product stills",
    brief: "Three images.",
    amountUsd: 3600,
    studioName: "Field Office",
    role: "buyer",
    stage: "QUOTE",
    version: 1,
    clientEmail: null,
    inviteUrl: null,
    inviteClaimed: true,
    deadlines: DEADLINES,
    chain: CHAIN,
    terms: TERMS,
    payment: { state: "none", mode: "test" },
    contract: null,
    delivery: { manifest: null, files: [] },
    ...over,
  }) as never;

const key = (actor: string) => ({
  quoteId: "q1",
  actor,
  secret: hex32(0xaa),
  nonce: CHAIN.orderNonce,
});
const BUYER_KEY = key("buyer") as never;
const MERCHANT_KEY = key("merchant") as never;

const report = (id: string, state: string) => reports.push({ id, state });
const steps = () => reports.map((r) => `${r.id}:${r.state}`);
/** The steps a full start reports, in order; a resume skips the first two. */
const DONE_START = [
  "terms:done",
  "hold:done",
  "deploy:done",
  "attach:done",
  "reserve:done",
];
const signed = () => calls.map((call) => call.circuit);

/**
 * A narrow fake for the flow-error tests. These deliberately break one step and
 * assert the flow stops, so they need a client that returns a chosen value —
 * not the real handler, which would refuse for its own reasons and make the
 * assertion pass for the wrong cause.
 */
const convexFor = (order: unknown) =>
  ({
    action: async (ref: unknown) => {
      const name = getFunctionName(ref as FunctionReference<"query">);
      if (name.includes("holdPayment")) return { state: holdState };
      if (name.includes("attachContract"))
        return { ok: attachOk, reason: "bind failed" };
      if (name.includes("operatorSecret")) return { secret: hex32(0xbb) };
      if (name.includes("serveFile")) return new Uint8Array([1, 2, 3]);
      return {};
    },
    mutation: async (ref: unknown) => {
      const name = getFunctionName(ref as FunctionReference<"query">);
      if (name.includes("acceptInvite"))
        return { ok: acceptOk, reason: "claimed" };
      if (name.includes("requestUpload"))
        return { uploadUrl: "https://upload.test/1", grantId: "g1" };
      if (name.includes("freezeMutation")) return { manifest: hex32(0xab) };
      return {};
    },
    query: async () => order,
  }) as never;

/** The real backend, for the tests that assert the server accepts the form. */
const real = (subject = "did:privy:buyer", tables?: Record<string, Row[]>) =>
  realBackend(subject, tables);

const action = (over: Record<string, unknown>) =>
  ({ icon: null, label: "Go", weight: "primary", ...over }) as never;

const sign = (
  order: unknown,
  over: Record<string, unknown>,
  key: unknown = BUYER_KEY,
  files: File[] = [],
  note = "",
) =>
  runAction({
    convex: convexFor(order),
    wallet: { connected: {} as never },
    subject: "user-1",
    detail: order,
    key,
    action: action(over),
    note,
    files,
    report,
  } as never);

beforeEach(() => {
  calls.length = 0;
  reports.length = 0;
  chainFailure = null;
  holdState = "held";
  attachOk = true;
  acceptOk = true;
});

describe("user path: invite, claim and hold", () => {
  const open = (over: Record<string, unknown> = {}) =>
    openOrder(
      convexFor(detail(over)),
      { connected: {} as never },
      "user-1",
      "q1",
      "token-abc",
      INVITE,
      report,
    );

  test("a new client opens an invitation and the order starts", async () => {
    await open();
    expect(signed()).toEqual(["reserve"]);
    expect(steps()).toEqual(expect.arrayContaining(DONE_START));
  });

  // Each row breaks one step and asserts the flow stops before signing.
  const STOPS: readonly (readonly [string, () => void, string, string?])[] = [
    [
      "a claimed invitation stops the flow before any signing",
      () => (acceptOk = false),
      "claimed",
    ],
    [
      "a card hold that does not complete stops before deploying",
      () => (holdState = "needs-card"),
      "Live card entry is not available yet.",
      "hold:failed",
    ],
    [
      "a contract that does not bind stops before reserving",
      () => (attachOk = false),
      "bind failed",
    ],
  ];

  for (const [title, breakStep, message, step] of STOPS)
    test(title, async () => {
      breakStep();
      await expect(open()).rejects.toThrow(message);
      expect(signed()).toEqual([]);
      if (step) expect(steps()).toContain(step);
    });

  test("reloading mid-flow resumes at reserve without re-deploying", async () => {
    await open({ stage: "DEPLOYED", contract: CONTRACT("DEPLOYED", 2) });
    expect(signed()).toEqual(["reserve"]);
    expect(steps()).toEqual(expect.arrayContaining(DONE_START.slice(2)));
  });

  test("tampered terms stop the order before the card is touched", async () => {
    await expect(
      open({ terms: { ...TERMS, scopeDigest: hex32(0x01) } }),
    ).rejects.toThrow("The terms do not match their commitment.");
    expect(signed()).toEqual([]);
  });
});

const RESERVED = detail({
  stage: "RESERVED",
  role: "merchant",
  contract: CONTRACT("RESERVED", 4),
});

describe("user path: accept and decline", () => {
  for (const circuit of ["accept", "decline"] as const)
    test(`the studio ${circuit}s a reserved order`, async () => {
      await sign(RESERVED, { circuit }, MERCHANT_KEY);
      expect(signed()).toEqual([circuit]);
      // signs against the revision the browser last saw, so a stale tab cannot double-sign
      expect(calls[0]?.expectedRevision).toBe(4n);
    });
});

describe("user path: deliver three files", () => {
  const accepted = detail({
    stage: "ACCEPTED",
    role: "merchant",
    contract: CONTRACT("ACCEPTED", 5),
  });
  const deliver = (files: File[]) =>
    sign(
      accepted,
      { circuit: "submitDelivery", needs: "files" },
      MERCHANT_KEY,
      files,
    );

  test("three files upload, lock and sign in order", async () => {
    const files = [0, 1, 2].map(
      (index) =>
        new File([new Uint8Array([index])], `file-${index}.jpg`, {
          type: "image/jpeg",
        }),
    );
    const original = globalThis.fetch;
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, json: async () => ({ storageId: "s1" }) };
    }) as never;
    try {
      await deliver(files);
    } finally {
      globalThis.fetch = original;
    }
    expect(steps()).toEqual(
      expect.arrayContaining(["upload:done", "lock:done", "sign:done"]),
    );
    expect(signed()).toEqual(["submitDelivery"]);
    // The three uploads are independent: all three must be in flight at once.
    expect(peak).toBe(3);
  });

  test("two files are rejected before any upload", async () => {
    await expect(deliver([])).rejects.toThrow("Select exactly three files.");
    expect(signed()).toEqual([]);
  });
});

describe("user path: digest mismatch blocks approve", () => {
  const submitted = (manifest: string, sha256: string) =>
    detail({
      stage: "SUBMITTED",
      delivery: {
        manifest,
        files: [0, 1, 2].map((index) => ({
          index,
          sha256,
          contentType: "image/jpeg",
          byteLength: 3,
        })),
      },
    });

  const sha256 = async (bytes: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ).toHex();

  test("a file that does not match its digest makes the manifest differ", async () => {
    const order = submitted(hex32(0xff), hex32(0x00));
    const result = await reviewDelivery(convexFor(order), order);
    expect(result.files.map((file) => file.match)).toEqual([
      false,
      false,
      false,
    ]);
    expect(result.manifest).not.toBe(hex32(0xff));
  });

  test("matching files reproduce the contract manifest", async () => {
    const digest = await sha256(new Uint8Array([1, 2, 3]));
    const manifest = await sha256(new TextEncoder().encode(digest.repeat(3)));
    const order = submitted(manifest, digest);
    const result = await reviewDelivery(convexFor(order), order);
    expect(result.files.every((file) => file.match)).toBe(true);
    expect(result.manifest).toBe(manifest);
  });
});

describe("user path: dispute and resolve", () => {
  test("the buyer opens a dispute with a note that becomes the evidence", async () => {
    await sign(
      detail({
        stage: "SUBMITTED",
        role: "buyer",
        contract: CONTRACT("SUBMITTED", 6),
      }),
      { circuit: "disputeBuyer", needs: "note", weight: "danger" },
      BUYER_KEY,
      [],
      "The third image is the wrong crop.",
    );
    expect(signed()).toEqual(["disputeBuyer"]);
    const extra = calls[0]?.extra as { evidence?: Uint8Array } | undefined;
    expect(extra?.evidence).toBeInstanceOf(Uint8Array);
    expect(extra?.evidence?.length).toBe(32);
  });

  test("the operator resolves with the digest read from the chain, not a note", async () => {
    const order = detail({
      stage: "DISPUTED",
      role: "operator",
      contract: {
        ...CONTRACT("DISPUTED", 7),
        evidenceCommitment: "cd".repeat(32),
      },
    });
    await sign(order, { circuit: "resolve", approveOrder: true }, null);
    expect(signed()).toEqual(["resolve"]);
    const extra = calls[0]?.extra as
      | { approveOrder?: boolean; evidence?: Uint8Array }
      | undefined;
    expect(extra?.approveOrder).toBe(true);
    expect(extra?.evidence).toEqual(bytes32(0xcd));
  });
});

describe("R37 the resolve path does not serialise two independent legs", () => {
  // `operatorKey` (a Convex action, ~290 ms measured) and `disputedEvidence` (a
  // chain read) have no dependency on each other: one needs `quoteId`, the other
  // `contract.address`, and both are on `detail` already. Before R37 they were
  // awaited in series, so the Convex round trip preceded the chain read for
  // nothing.
  //
  // The discriminating observation is ORDER. With the serial code the chain leg
  // cannot be entered until the operator action has resolved; with the parallel
  // code it is entered while the operator action is still open.
  const resolveAction = { circuit: "resolve" } as never;

  test("the chain leg is entered before the operator action settles", async () => {
    const events: string[] = [];
    let releaseOperator: (() => void) | undefined;
    const operatorGate = new Promise<void>((r) => {
      releaseOperator = r;
    });
    onChainStart = () => events.push("chain:start");
    const convex = {
      action: async (ref: unknown) => {
        const name = getFunctionName(ref as FunctionReference<"query">);
        if (name.includes("operatorSecret")) {
          events.push("operator:start");
          await operatorGate;
          events.push("operator:end");
          return { secret: hex32(0xbb) };
        }
        return {};
      },
      query: async () => detail(),
      mutation: async () => ({ ok: true }),
    } as never;

    try {
      const started = runAction({
        convex,
        wallet: { connected: {} as never },
        subject: "user-1",
        // A contract address is what makes disputedEvidence open the watch at
        // all; with `contract: null` it returns before the chain leg exists.
        detail: detail({ contract: CONTRACT("DISPUTED", 5) }),
        key: null,
        action: resolveAction,
        note: "",
        files: [],
        report,
      }).catch(() => {});

      // Let both legs run as far as they can while the operator gate is closed.
      // A macrotask, not just microtasks: `disputedEvidence` awaits `chain()`,
      // a dynamic import that settles on a later turn.
      await new Promise((r) => setTimeout(r, 0));
      expect(events).toContain("operator:start");
      expect(events).not.toContain("operator:end");
      // THE ASSERTION: the chain leg was entered while the operator leg was open.
      expect(events).toContain("chain:start");
      releaseOperator?.();
      await started;
    } finally {
      onChainStart = undefined;
    }
  });
});

describe("evidenceBytes reads a chain commitment", () => {
  test("accepts a 32 byte hex digest and rejects anything else", () => {
    for (const value of [null, undefined, "not-hex", "ab".repeat(31)])
      expect(evidenceBytes(value)).toBeNull();
    expect(evidenceBytes("ab".repeat(32))).toEqual(bytes32(0xab));
  });
});

describe("user path: wallet missing or the user rejects signing", () => {
  test("a rejected signature surfaces the chain error", async () => {
    chainFailure = new Error("Lace rejected the signature.");
    await expect(sign(RESERVED, { circuit: "accept" })).rejects.toThrow(
      "Lace rejected the signature.",
    );
  });

  test("a browser with no key refuses to sign and never reaches the chain", async () => {
    await expect(sign(RESERVED, { circuit: "accept" }, null)).rejects.toThrow(
      "This browser has no key for this order.",
    );
    expect(signed()).toEqual([]);
  });
});

describe("the hold settles before the deadlines are read", () => {
  // R-13: the deadlines do not exist until the hold freezes the quote, so a read
  // issued while the hold is pending is guaranteed empty. The old test here
  // asserted exactly that ordering ("the deadlines query is issued while the
  // hold is pending") because it was written to prove an R19 overlap
  // optimisation — and it therefore pinned the defect: any correct fix had to
  // fail it.
  //
  // R-13 v3 (R36): the hold now RETURNS the deadlines it froze, so on the
  // first-accept path there is no post-hold read at all. This test keeps its
  // original purpose — nothing may read deadlines while the hold is pending —
  // and additionally pins the new property: the hold's own answer is used, so
  // no read happens after it either.
  test("no deadlines read is issued before the hold settles, and none after", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const convex = {
      action: async (ref: unknown) => {
        const name = getFunctionName(ref as FunctionReference<"query">);
        if (name.includes("holdPayment")) {
          events.push("hold:start");
          await gate;
          events.push("hold:end");
          // The real action now carries the deadlines it froze.
          return { state: "held", deadlines: DEADLINES };
        }
        return name.includes("attachContract") ? { ok: true, reason: "" } : {};
      },
      mutation: async (ref: unknown) =>
        getFunctionName(ref as FunctionReference<"query">).includes(
          "acceptInvite",
        )
          ? { ok: true, reason: "" }
          : {},
      query: async () => {
        // `openOrder` reads the order once before the hold; that read is not a
        // deadlines read and is expected. Only reads issued after the hold
        // STARTS are the ones that used to race it.
        if (events.includes("hold:start"))
          events.push(
            events.includes("hold:end") ? "query:after" : "query:raced",
          );
        return detail();
      },
    } as never;

    const started = openOrder(
      convex,
      { connected: {} as never },
      "user-1",
      "q1",
      "token-abc",
      INVITE,
      report,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toContain("hold:start");
    // The assertion: while the hold is still pending, no deadlines read has run.
    expect(events).not.toContain("hold:end");
    expect(events).not.toContain("query:raced");
    release?.();
    await started.catch(() => {});
    expect(events).toContain("hold:end");
    // R-13 v3: and because the hold answered with the deadlines, the read that
    // used to follow it is gone. This is the round trip the change removes.
    expect(events).not.toContain("query:after");
  });

  // The other half of the same race, found by the real-handler harness: the
  // hold is started concurrently, so it must also be SETTLED before anything
  // can throw. The old code threw on a missing deadlines row while the hold was
  // pending, so a declined card escaped as an unhandled rejection and the user
  // was told "no deadlines" instead of "the card was declined".
  // R-13 regression: the deadlines do not EXIST until the hold resolves,
  // because the hold is what freezes the quote. So any deadlines read issued
  // before the hold settles legitimately comes back empty, and the flow must
  // settle the hold and read again rather than trust the empty answer.
  //
  // The fake models that temporal condition directly (a flag flipped when
  // `holdPayment` resolves), not a read count, so it cannot be satisfied by
  // accident. On the pre-fix code the read happens while the hold is pending,
  // sees no deadlines, and the flow throws "The order has no deadlines yet".
  //
  // R-13 v3 (R36): the hold now carries the deadlines, so this test's fake
  // returns them from the action — which is what a real server does. The
  // property under test is unchanged: a fresh QUOTE still deploys, and it now
  // deploys without the follow-up read.
  test("a fresh QUOTE whose first deadlines read is empty still deploys", async () => {
    let frozen = false;
    const convex = {
      action: async (ref: unknown) => {
        const name = getFunctionName(ref as FunctionReference<"query">);
        if (name.includes("holdPayment")) {
          frozen = true; // the freeze that creates the deadlines
          return { state: "held", deadlines: DEADLINES };
        }
        if (name.includes("attachContract")) return { ok: true };
        return {};
      },
      mutation: async () => ({ ok: true }),
      query: async () =>
        frozen ? detail() : { ...(detail() as object), deadlines: null },
    } as unknown as Parameters<typeof openOrder>[0];
    await openOrder(
      convex,
      { connected: {} as never },
      "user-1",
      "q1",
      "token-abc",
      INVITE,
      report,
    );
  });

  // R-13 v3: the point of the change, stated as its own test. A server that
  // returns the deadlines must not be followed by a read — that read is the
  // 290 ms this removes. A server that does NOT return them (an older
  // deployment mid-rollout) must still work, via the fallback read. Both halves
  // matter: the first is the optimisation, the second is the rollout.
  test("a hold that returns deadlines costs no follow-up read", async () => {
    let reads = 0;
    const convex = {
      action: async (ref: unknown) => {
        const name = getFunctionName(ref as FunctionReference<"query">);
        if (name.includes("holdPayment"))
          return { state: "held", deadlines: DEADLINES };
        if (name.includes("attachContract")) return { ok: true };
        return {};
      },
      mutation: async () => ({ ok: true }),
      query: async () => {
        reads += 1;
        return detail();
      },
    } as unknown as Parameters<typeof openOrder>[0];
    await openOrder(
      convex,
      { connected: {} as never },
      "user-1",
      "q1",
      "token-abc",
      INVITE,
      report,
    );
    // Exactly the one read `openOrder` does before `startOrder`. No second one.
    expect(reads).toBe(1);
  });

  test("an older server that omits deadlines still deploys via the fallback read", async () => {
    // Mid-rollout: the client is new, the deployment is not. `deadlines` is
    // absent from the action's answer, so the client must fall back rather than
    // fail — this is what makes the change additive.
    let reads = 0;
    const convex = {
      action: async (ref: unknown) => {
        const name = getFunctionName(ref as FunctionReference<"query">);
        if (name.includes("holdPayment")) return { state: "held" };
        if (name.includes("attachContract")) return { ok: true };
        return {};
      },
      mutation: async () => ({ ok: true }),
      query: async () => {
        reads += 1;
        return detail();
      },
    } as unknown as Parameters<typeof openOrder>[0];
    await openOrder(
      convex,
      { connected: {} as never },
      "user-1",
      "q1",
      "token-abc",
      INVITE,
      report,
    );
    // The pre-hold read plus the fallback one.
    expect(reads).toBe(2);
  });

  test("a declined card surfaces, and no rejection escapes", async () => {
    const escaped: unknown[] = [];
    const onEscape = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", onEscape);
    try {
      const convex = {
        action: async (ref: unknown) => {
          if (
            getFunctionName(ref as FunctionReference<"query">).includes(
              "holdPayment",
            )
          )
            throw new Error("The card was declined.");
          return {};
        },
        mutation: async () => ({ ok: true }),
        // No deadlines row: the trigger for the old throw.
        query: async () => ({ ...(detail() as object), deadlines: null }),
      } as unknown as Parameters<typeof openOrder>[0];
      const message = await openOrder(
        convex,
        { connected: {} as never },
        "user-1",
        "q1",
        "token-abc",
        INVITE,
        report,
      ).then(
        () => "",
        (cause: Error) => cause.message,
      );
      // Let any floating rejection settle before asserting it did not.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(message).toBe("The card was declined.");
      expect(escaped).toEqual([]);
    } finally {
      process.off("unhandledRejection", onEscape);
    }
  });
});

/** A valid argument set for createStudioAndQuote, as the form builds it. */
const H64 = "a".repeat(64);
const QUOTE_ARGS = {
  studioName: "North Studio",
  title: "Three hero images",
  brief: "A short brief for the fixed-price image pack.",
  amountUsd: 900,
  clientEmail: "client@example.com",
  orderNonce: H64,
  merchantCommitment: H64,
  termsCommitment: H64,
  terms: {
    unitPrice: "90000",
    total: "90000",
    scopeDigest: H64,
    rightsDigest: H64,
    paymentPolicy: H64,
    salt: H64,
  },
};
const FORM = {
  title: QUOTE_ARGS.title,
  brief: QUOTE_ARGS.brief,
  amountUsd: QUOTE_ARGS.amountUsd,
  clientEmail: QUOTE_ARGS.clientEmail,
};

/** The descriptor a registered function publishes for its args or returns. */
const descriptor = (fn: unknown, kind: "exportArgs" | "exportReturns") =>
  JSON.parse((fn as Record<string, () => string>)[kind]()) as {
    value: Record<string, unknown>;
  };

describe("the form and the server agree, checked against the server's own descriptors", () => {
  // A field the server never reads, or a required one the form forgot, throws
  // ArgumentValidationError in production and tsc cannot see it: the browser
  // builds the object at runtime. checkArgs is the mirror of checkReturns.
  const CASES: readonly (readonly [string, Record<string, unknown>, string])[] =
    [
      [
        "a field the server never reads",
        { ...QUOTE_ARGS, amountMinor: 90000 },
        "extra field amountMinor",
      ],
      [
        "a required field the form forgot",
        Object.fromEntries(
          Object.entries(QUOTE_ARGS).filter(([k]) => k !== "termsCommitment"),
        ),
        "required field termsCommitment is missing",
      ],
    ];

  for (const [name, args, message] of CASES)
    test(`${name} is rejected, not ignored`, () => {
      expect(() =>
        checkArgs(stripeProvisioning.createStudioAndQuote, args),
      ).toThrow(message);
    });

  test("the browser's upload fields are exactly what the server declares", () => {
    // The browser builds the `files` array itself, so this is the one place a
    // hand-written shape could drift from the server's validator.
    const proposed = {
      grantId: "grant-1",
      sha256: "a".repeat(64),
      contentType: "image/jpeg",
      byteLength: 3,
    };
    const filesArg = (
      descriptor(files.freezeMutation, "exportArgs").value.files as {
        fieldType: { value: { value: Record<string, unknown> } };
      }
    ).fieldType.value.value;
    expect(Object.keys(proposed).sort()).toEqual(Object.keys(filesArg).sort());
    expect(() =>
      checkArgs(files.freezeMutation, { orderId: "o1", files: [proposed] }),
    ).not.toThrow();
    expect(() =>
      checkArgs(files.freezeMutation, {
        orderId: "o1",
        files: [{ ...proposed, name: "file-0.jpg" }],
      }),
    ).toThrow("extra field name");
  });

  test("requestUpload returns the four fields the browser reads", () => {
    // The browser destructures grantId, uploadUrl and uploadTicket. A rename on
    // the server would leave the upload silently posting to undefined.
    expect(
      Object.keys(
        descriptor(files.requestUploadMutation, "exportReturns").value,
      ).sort(),
    ).toEqual(["expiresAt", "grantId", "uploadTicket", "uploadUrl"]);
  });

  test("an account is required before the quote form renders", () => {
    // NewQuote returns null without `me`, before any hook runs a query.
    const source = readFileSync("apps/web/src/routes/NewQuote.tsx", "utf8");
    expect(source).toContain("if (!me) return null;");
    expect(source.indexOf("if (!me) return null;")).toBeLessThan(
      source.indexOf("<form"),
    );
  });
});

describe("the whole story runs on real handlers", () => {
  test("studio quotes, buyer claims, and the order reads back", async () => {
    // One database, two identities: the studio writes the quote, then the buyer
    // claims it. That is what a second signed-in browser is.
    const studio = real("did:privy:merchant");
    const created = await createQuote(
      studio.client,
      "did:privy:merchant",
      { studioName: "North Studio" },
      FORM,
    );
    // The handler's own returns validator already ran; these are the fields the
    // UI reads, so a rename on either side breaks this line.
    expect(created.quoteId).toMatch(/^quote_[0-9a-f]{32}$/);
    expect(created.inviteUrl).toContain(created.quoteId);
    // The draft the server actually wrote, and the cents it derived.
    const draft = studio.tables.quoteDrafts[0];
    expect(draft).toMatchObject({ ...FORM, amountMinor: FORM.amountUsd * 100 });
    const terms = draft.terms as { unitPrice: string };
    expect(String(terms.unitPrice)).toBe(String(FORM.amountUsd * 100));

    // The invite the studio was handed opens for the invited buyer. The invite
    // query admits a non-member only when the signed-in email matches.
    const token = new URL(created.inviteUrl).searchParams.get("invite") ?? "";
    expect(token).toHaveLength(64);
    AUTH_USER.value = { email: FORM.clientEmail };
    const buyer = real("did:privy:buyer", studio.tables);
    const preview = await buyer.client.query(api.invite, {
      quoteId: created.quoteId,
      token,
    });
    // Exactly the fields orders.invite declares: no clientEmail, no terms.
    // `network` is the hex of "preprod" and `orderNonce` is server-generated, so
    // the assertion is on shape plus agreement with the stored draft.
    expect(preview).toMatchObject({
      title: FORM.title,
      brief: FORM.brief,
      amountUsd: FORM.amountUsd,
      studioName: "North Studio",
      claimed: false,
    });
    expect(Object.keys(preview ?? {}).sort()).toEqual([
      "amountUsd",
      "brief",
      "claimed",
      "network",
      "orderNonce",
      "studioName",
      "title",
    ]);
    // The network field is the 32-byte hex of "preprod", zero-padded.
    expect(preview?.network).toBe("70726570726f64".padEnd(64, "0"));
    const stored = draft as unknown as { orderNonce: string; scopeId: string };
    expect(preview?.orderNonce).toBe(stored.orderNonce);
    expect(typeof token).toBe("string");

    // The Accept screen calls openOrder, which claims then reads the order. The
    // chain fake cannot produce a genesis hash, so the flow stops after the
    // claim; what matters is that the refusal it stops on is the chain's.
    if (!preview) throw new Error("the invitation did not read back");
    const stopped = await openOrder(
      buyer.client,
      { connected: {} as never },
      "did:privy:buyer",
      created.quoteId,
      token,
      preview,
      report,
    ).then(
      () => "",
      (cause: Error) => cause.message,
    );
    expect(stopped).not.toContain("This order link does not work.");

    // The server recorded the buyer, rotated the token, and made a membership.
    expect(buyer.tables.quoteDrafts[0].buyerSubject).toBe("did:privy:buyer");
    expect(buyer.tables.quoteDrafts[0].inviteToken).not.toBe(token);
    expect(buyer.tables.memberships).toContainEqual(
      expect.objectContaining({
        privySubject: "did:privy:buyer",
        scopeId: stored.scopeId,
        role: "buyer",
        status: "active",
      }),
    );
    // A spent link is refused with the same message as a wrong one.
    expect(
      await buyer.client.mutation(api.acceptInvite, {
        quoteId: created.quoteId,
        token,
        buyerCommitment: "b".repeat(64),
      }),
    ).toEqual({ ok: false, reason: "This order link does not work." });
  });
});

describe("a different account corrupts nothing", () => {
  // The session signed in with one address; the wallet now reports another.
  // `me.walletAddress` is the last 16 characters of the signed-in address
  // (convex/auth.ts stores wallet-<last16>@wallet.milo.local), so the check is a
  // suffix match.
  const LINKED =
    "mn_addr_preprod1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqabcdef123456";
  const LINKED_SUFFIX = LINKED.slice(-16);
  const OTHER =
    "mn_addr_preprod1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzzzzzz999999";

  // Looked up on the namespace with a permissive fallback, so on the base tree
  // these fail on the VALUE (a wrong account is not flagged) rather than on a
  // missing export, which would only prove the export exists.
  const walletModule = () =>
    import("./wallet") as Promise<{
      differentAccount?: (a: string | null, b: string | null) => boolean;
    }>;

  test("the same account is not flagged, the other one is", async () => {
    const { differentAccount = () => false } = await walletModule();
    expect(differentAccount(LINKED, LINKED_SUFFIX)).toBe(false);
    expect(differentAccount(OTHER, LINKED_SUFFIX)).toBe(true);
    // Unknown on either side must not block a legitimate user.
    expect(differentAccount(LINKED, null)).toBe(false);
    expect(differentAccount(null, LINKED_SUFFIX)).toBe(false);
    // A too-short suffix would match by accident, so it is ignored.
    expect(differentAccount(OTHER, "1234")).toBe(false);
  });

  test("a wrong account leaves the saved key and the server untouched", async () => {
    const { differentAccount = () => false } = await walletModule();
    const { keyFor, saveKey } = await import("./keys");
    const subject = "did:privy:buyer";
    saveKey(subject, {
      quoteId: "q1",
      actor: "buyer" as const,
      secret: "a".repeat(64),
      nonce: "b".repeat(64),
    });
    const before = JSON.stringify(keyFor(subject, "q1"));
    const backend = real("did:privy:buyer");

    // The guard the order page applies before any action. On base this is false,
    // so the assertion below is what fails: the guard is missing.
    expect(differentAccount(OTHER, LINKED_SUFFIX)).toBe(true);

    // Nothing ran: no handler was called, and the key ring is byte-identical.
    expect(backend.calls).toEqual([]);
    expect(JSON.stringify(keyFor(subject, "q1"))).toBe(before);
    expect(backend.tables.quoteDrafts).toEqual([]);
    expect(backend.tables.memberships).toEqual([]);
  });

  test("the same account is allowed through, so the guard is not a blanket block", async () => {
    const { differentAccount = () => false } = await walletModule();
    const backend = real("did:privy:merchant");
    expect(differentAccount(LINKED, LINKED_SUFFIX)).toBe(false);
    // With the guard open, the real handler runs and writes the draft.
    await backend.client.action(api.createStudioAndQuote, {
      ...QUOTE_ARGS,
      scopeId: undefined,
    });
    expect(backend.tables.quoteDrafts).toHaveLength(1);
  });
});

describe("two tabs cannot lose each other's order key", () => {
  // localStorage has no atomic read-modify-write. With ONE ring entry, two tabs
  // saving at the same moment each spread a snapshot taken before the other's
  // key existed, so the later write deletes the earlier key — and the order key
  // is the only thing that can sign for that order.
  //
  // The tests interleave for real: a storage double lets the other tab write
  // BETWEEN our read and our write, which is the exact lost-update window.
  // Sequential saves never lose anything, on either version, so they prove
  // nothing and are not used here.
  const key = (quoteId: string, secret: string) => ({
    quoteId,
    actor: "buyer" as const,
    secret: secret.repeat(64),
    nonce: "b".repeat(64),
  });

  /**
   * The invariant the fix provides: two orders must not share a storage entry.
   * With one ring entry both writes target the same key, so the later one wins
   * and the earlier key is gone. With one entry per order they cannot collide.
   * This is asserted directly rather than by simulating a race, because the
   * property is what makes the race impossible.
   */
  const entriesFor = (subject: string) => {
    const prefix = `milo:order-keys:${subject}`;
    return [...Array(localStorage.length).keys()]
      .map((index) => localStorage.key(index))
      .filter((name): name is string => Boolean(name?.startsWith(prefix)));
  };

  test("two orders live in two storage entries, not one", async () => {
    const { saveKey } = await import("./keys");
    const subject = `did:privy:entries-${Math.random()}`;
    saveKey(subject, key("q1", "a"));
    saveKey(subject, key("q2", "c"));
    // Two entries means two writes cannot overwrite each other.
    expect(entriesFor(subject)).toHaveLength(2);
  });

  test("two tabs saving different orders both keep their key", async () => {
    const { saveKey, readKeys } = await import("./keys");
    const subject = `did:privy:two-${Math.random()}`;
    saveKey(subject, key("q1", "a"));
    saveKey(subject, key("q2", "c"));
    expect(Object.keys(readKeys(subject)).sort()).toEqual(["q1", "q2"]);
  });

  test("a key saved in the old single-entry format is still read", async () => {
    const { readKeys } = await import("./keys");
    const subject = `did:privy:legacy-${Math.random()}`;
    localStorage.setItem(
      `milo:order-keys:${subject}`,
      JSON.stringify({ old: key("old", "f") }),
    );
    expect(readKeys(subject).old?.secret.startsWith("f")).toBe(true);
  });
});
