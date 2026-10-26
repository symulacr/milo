/**
 * M7 — Auth inventory: every public Convex function and HTTP route has an
 * authorization test. Completeness is source-scanned so a new public export
 * without a row fails the suite.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as auth from "../../../convex/auth";
import { requireMembership } from "../../../convex/auth/identity";
import * as chainObserver from "../../../convex/chainObserver";
import * as files from "../../../convex/files";
import { stripeWebhookHandler } from "../../../convex/http";
import {
  type Row,
  readSurface,
  writeSurface,
} from "../../../convex/orderProjection.double";
import * as orders from "../../../convex/orders";
import * as paymentMonitoring from "../../../convex/paymentMonitoring";
import * as provisioning from "../../../convex/provisioning";
import * as stripeProvisioning from "../../../convex/stripeProvisioning";
import * as trustedProvisioning from "../../../convex/trustedProvisioning";
import { requireSessionSubject } from "../src/session-identity";
import {
  checkReturns,
  handlerOf,
  quoteArgs as sharedQuoteArgs,
} from "./fixtures";

/** The shared builder, with this suite's fixed scope. */
const quoteArgs = (extra: Record<string, unknown> = {}) =>
  sharedQuoteArgs("scope-1", extra);

// AUDIT15 A-01/A-11: the privy.io fallback is gone and a short auth secret is
// fatal, so this suite declares both instead of relying on insecure defaults.
// Importing any Convex module evaluates `auth.ts`, which validates them.
process.env.CONVEX_SITE_URL ??= "privy.io";
process.env.BETTER_AUTH_SECRET ??= "a".repeat(32);

const CONVEX_DIR = new URL("../../../convex", import.meta.url).pathname;

type Identity = { issuer: string; subject: string } | null;

const emptyTables = (): Record<string, Row[]> =>
  Object.fromEntries(
    [
      "approvedQuotes",
      "frozenQuotes",
      "memberships",
      "orders",
      "fileGrants",
      "deliveries",
      "paymentJobs",
      "paymentMonitors",
      "paymentIntents",
      "paymentObservations",
      "paymentInbox",
      "settlementOps",
      "trustedProvisioning",
      "stripeCustomers",
      "deploymentObservations",
      "canonicalBindings",
      "admissionTimingPolicies",
    ].map((name) => [name, [] as Row[]]),
  );

function ctxDouble(identity: Identity, tables = emptyTables()) {
  let identityRef = identity;
  const ctx = {
    auth: { getUserIdentity: async () => identityRef },
    storage: {
      getMetadata: async () => null,
      generateUploadUrl: async () => "https://upload.invalid",
      get: async () => null,
    },
    scheduler: { runAfter: async () => null },
    db: { ...readSurface(tables), ...writeSurface(tables) },
  };
  return {
    ctx: ctx as never,
    tables,
    setIdentity: (value: Identity) => {
      identityRef = value;
    },
  };
}

const ANON: Identity = null;
const BUYER: Identity = { issuer: "privy.io", subject: "did:privy:buyer" };
const STRANGER: Identity = {
  issuer: "privy.io",
  subject: "did:privy:stranger",
};

/**
 * Add the three cross-function runners. The shared double deliberately has none,
 * because several suites assert the refusal a missing runner produces; a test
 * that needs the auth component's client API (which runs a query) or an action's
 * own `runQuery`/`runMutation` opts in here instead.
 */
const withRunners = <T extends { ctx: never }>(f: T): T => {
  Object.assign(f.ctx as object, {
    runQuery: async () => null,
    runMutation: async () => null,
    runAction: async () => null,
  });
  return f;
};

/**
 * The quote-write arguments `writeQuoteDraft`, `createQuote` and
 * `createStudioAndQuote` all take. One builder, so a change to the terms shape
 * cannot leave one row of the authorization table stale.
 */

