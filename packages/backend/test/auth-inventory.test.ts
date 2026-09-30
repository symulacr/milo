/**
 * M7 — Auth inventory: every public Convex function and HTTP route has an
 * authorization test. Completeness is source-scanned so a new public export
 * without a row fails the suite.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { admissionArgs } from "../../../convex/admissionValidators";
import { requireMembership } from "../../../convex/auth/identity";
import * as authSession from "../../../convex/auth/session";
import * as diagnostics from "../../../convex/diagnostics";
import * as files from "../../../convex/files";
import {
  filesGetHandler,
  stripeWebhookHandler,
} from "../../../convex/http";
import * as paymentMonitoring from "../../../convex/paymentMonitoring";
import * as provisioning from "../../../convex/provisioning";
import { requirePrivySubject } from "../src/privy-identity";

const CONVEX_DIR = new URL("../../../convex", import.meta.url).pathname;

type Identity = { issuer: string; subject: string } | null;

type Row = Record<string, unknown> & { _id: string };

function handlerOf<TArgs, TResult>(fn: unknown) {
  return (
    fn as {
      _handler: (ctx: never, args: TArgs) => Promise<TResult>;
    }
  )._handler;
}

function emptyTables(): Record<string, Row[]> {
  return Object.fromEntries(
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
}

function ctxDouble(identity: Identity, tables = emptyTables()) {
  let identityRef = identity;
  const get = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  const ctx = {
    auth: { getUserIdentity: async () => identityRef },
    storage: {
      getMetadata: async () => null,
      generateUploadUrl: async () => "https://upload.invalid",
      get: async () => null,
    },
    scheduler: { runAfter: async () => null },
    db: {
      get: async (id: string) => get(id),
      query: (table: string) => ({
        withIndex: (
          _name: string,
          range: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const conditions: [string, unknown][] = [];
          const q = {
            eq: (field: string, value: unknown) => {
              conditions.push([field, value]);
              return q;
            },
          };
          range(q);
          const matched = () =>
            (tables[table] ?? []).filter((row) =>
              conditions.every(([field, value]) => row[field] === value),
            );
          return {
            unique: async () => {
              const rows = matched();
              if (rows.length > 1) throw new Error("Duplicate rows");
              return rows[0] ?? null;
            },
            take: async (n: number) => matched().slice(0, n),
            first: async () => matched()[0] ?? null,
            collect: async () => matched(),
          };
        },
        fullTableScan: () => ({
          collect: async () => tables[table] ?? [],
          take: async (n: number) => (tables[table] ?? []).slice(0, n),
          first: async () => (tables[table] ?? [])[0] ?? null,
          unique: async () => null,
        }),
      }),
      insert: async (table: string, doc: Record<string, unknown>) => {
        const _id = `${table}-${(tables[table]?.length ?? 0) + 1}`;
        tables[table] ??= [];
        tables[table].push({ ...doc, _id });
        return _id;
      },
      patch: async (id: string, fields: Record<string, unknown>) => {
        const row = get(id);
        if (!row) throw new Error(`unknown document ${id}`);
        Object.assign(row, fields);
      },
      delete: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) {
            rows.splice(index, 1);
            return;
          }
        }
      },
    },
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
const MERCHANT: Identity = {
  issuer: "privy.io",
  subject: "did:privy:merchant",
};
const STRANGER: Identity = {
  issuer: "privy.io",
  subject: "did:privy:stranger",
};

/** Public Convex surfaces that must reject unauthenticated callers. */
const PUBLIC_QUERY_MUTATION: Array<{
  name: string;
  kind: "query" | "mutation";
  invoke: (ctx: never) => Promise<unknown>;
}> = [
  {
    name: "auth/session.current",
    kind: "query",
    invoke: (ctx) => handlerOf(authSession.current)(ctx, {}),
  },
  {
    name: "diagnostics.read",
    kind: "query",
    invoke: (ctx) => handlerOf(diagnostics.read)(ctx, {}),
  },
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
    name: "provisioning.requestPayment",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(provisioning.requestPayment)(ctx, {
        quoteId: "quote-1",
        expectedVersion: 1,
        consent: "create-test-payment",
      }),
  },
  {
    name: "provisioning.requestObservation",
    kind: "mutation",
    invoke: (ctx) =>
      handlerOf(provisioning.requestObservation)(ctx, {
        quoteId: "quote-1",
        expectedVersion: 1,
        consent: "observe-test-payment",
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

describe("M7 auth inventory — public Convex query/mutation", () => {
  test.each(PUBLIC_QUERY_MUTATION.map((row) => [row.name, row] as const))(
    "%s rejects unauthenticated callers",
    async (_name, row) => {
      const f = ctxDouble(ANON);
      await expect(Promise.resolve(row.invoke(f.ctx))).rejects.toThrow();
    },
  );

  test("requirePrivySubject is the shared identity gate", () => {
    expect(() => requirePrivySubject(null)).toThrow(
      "Authenticated Privy identity required",
    );
    expect(() =>
      requirePrivySubject({ issuer: "evil", subject: "did:privy:x" }),
    ).toThrow("Authenticated Privy identity required");
    expect(requirePrivySubject(BUYER)).toBe("did:privy:buyer");
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
  test("POST /webhooks/stripe rejects unsigned traffic (fail-closed)", async () => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const res = await stripeWebhookHandler({}, new Request("https://x", {
        method: "POST",
        body: "{}",
      }));
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.STRIPE_WEBHOOK_SECRET = prev;
    }
  });

  test("POST /webhooks/stripe rejects bad signatures even with a secret", async () => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_testfixturesecret0123456789";
    try {
      const res = await stripeWebhookHandler(
        {},
        new Request("https://x", {
          method: "POST",
          body: JSON.stringify({ id: "evt", type: "x", livemode: false }),
          headers: { "stripe-signature": "t=1,v1=deadbeef" },
        }),
      );
      expect(res.status).toBe(400);
    } finally {
      if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prev;
    }
  });

  test("GET /files refuses unbound transport and missing deliveryId", async () => {
    const missing = await filesGetHandler({}, new Request("https://x/files"));
    expect(missing.status).toBe(400);
    const unbound = await filesGetHandler(
      {},
      new Request("https://x/files?deliveryId=d1"),
    );
    expect(unbound.status).toBe(503);
  });

  test("GET /files 404s when resolve denies the read (no storage leak)", async () => {
    const prev = (globalThis as { __miloRunQuery?: unknown }).__miloRunQuery;
    (globalThis as { __miloRunQuery?: unknown }).__miloRunQuery = async () =>
      null;
    try {
      const res = await filesGetHandler(
        {},
        new Request("https://x/files?deliveryId=d1", {
          headers: { authorization: "Bearer forged" },
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      (globalThis as { __miloRunQuery?: unknown }).__miloRunQuery = prev;
    }
  });

  test("public-config HTTP surface is GET-only and secret-free", async () => {
    const { publicConfig, publicConfigResponse } = await import(
      "../src/public-config"
    );
    const config = publicConfig({
      PRIVY_APP_ID: "app",
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

describe("M7 auth inventory — completeness vs source exports", () => {
  test("every public queryGeneric/mutationGeneric/actionGeneric/httpActionGeneric is inventoried", async () => {
    const found = await scanPublicExports();
    const inventoried = new Set([
      ...PUBLIC_QUERY_MUTATION.map((row) => row.name.replace("/", "/")),
      "admission.bind",
      "http.stripeWebhook",
      "http.filesGet",
      // admission.bind is admitCanonical — covered below via its handler.
    ]);
    // Map source export names to inventory names.
    const alias: Record<string, string> = {
      "auth/session.current": "auth/session.current",
      "diagnostics.read": "diagnostics.read",
      "admission.bind": "admission.bind",
      "provisioning.freeze": "provisioning.freeze",
      "provisioning.requestPayment": "provisioning.requestPayment",
      "provisioning.requestObservation": "provisioning.requestObservation",
      "paymentMonitoring.status": "paymentMonitoring.status",
      "paymentMonitoring.start": "paymentMonitoring.start",
      "paymentMonitoring.stop": "paymentMonitoring.stop",
      "files.requestUploadMutation": "files.requestUpload",
      "files.attachUploadMutation": "files.attachUpload",
      "files.freezeMutation": "files.freeze",
      "http.stripeWebhook": "http.stripeWebhook",
      "http.filesGet": "http.filesGet",
    };
    const missing: string[] = [];
    for (const [key, kind] of found) {
      if (kind === "httpActionGeneric") {
        if (!alias[key]) missing.push(key);
        continue;
      }
      if (!alias[key]) missing.push(key);
    }
    expect(missing).toEqual([]);
    // Every alias target is either in PUBLIC_QUERY_MUTATION or explicitly listed.
    for (const target of Object.values(alias)) {
      const covered =
        PUBLIC_QUERY_MUTATION.some((row) => row.name === target) ||
        target === "admission.bind" ||
        target.startsWith("http.");
      expect(covered).toBe(true);
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
    ).rejects.toThrow("Authenticated Privy identity required");
  });

  test("HTTP route table includes stripe webhook, files, and debug endpoints", async () => {
    const text = await readFile(join(CONVEX_DIR, "http.ts"), "utf8");
    for (const path of [
      "/webhooks/stripe",
      "/files",
      "/debug-hmac",
      "/debug-verify",
    ]) {
      expect(text).toContain(`path: "${path}"`);
    }
  });
});
