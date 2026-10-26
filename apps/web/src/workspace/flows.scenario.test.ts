import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { installMemoryStorage } from "./test-storage";

// Scenario suite: each test walks one named user path through the real
// flows.ts. The chain is a fake that records what was signed, and the Convex
// client is a fake too, so nothing touches a network or a ledger.

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
  // The real provider calls back with on-chain state; deliver it next tick so
  // the promise in flows.ts resolves instead of waiting for its timeout.
  watchOrderContract: (input: {
    onState: (state: { evidenceCommitment: string | null }) => void;
  }) => {
    const timer = setTimeout(
      () => input.onState({ evidenceCommitment: "cd".repeat(32) }),
      0,
    );
    return () => clearTimeout(timer);
  },
}));

installMemoryStorage();

const { evidenceBytes, openOrder, reviewDelivery, runAction } = await import(
  "./flows"
);

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

const convexFor = (order: unknown) =>
  ({
    action: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.includes("holdPayment")) return { state: holdState };
      if (name.includes("attachContract"))
        return { ok: attachOk, reason: "bind failed" };
      if (name.includes("operatorSecret")) return { secret: hex32(0xbb) };
      if (name.includes("serveFile")) return new Uint8Array([1, 2, 3]);
      return {};
    },
    mutation: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.includes("acceptInvite"))
        return { ok: acceptOk, reason: "claimed" };
      if (name.includes("requestUpload"))
        return { uploadUrl: "https://upload.test/1", grantId: "g1" };
      if (name.includes("freezeMutation")) return { manifest: hex32(0xab) };
      return {};
    },
    query: async () => order,
  }) as never;

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

describe("the hold and the deadlines query overlap", () => {
  // `openOrder` reads the order first, so counting queries alone proves nothing.
  // What differs is WHEN the second (deadlines) read is issued: the fixed code
  // asks while the hold is pending; the serial base asks only after it resolves.
  test("the deadlines query is issued while the hold is pending", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let queries = 0;
    const convex = {
      action: async (ref: unknown) => {
        const name = getFunctionName(ref as never);
        if (name.includes("holdPayment")) {
          events.push("hold:start");
          await gate;
          events.push("hold:end");
          return { state: "held" };
        }
        return name.includes("attachContract") ? { ok: true, reason: "" } : {};
      },
      mutation: async (ref: unknown) =>
        getFunctionName(ref as never).includes("acceptInvite")
          ? { ok: true, reason: "" }
          : {},
      query: async () => {
        queries += 1;
        events.push(`query:${queries}`);
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
    // The serial base has only openOrder's read here, so this is the assertion
    // it cannot satisfy.
    expect(events.filter((e) => e.startsWith("query"))).toHaveLength(2);
    expect(events).not.toContain("hold:end");
    release?.();
    await started.catch(() => {});
    expect(events).toContain("hold:end");
  });
});