/** Public Convex surfaces that must reject unauthenticated callers. */
const PUBLIC_QUERY_MUTATION: Array<{
  name: string;
  kind: "query" | "mutation" | "action";
  invoke: (ctx: never) => Promise<unknown>;
}> = [
  {
    name: "provisioning.freeze",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(provisioning.freeze)(ctx, {
        quoteId: "quote-1",
        expectedVersion: 1,
      }),
  },
  {
    name: "paymentMonitoring.status",
    kind: "query",
    invoke: (ctx) =>
      handlerOf(paymentMonitoring.status)(ctx, { quoteId: "quote-1" }),
  },
  {
    name: "paymentMonitoring.start",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(paymentMonitoring.start)(ctx, {
        quoteId: "quote-1",
        expectedVersion: 1,
        consent: "monitor-test-payment",
      }),
  },
  {
    name: "paymentMonitoring.stop",
    kind: "mutation",
    invoke: (ctx) => handlerOf(paymentMonitoring.stop)(ctx, { quoteId: "q" }),
  },
  {
    name: "files.requestUpload",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(files.requestUploadMutation)(ctx, { orderId: "order-1" }),
  },
  {
    name: "files.attachUpload",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(files.attachUploadMutation)(ctx, {
        grantId: "grant-1",
        storageId: "blob-1",
      }),
  },
  {
    name: "files.freeze",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(files.freezeMutation)(ctx, {
        orderId: "order-1",
        files: [],
      }),
  },
  {
    name: "orders.order",
    kind: "query",
    invoke: (ctx) => handlerOf(orders.order)(ctx, { quoteId: "quote-1" }),
  },
  {
    name: "orders.list",
    kind: "query",
    invoke: (ctx) => handlerOf(orders.list)(ctx, {}),
  },
  {
    name: "orders.invite",
    kind: "query",
    invoke: (ctx) =>
      handlerOf(orders.invite)(ctx, { quoteId: "quote-1", token: "t" }),
  },
  {
    name: "trustedProvisioning.createStudio",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(trustedProvisioning.createStudio)(ctx, {
        name: "North Studio",
      }),
  },
  {
    name: "trustedProvisioning.writeQuoteDraft",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(trustedProvisioning.writeQuoteDraft)(ctx, quoteArgs()),
  },
  {
    name: "trustedProvisioning.acceptInvite",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(trustedProvisioning.acceptInvite)(ctx, {
        quoteId: "quote-1",
        token: "t",
        buyerCommitment: "c".repeat(64),
      }),
  },
  {
    name: "auth.me",
    kind: "query",
    invoke: (ctx) => handlerOf(auth.me)(ctx, {}),
  },
  {
    name: "stripeProvisioning.createQuote",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(stripeProvisioning.createQuote)(ctx, quoteArgs()),
  },
  {
    name: "stripeProvisioning.holdPayment",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(stripeProvisioning.holdPayment)(ctx, { quoteId: "q" }),
  },
  {
    name: "stripeProvisioning.createStudioAndQuote",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(stripeProvisioning.createStudioAndQuote)(
        ctx,
        quoteArgs({ studioName: "North Studio" }),
      ),
  },
  {
    name: "stripeProvisioning.operatorSecret",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(stripeProvisioning.operatorSecret)(ctx, { quoteId: "q" }),
  },
  {
    name: "chainObserver.refreshOrder",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(chainObserver.refreshOrder)(ctx, { quoteId: "q" }),
  },
  {
    name: "stripeProvisioning.attachContract",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(stripeProvisioning.attachContract)(ctx, {
        quoteId: "q",
        address: "a".repeat(64),
      }),
  },
  {
    name: "files.serveFile",
    kind: "action",
    invoke: (ctx) =>
      handlerOf(files.serveFileAction)(ctx, {
        orderId: "order-1",
        fileIndex: 0,
      }),
  },
];

async function scanPublicExports() {
  const entries = await readdir(CONVEX_DIR, { withFileTypes: true });
  const found = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    const text = await readFile(join(CONVEX_DIR, entry.name), "utf8");
    for (const match of text.matchAll(
      /export const (\w+) = (queryGeneric|mutationGeneric|actionGeneric|httpActionGeneric)\(/g,
    )) {
      found.set(`${entry.name.replace(/\.ts$/, "")}.${match[1]}`, match[2]);
    }
  }
  return found;
}

/**
 * The four exports whose source name differs from their inventory name, and the
 * one export that has no inventory row. Declared once so the completeness test
 * and the authorization matrix cannot drift apart.
 */
const EXPORT_ALIAS: Record<string, string> = {
  "files.requestUploadMutation": "files.requestUpload",
  "files.attachUploadMutation": "files.attachUpload",
  "files.freezeMutation": "files.freeze",
  // Public byte transport: identity comes from the verified session, and the
  // descriptor is resolved under that identity, never from arguments.
  "files.serveFileAction": "files.serveFile",
};

/** `admission.bind` delegates to `admitCanonical`, which is not a Convex
 * function; it is asserted by its own test below. HTTP actions have their own
 * route tests. */
const EXPORT_EXEMPT = new Set(["admission.bind"]);

describe("M7 auth inventory — public Convex query/mutation", () => {
  test.each(PUBLIC_QUERY_MUTATION.map((row) => [row.name, row] as const))(
    "%s rejects unauthenticated callers",
    async (_name, row) => {
      const f = ctxDouble(ANON);
      await expect(Promise.resolve(row.invoke(f.ctx))).rejects.toThrow();
    },
  );

  // H1: the other two dimensions of the same table. A signed-in caller who is a
  // member of no studio, and one who is a buyer in the wrong studio, must get
  // nothing back. Rows refuse by throwing, returning null, an empty list, or
  // `ok: false`; all four are refusals, asserted as "yields no data".
  //
  // `createStudio` is exempt: creating a studio is what a stranger legitimately
  // does, so it is the one public mutation that must succeed. It used to look
  // like a refusal only because the shared db double lacked `.filter` and threw
  // a TypeError — a false pass that AUDIT15 A-07 removed when `ensureStudio`
  // stopped using that query.
  //
  // `auth.me` is exempt for the same reason and was the same kind of false pass:
  // it returns the caller's own identity, and it only looked refused because
  // `merchantMembershipOf` uses `.filter`. ROUND17 implemented `.filter` in the
  // double, which turned the false pass into a failure; both exemptions are
  // asserted positively below, so neither can quietly become a hole.
  const scoped = PUBLIC_QUERY_MUTATION.filter(
    (row) =>
      row.name !== "orders.invite" &&
      row.name !== "auth.me" &&
      row.name !== "trustedProvisioning.createStudio",
  );
  const refused = async (row: (typeof scoped)[number], f: { ctx: never }) => {
    let yielded: unknown;
    try {
      yielded = await row.invoke(f.ctx);
    } catch {
      return;
    }
    expect(
      yielded === null ||
        (Array.isArray(yielded) && yielded.length === 0) ||
        (typeof yielded === "object" &&
          yielded !== null &&
          (yielded as { ok?: boolean }).ok === false),
    ).toBe(true);
  };
  const wrongStudio = () => {
    const f = ctxDouble(BUYER);
    // A real membership, but in a different scope and with the buyer role.
    f.tables.memberships.push({
      _id: "m-other",
      privySubject: "did:privy:buyer",
      scopeId: "scope-other",
      accountId: "buyer-1",
      role: "buyer",
      status: "active",
    });
    return f;
  };
  test.each([
    ["no studio membership", () => ctxDouble(STRANGER)],
    ["a buyer from another studio", wrongStudio],
  ])("%s is refused by every public function", async (_label, build) => {
    for (const row of scoped) await refused(row, build());
  });

  // The exemption above is asserted positively, so it cannot quietly become a
  // hole: a stranger gets a studio, and only a studio.
  test("createStudio is the one public mutation a stranger may call", async () => {
    const f = ctxDouble(STRANGER);
    const out = await handlerOf<{ name: string }, { scopeId: string }>(
      trustedProvisioning.createStudio,
    )(f.ctx, { name: "North Studio" });
    expect(out.scopeId).toMatch(/^studio_[a-f0-9]{32}$/);
    expect(f.tables.memberships).toHaveLength(1);
    expect(f.tables.memberships[0]).toMatchObject({
      privySubject: "did:privy:stranger",
      role: "merchant",
      status: "active",
    });
  });

  // The `auth.me` exemption, asserted positively: a signed-in stranger gets
  // their own subject and no studio, which is the whole contract of the query.
  test("auth.me answers with the caller's own identity, never a studio", async () => {
    const f = withRunners(ctxDouble(STRANGER));
    const out = await handlerOf<Record<string, never>, Record<string, unknown>>(
      auth.me,
    )(f.ctx, {});
    expect(out).toEqual({
      subject: "did:privy:stranger",
      email: null,
      walletAddress: null,
      studio: null,
      operator: false,
    });
  });

  test("requireSessionSubject is the shared identity gate", () => {
    expect(() => requireSessionSubject(null)).toThrow(
      "Authenticated session required",
    );
    expect(() =>
      requireSessionSubject({ issuer: "evil", subject: "did:privy:x" }),
    ).toThrow("Authenticated session required");
    expect(requireSessionSubject(BUYER)).toBe("did:privy:buyer");
  });

  // Rate limits: the email-sending paths are the ones worth limiting, and both
  // go through Better Auth's built-in limiter (the magic-link endpoint is what
  // `createQuote` calls). Asserting the configuration is the only offline check
  // available; the limiter itself is Better Auth's, not ours.
  test("the built-in limiter is on and the magic-link path is strictest", async () => {
    const text = await readFile(join(CONVEX_DIR, "auth.ts"), "utf8");
    expect(text).toMatch(/rateLimit:\s*\{[\s\S]*enabled:\s*true/);
    expect(text).toMatch(
      /"\/sign-in\/magic-link":\s*\{\s*window:\s*60,\s*max:\s*3\s*\}/,
    );
  });

  // AUDIT15 A-06: the wallet routes are public and unauthenticated, and each
  // `/wallet/verify` costs a signature check, so they need a cap of their own.
  test("the wallet routes are rate limited too (AUDIT15 A-06)", async () => {
    const text = await readFile(join(CONVEX_DIR, "auth.ts"), "utf8");
    for (const path of ["/wallet/nonce", "/wallet/verify"])
      expect(text).toContain(`"${path}": { window: 60, max: 10 }`);
  });

  test("requireMembership rejects missing/revoked membership", async () => {
    const f = ctxDouble(BUYER);
    await expect(requireMembership(f.ctx, "scope-1")).rejects.toThrow(
      "Active membership required",
    );
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      scopeId: "scope-1",
      accountId: "buyer-1",
      role: "buyer",
      status: "revoked",
    });
    await expect(requireMembership(f.ctx, "scope-1")).rejects.toThrow(
      "Active membership required",
    );
    f.tables.memberships[0].status = "active";
    await expect(requireMembership(f.ctx, "scope-1")).resolves.toMatchObject({
      status: "active",
    });
  });
});

describe("M7 auth inventory — role gates on public mutations", () => {
  test("provisioning.freeze requires the quote buyer membership", async () => {
    const f = ctxDouble(STRANGER);
    const now = Date.now();
    f.tables.approvedQuotes.push({
      _id: "aq",
      id: "quote-1",
      scopeId: "scope-1",
      buyerAccountId: "buyer-1",
      version: 1,
      expiresAt: now + 600_000,
    });
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:stranger",
      scopeId: "scope-1",
      accountId: "stranger-1",
      role: "buyer",
      status: "active",
    });
    await expect(
      handlerOf(provisioning.freeze)(f.ctx, {
        quoteId: "quote-1",
        expectedVersion: 1,
      }),
    ).rejects.toThrow("Quote buyer required");
  });

  test("files.requestUpload requires the order merchant", async () => {
    const f = ctxDouble(BUYER);
    f.tables.orders.push({
      _id: "o1",
      id: "order-1",
      buyerId: "buyer-1",
      merchantId: "merchant-1",
      scopeId: "order-1",
      profile: "image-pack-v1",
      outputCount: 3,
      phase: "ACCEPTED",
      revision: 1,
    });
    f.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      scopeId: "order-1",
      accountId: "buyer-1",
      role: "buyer",
      status: "active",
    });
    await expect(
      handlerOf(files.requestUploadMutation)(f.ctx, { orderId: "order-1" }),
    ).rejects.toThrow("merchant delivery is not permitted");
  });

  test("paymentMonitoring.stop allows consent owner only", async () => {
    const f = ctxDouble(STRANGER);
    f.tables.paymentMonitors.push({
      _id: "mon",
      quoteId: "quote-1",
      consentSubject: "did:privy:buyer",
      state: "waiting",
      paymentIntentId: "pi",
      binding: "b",
      generation: 1,
      attempt: 0,
    });
    await expect(
      handlerOf(paymentMonitoring.stop)(f.ctx, { quoteId: "quote-1" }),
    ).rejects.toThrow("Monitoring consent owner required");
    f.setIdentity(BUYER);
    await expect(
      handlerOf(paymentMonitoring.stop)(f.ctx, { quoteId: "quote-1" }),
    ).resolves.toBeNull();
  });
});

describe("M7 auth inventory — HTTP routes", () => {
  // Every webhook refusal gate (secret, signature, payment mode, body cap,
  // envelope, account, livemode) is asserted with the reconcile call and the
  // isNew flag by `convex/stripeWebhook.scenario.test.ts`, including the C2
  // per-event-type table. This inventory only owes the routing claim.
  test("the webhook is the only route and it authenticates by signature", async () => {
    const text = await readFile(join(CONVEX_DIR, "http.ts"), "utf8");
    expect(text).toContain('path: "/webhooks/stripe"');
    // Fail-closed without a secret: an unconfigured deployment refuses traffic.
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const res = await stripeWebhookHandler(
        {},
        new Request("https://x", { method: "POST", body: "{}" }),
      );
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.STRIPE_WEBHOOK_SECRET = prev;
    }
  });

  test("public-config HTTP surface is GET-only and secret-free", async () => {
    const { publicConfig, publicConfigResponse } = await import(
      "../src/public-config"
    );
    const config = publicConfig({
      BETTER_AUTH_URL: "https://auth.example.com",
      PRIVY_APP_SECRET: "super-secret",
      STRIPE_SECRET_KEY: "sk_test_secret",
    });
    const res = publicConfigResponse(
      new Request("https://x/api/public-config"),
      { ...config, secret: "leak" } as never,
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("super-secret");
    expect(body).not.toContain("sk_test_secret");
    expect(body).not.toContain("leak");
    const post = publicConfigResponse(
      new Request("https://x/api/public-config", { method: "POST" }),
      config,
    );
    expect(post.status).toBe(405);
  });
});

/**
 * R14 — a handler's output must satisfy its own `returns` validator. This is
 * the class of bug that shipped: `_handler` tests bypass the validator, so a
 * handler returning a superset of it passed every unit test and failed live
 * with `ReturnsValidationError: Object contains extra field inviteToken`.
 *
 * Only functions that can be driven to a *successful* result belong here: a
 * throw never reaches the validator, so a row that refuses proves nothing. The
 * quote path is covered end-to-end in `trusted-provisioning.test.ts`.
 */
describe("R14 returns validators accept what the handlers return", () => {
  const draft = {
    _id: "qd",
    id: "quote-1",
    scopeId: "scope-1",
    title: "Three hero images",
    brief: "A short brief.",
    amountUsd: 900,
    studioName: "North Studio",
    network: "preprod",
    orderNonce: "a".repeat(64),
    inviteToken: "t".repeat(32),
    acceptedAt: null,
  };

  test("orders.invite output satisfies its returns validator", async () => {
    const f = ctxDouble(BUYER);
    f.tables.quoteDrafts = [draft];
    const out = await handlerOf(orders.invite)(f.ctx, {
      quoteId: "quote-1",
      token: "t".repeat(32),
    });
    checkReturns(orders.invite, out);
  });

  test("trustedProvisioning.acceptInvite output satisfies its returns validator", async () => {
    const f = ctxDouble(BUYER);
    const out = await handlerOf(trustedProvisioning.acceptInvite)(f.ctx, {
      quoteId: "quote-1",
      token: "t".repeat(32),
      buyerCommitment: "b".repeat(64),
    });
    checkReturns(trustedProvisioning.acceptInvite, out);
  });

  // The checker itself must reject the shape that broke production, so a future
  // widening of a validator cannot silently make this suite vacuous.
  test("the checker rejects the pre-fix spread shape", () => {
    expect(() =>
      checkReturns(stripeProvisioning.createQuote, {
        quoteId: "q",
        inviteUrl: "u",
        inviteToken: "t",
        emailed: false,
      }),
    ).toThrow("extra field inviteToken");
    // A nested extra field is caught too, not just the top level.
    expect(() =>
      checkReturns(
        {
          exportReturns: () =>
            JSON.stringify({
              type: "object",
              value: {
                a: {
                  fieldType: {
                    type: "object",
                    value: { b: { fieldType: { type: "string" } } },
                  },
                },
              },
            }),
        },
        { a: { b: "x", c: "y" } },
      ),
    ).toThrow("extra field c");
  });
});

describe("M7 auth inventory — completeness vs source exports", () => {
  test("every public queryGeneric/mutationGeneric/actionGeneric/httpActionGeneric is inventoried", async () => {
    const found = await scanPublicExports();
    const inventory = new Set(PUBLIC_QUERY_MUTATION.map((row) => row.name));
    const missing = [...found.keys()].filter(
      (key) =>
        !inventory.has(EXPORT_ALIAS[key] ?? key) &&
        !EXPORT_EXEMPT.has(key) &&
        !key.startsWith("http."),
    );
    expect(missing).toEqual([]);
    // Every alias target is a row in the table, so a rename cannot orphan one.
    for (const target of Object.values(EXPORT_ALIAS)) {
      expect(inventory.has(target)).toBe(true);
    }
  });

  test("admission.bind rejects anonymous callers through admitCanonical", async () => {
    const { admitCanonical } = await import("../src/convex-admission");
    const f = ctxDouble(ANON);
    await expect(
      admitCanonical(f.ctx, {
        quoteId: "q",
        observationId: "o",
        authorizationId: "a",
        expectedQuoteVersion: 1,
        address: "addr",
        network: "preprod",
      } as never),
    ).rejects.toThrow("Authenticated session required");
  });

  test("HTTP route table declares only the authenticated stripe webhook", async () => {
    const text = await readFile(join(CONVEX_DIR, "http.ts"), "utf8");
    expect(text).toContain('path: "/webhooks/stripe"');
    // The debug HMAC oracles and the unwired file transport are removed, not
    // merely gated: a route that cannot authenticate its caller must not exist.
    for (const path of ["/files", "/debug-hmac", "/debug-verify"]) {
      expect(text).not.toContain(`path: "${path}"`);
    }
  });

  test("the debug oracles and unwired file transport are gone, not gated", async () => {
    const mod = (await import("../../../convex/http")) as Record<
      string,
      unknown
    >;
    // No exported handler remains for either removed surface.
    expect("filesGet" in mod).toBe(false);
    expect("filesGetHandler" in mod).toBe(false);
    const text = await readFile(join(CONVEX_DIR, "http.ts"), "utf8");
    // The test-only runner global the /files route depended on is gone too.
    expect(text).not.toContain("__miloRunQuery");
    expect(text).not.toContain("debug-hmac");
    expect(text).not.toContain("debug-verify");
  });
});

/**
 * ROUND17 (c) — the authorization matrix.
 *
 * Every public Convex function crossed with every actor, each cell pinning the
 * exact outcome. The rows are checked against the inventory table, which the
 * completeness test above checks against the source registry, so a new public
 * function with no row fails this suite rather than shipping unaudited.
 *
 * The expected outcome is one of:
 *   "deny"  — throws, or returns null / [] / {ok:false} / {state:"failed"}
 *   "allow" — returns real data or a successful result
 *   "self"  — succeeds, but only ever with the caller's own record
 *
 * One fixture serves every row, so "deny" means one of two things and the row
 * comment says which: the function refused this actor (the interesting case), or
 * the fixture has no data for the positive path (a provider key, a frozen quote,
 * an order). Rows of the second kind name the suite that covers their positive
 * path in REPORT17; what this table pins is that the refusal is uniform, so a
 * change that lets one actor through flips exactly one cell.
 */
type Outcome = "deny" | "allow" | "self";

type Actor =
  | "anonymous"
  | "stranger"
  | "buyer"
  | "merchant"
  | "operator"
  | "revoked";

const ACTORS: Actor[] = [
  "anonymous",
  "stranger",
  "buyer",
  "merchant",
  "operator",
  "revoked",
];

/** The same outcome for every actor, so a uniform row is one line. */
const every = (outcome: Outcome): Record<Actor, Outcome> =>
  Object.fromEntries(ACTORS.map((actor) => [actor, outcome])) as Record<
    Actor,
    Outcome
  >;

const identityFor = (actor: Actor): Identity =>
  actor === "anonymous"
    ? null
    : { issuer: "privy.io", subject: `did:privy:${actor}` };

/**
 * The membership each actor holds in `scope-1`, if any. An operator holds none:
 * operator rights come from the email allowlist, not from a studio row, so
 * giving them a merchant row here would let the matrix pass for the wrong
 * reason — `writeQuoteDraft` would succeed as "operator" through the merchant
 * gate, and the row would stop testing what it claims to.
 */
const membershipFor = (actor: Actor): Row | null => {
  if (actor === "anonymous" || actor === "stranger" || actor === "operator")
    return null;
  return {
    _id: `m-${actor}`,
    privySubject: `did:privy:${actor}`,
    scopeId: "scope-1",
    accountId: `${actor}-1`,
    role: actor === "merchant" ? "merchant" : "buyer",
    status: actor === "revoked" ? "revoked" : "active",
    studioName: "North Studio",
  };
};

/** A draft owned by the merchant and not yet claimed, so the buyer path is a
 * membership decision rather than an ownership one. */
const seedMatrixDraft = (tables: Record<string, Row[]>) => {
  tables.quoteDrafts = [
    {
      _id: "d1",
      id: "quote-1",
      scopeId: "scope-1",
      studioName: "North Studio",
      merchantSubject: "did:privy:merchant",
      merchantAccountId: "merchant-1",
      title: "Three hero images",
      brief: "A short brief for the fixed-price image pack.",
      clientEmail: "buyer@example.com",
      amountUsd: 900,
      amountMinor: 90_000,
      currency: "USD",
      orderNonce: "a".repeat(64),
      merchantCommitment: "b".repeat(64),
      termsCommitment: "d".repeat(64),
      terms: {
        unitPrice: "90000",
        total: "90000",
        scopeDigest: "e".repeat(64),
        rightsDigest: "f".repeat(64),
        paymentPolicy: "1".repeat(64),
        salt: "2".repeat(64),
      },
      inviteToken: "a1".repeat(32),
      createdAt: 1,
      updatedAt: 2,
    },
  ];
};

const matrixCtx = (actor: Actor) => {
  const tables = emptyTables();
  const membership = membershipFor(actor);
  if (membership) tables.memberships.push(membership);
  seedMatrixDraft(tables);
  // The auth component's client API runs a query, and the actions run their own.
  return withRunners(ctxDouble(identityFor(actor), tables));
};

/** What each public function must do for each actor. */
const MATRIX: Record<string, Record<Actor, Outcome>> = {
  // No approved quote in the fixture, so every actor stops at the same gate.
  "provisioning.freeze": every("deny"),
  // Monitor rows are created by `holdPayment`, which needs a provider key;
  // `paymentMonitoring.test.ts` covers the positive paths.
  "paymentMonitoring.status": every("deny"),
  "paymentMonitoring.start": every("deny"),
  "paymentMonitoring.stop": every("deny"),
  // No order, grant or delivery row in the fixture.
  "files.requestUpload": every("deny"),
  "files.attachUpload": every("deny"),
  "files.freeze": every("deny"),
  // Membership in the quote's scope is the gate, and this is one of the two rows
  // where the fixture discriminates: an active member reads, a revoked one and a
  // non-member do not.
  "orders.order": { ...every("deny"), buyer: "allow", merchant: "allow" },
  // Ownership is the gate here, not membership: the draft is the merchant's and
  // is unclaimed, so only the merchant lists it. Same actor, different answer
  // from `orders.order` above — which is the point of pinning both.
  "orders.list": { ...every("deny"), merchant: "allow" },
  // The token in `invoke` is not the draft's token, and a wrong token must be
  // indistinguishable from a missing quote.
  "orders.invite": every("deny"),
  // Creating a studio is what a signed-in stranger legitimately does, and it
  // only ever creates the caller's own.
  "trustedProvisioning.createStudio": { ...every("self"), anonymous: "deny" },
  // The merchant gate: the operator holds no studio row, so it refuses them too.
  "trustedProvisioning.writeQuoteDraft": every("deny"),
  "trustedProvisioning.acceptInvite": every("deny"),
  // Answers the caller's own identity; never another's.
  "auth.me": { ...every("self"), anonymous: "deny" },
  // Needs MILO_OPERATOR_SECRET, which this suite does not set, so every actor
  // stops at the same provider gate. `trusted-provisioning.test.ts` sets it.
  "stripeProvisioning.createQuote": every("deny"),
  // The draft has no buyer commitment, so the action refuses before any write.
  "stripeProvisioning.holdPayment": every("deny"),
  "stripeProvisioning.createStudioAndQuote": every("deny"),
  // Refuses without the operator allowlist, and the fixture sets none.
  "stripeProvisioning.operatorSecret": every("deny"),
  // The indexer is never reached: no chain row exists for the quote. The real
  // gate (participant, or operator on a DISPUTED order) is the table in
  // `convex/refreshOrder.authz.test.ts`.
  "chainObserver.refreshOrder": every("deny"),
  // No frozen quote or deployment in the fixture.
  "stripeProvisioning.attachContract": every("deny"),
  "files.serveFile": every("deny"),
};

/** The invocation per function, so the matrix does not restate arguments. */
const invokeFor: Record<string, (ctx: never) => Promise<unknown>> =
  Object.fromEntries(
    PUBLIC_QUERY_MUTATION.map((row) => [row.name, row.invoke]),
  );

/**
 * `state: "failed"` is a refusal too: the actions that report an outcome as
 * `{state, reason}` say "no" that way rather than by throwing. An object whose
 * every field is null is the third shape — `refreshOrder` answers "I read
 * nothing" as `{phase: null, revision: null}`.
 */
const outcomeOf = async (
  invoke: (ctx: never) => Promise<unknown>,
  ctx: never,
): Promise<"deny" | "allow"> => {
  let out: unknown;
  try {
    out = await invoke(ctx);
  } catch {
    return "deny";
  }
  if (out === null || (Array.isArray(out) && out.length === 0)) return "deny";
  if (typeof out !== "object") return "allow";
  const fields = Object.values(out as Record<string, unknown>);
  const refusal = out as { ok?: boolean; state?: string };
  return refusal.ok === false ||
    refusal.state === "failed" ||
    fields.every((value) => value === null)
    ? "deny"
    : "allow";
};

describe("ROUND17 (c) authorization matrix: every public function x every actor", () => {
  const rows = Object.entries(MATRIX).flatMap(([name, byActor]) =>
    ACTORS.map((actor) => [name, actor, byActor[actor]] as const),
  );

  test.each(rows)("%s as %s", async (name, actor, expected) => {
    const invoke = invokeFor[name];
    expect(invoke).toBeDefined();
    const got = await outcomeOf(invoke, matrixCtx(actor).ctx);
    // "self" is a success: the call works, and only for the caller's own record.
    const want = expected === "self" ? "allow" : expected;
    expect({ name, actor, got }).toEqual({ name, actor, got: want });
  });

  // The registry is the source, in two mechanical steps: a new public export
  // fails the completeness test above until it has an inventory row, and fails
  // here until it has a matrix row. Neither list is maintained by hand against
  // the source.
  test("every public export has a matrix row", async () => {
    const found = await scanPublicExports();
    const missing = [...found.keys()]
      .map((key) => EXPORT_ALIAS[key] ?? key)
      .filter((key) => !key.startsWith("http.") && !EXPORT_EXEMPT.has(key))
      .filter((key) => !(key in MATRIX));
    expect(missing).toEqual([]);
  });

  // And the other direction: a row for a function that no longer exists, or an
  // inventory row with no matrix row, fails here.
  test("the matrix covers exactly the inventoried surface", () => {
    expect(Object.keys(MATRIX).sort()).toEqual(
      PUBLIC_QUERY_MUTATION.map((row) => row.name).sort(),
    );
  });
});
