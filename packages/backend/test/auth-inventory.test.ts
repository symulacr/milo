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
import httpRouterDefault, { stripeWebhookHandler } from "../../../convex/http";
import * as orders from "../../../convex/orders";
import * as paymentMonitoring from "../../../convex/paymentMonitoring";
import * as provisioning from "../../../convex/provisioning";
import { deliveryCommitment } from "../src/delivery-policy";
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
      "chainOrders",
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
            lt: (field: string, value: unknown) => unknown;
            lte: (field: string, value: unknown) => unknown;
            gt: (field: string, value: unknown) => unknown;
            gte: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const conditions: [string, unknown][] = [];
          const bounds: [string, "lt" | "lte" | "gt" | "gte", unknown][] = [];
          const q = {
            eq: (field: string, value: unknown) => {
              conditions.push([field, value]);
              return q;
            },
            lt: (field: string, value: unknown) => {
              bounds.push([field, "lt", value]);
              return q;
            },
            lte: (field: string, value: unknown) => {
              bounds.push([field, "lte", value]);
              return q;
            },
            gt: (field: string, value: unknown) => {
              bounds.push([field, "gt", value]);
              return q;
            },
            gte: (field: string, value: unknown) => {
              bounds.push([field, "gte", value]);
              return q;
            },
          };
          range(q);
          const matched = () =>
            (tables[table] ?? []).filter(
              (row) =>
                conditions.every(([field, value]) => row[field] === value) &&
                bounds.every(([field, op, value]) => {
                  const actual = Number(row[field]);
                  const bound = Number(value);
                  if (op === "lt") return actual < bound;
                  if (op === "lte") return actual <= bound;
                  if (op === "gt") return actual > bound;
                  return actual >= bound;
                }),
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
      const res = await stripeWebhookHandler(
        {},
        new Request("https://x", {
          method: "POST",
          body: "{}",
        }),
      );
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

  test("GET /files is not routed; the private-file transport is not built", async () => {
    expect(httpRouterDefault.lookup("/files", "GET")).toBeNull();
    expect(httpRouterDefault.lookup("/files", "HEAD")).toBeNull();
    const text = await readFile(join(CONVEX_DIR, "http.ts"), "utf8");
    expect(text).not.toContain('path: "/files"');
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
      // Membership-gated chain-projection read (Q1/Q2); never a write.
      "orders.read": "orders.read",
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
        target === "orders.read" ||
        target.startsWith("http.");
      expect(covered).toBe(true);
    }
  });

  test("admission.bind rejects anonymous callers through admitCanonical", async () => {
    const { admitCanonical } = await import(
      "../../../convex/canonicalAdmission"
    );
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

  test("HTTP route table is the stripe webhook only, and no debug endpoints", async () => {
    const text = await readFile(join(CONVEX_DIR, "http.ts"), "utf8");
    expect(text).toContain('path: "/webhooks/stripe"');
    // R-M7-01: /debug-verify returned 12 hex chars of an HMAC computed with the
    // deployment's real STRIPE_WEBHOOK_SECRET over a caller-chosen payload.
    // Assert absence here so a re-added debug route fails the suite.
    for (const path of ["/debug-hmac", "/debug-verify"]) {
      expect(text).not.toContain(`path: "${path}"`);
    }
    expect(httpRouterDefault.getRoutes().map(([path]) => path)).toEqual([
      "/webhooks/stripe",
    ]);
  });

  test("every Convex function reference resolves to a registered function", async () => {
    // Convex registers module:NAME only for `export const NAME = <kind>Generic`.
    // A default-export OBJECT (convex/files.ts) registers nothing under its
    // keys, so a reference written against such a key is dangling.
    const entries = await readdir(CONVEX_DIR, { withFileTypes: true });
    const names = new Set<string>();
    const refs: { ref: string; site: string }[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const text = await readFile(join(CONVEX_DIR, entry.name), "utf8");
      const moduleName = entry.name.replace(/\.ts$/, "");
      for (const m of text.matchAll(/export const (\w+) = \w+Generic\(/g))
        names.add(`${moduleName}:${m[1]}`);
      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(
          /"([a-zA-Z][\w]*(?:\/[\w]+)?):([a-zA-Z]\w*)"/g,
        ))
          refs.push({ ref: m[0].slice(1, -1), site: `${entry.name}:${i + 1}` });
      });
    }
    expect(names.size).toBeGreaterThan(0);
    expect(refs.length).toBeGreaterThan(0);
    const dangling = refs.filter((r) => !names.has(r.ref));
    expect(
      dangling,
      `dangling Convex function references: ${dangling
        .map((d) => `${d.ref} at ${d.site}`)
        .join(", ")}`,
    ).toEqual([]);
  });
});

const READ_DIGESTS = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];

function readDouble(options: {
  identity?: Identity;
  membershipStatus?: "active" | "revoked";
  accountId?: string;
  orderPhase?: "ACCEPTED" | "SUBMITTED" | "DISPUTED" | "TERMINAL";
  manifest?: string | null;
  observed?: boolean;
  fileCount?: number;
}) {
  const f = ctxDouble(
    options.identity === undefined ? BUYER : options.identity,
  );
  f.tables.orders.push({
    _id: "o1",
    id: "order-1",
    buyerId: "buyer-1",
    merchantId: "merchant-1",
    disputeOperatorId: "operator-1",
    scopeId: "order-1",
    profile: "image-pack-v1",
    outputCount: 3,
    phase: options.orderPhase ?? "SUBMITTED",
    revision: 1,
  });
  f.tables.memberships.push({
    _id: "m1",
    privySubject: "did:privy:buyer",
    scopeId: "order-1",
    accountId: options.accountId ?? "buyer-1",
    role: "buyer",
    status: options.membershipStatus ?? "active",
  });
  const files = READ_DIGESTS.slice(0, options.fileCount ?? 3).map(
    (sha256, index) => ({
      grantId: `grant-${index}`,
      storageId: `blob-${index}`,
      sha256,
      contentType: "image/png" as const,
      byteLength: 32,
    }),
  );
  f.tables.deliveries.push({
    _id: "d1",
    orderId: "order-1",
    merchantId: "merchant-1",
    revision: 1,
    files,
  });
  if (options.observed !== false) {
    f.tables.chainOrders.push({
      _id: "c1",
      orderId: "order-1",
      deliveryManifest:
        "manifest" in options
          ? options.manifest
          : files.length === 3
            ? deliveryCommitment(files)
            : "e".repeat(64),
    });
  }
  return f;
}

describe("DEAD-14 private read derives identity from ctx.auth", () => {
  const READ = { orderId: "order-1", fileIndex: 1 };

  test("allowed: the buyer reads a file the chain observation confirms", async () => {
    const f = readDouble({});
    const descriptor = await files.resolveRead(f.ctx, READ);
    expect(descriptor).toMatchObject({
      grantId: "grant-1",
      storageId: "blob-1",
      sha256: READ_DIGESTS[1],
    });
  });

  test("allowed: the merchant reads without a confirmed observation", async () => {
    const f = readDouble({ accountId: "merchant-1", observed: false });
    const descriptor = await files.resolveRead(f.ctx, {
      orderId: "order-1",
      fileIndex: 0,
    });
    expect(descriptor.storageId).toBe("blob-0");
  });

  test("allowed: the dispute operator reads once the order is DISPUTED", async () => {
    const f = readDouble({ accountId: "operator-1", orderPhase: "DISPUTED" });
    const descriptor = await files.resolveRead(f.ctx, {
      orderId: "order-1",
      fileIndex: 2,
    });
    expect(descriptor.storageId).toBe("blob-2");
  });

  test("denied: an unauthenticated caller", async () => {
    const f = readDouble({ identity: ANON });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "Authenticated Privy identity required",
    );
  });

  test("denied: a revoked membership", async () => {
    const f = readDouble({ membershipStatus: "revoked" });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "Active membership required",
    );
  });

  test("denied: an active member who is not a party to the order", async () => {
    const f = readDouble({ accountId: "stranger-1" });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "delivery access is not permitted",
    );
  });

  test("denied: the dispute operator before the order is DISPUTED", async () => {
    const f = readDouble({ accountId: "operator-1", orderPhase: "SUBMITTED" });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "delivery access is not permitted",
    );
  });

  test("denied: the buyer when the observed manifest differs from the frozen one", async () => {
    const f = readDouble({ manifest: "d".repeat(64) });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "delivery is not bound to the confirmed chain submission",
    );
  });

  test("denied: the buyer when no chain observation exists", async () => {
    const f = readDouble({ observed: false });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "delivery is not bound to the confirmed chain submission",
    );
  });

  test("denied: a frozen delivery that is not exactly three files", async () => {
    const f = readDouble({ fileCount: 2, accountId: "merchant-1" });
    await expect(files.resolveRead(f.ctx, READ)).rejects.toThrow(
      "delivery is unavailable",
    );
  });

  test("denied: an out-of-range fileIndex", async () => {
    const f = readDouble({});
    await expect(
      files.resolveRead(f.ctx, { orderId: "order-1", fileIndex: 3 }),
    ).rejects.toThrow();
  });

  test("denied: identity is not selectable by the caller", async () => {
    // The pre-fix signature took {accountId, confirmed}. Passing a foreign
    // accountId and confirmed:true must no longer widen access.
    const supplied = { ...READ, accountId: "buyer-1", confirmed: true };
    const outsider = readDouble({ accountId: "stranger-1" });
    await expect(files.resolveRead(outsider.ctx, supplied)).rejects.toThrow(
      "delivery access is not permitted",
    );
    const unconfirmed = readDouble({});
    unconfirmed.setIdentity({
      issuer: "privy.io",
      subject: "did:privy:stranger",
    });
    await expect(files.resolveRead(unconfirmed.ctx, supplied)).rejects.toThrow(
      "Active membership required",
    );
  });

  test("serveFile: the unauthorized reader gets no bytes", async () => {
    const f = readDouble({ accountId: "stranger-1" });
    await expect(files.serveFile(f.ctx as never, READ)).rejects.toThrow(
      "delivery access is not permitted",
    );
  });
});

function orderDouble(options: {
  identity?: Identity;
  membershipStatus?: "active" | "revoked";
  approved?: boolean;
  chainOrder?: boolean;
  subject?: string;
  observedAt?: number | null;
}) {
  const f = ctxDouble(
    options.identity === undefined
      ? { issuer: "privy.io", subject: options.subject ?? "did:privy:buyer" }
      : options.identity,
  );
  if (options.approved !== false) {
    f.tables.approvedQuotes.push({
      _id: "aq",
      id: "quote-1",
      scopeId: "scope-1",
      buyerAccountId: "buyer-1",
      version: 1,
      expiresAt: Date.now() + 600_000,
    });
  }
  if (options.chainOrder !== false) {
    f.tables.chainOrders.push({
      _id: "c1",
      orderId: "order-1",
      quoteId: "quote-1",
      network: "preprod",
      address: "mn_addr_preprod1example",
      nonce: "n1",
      artifactFingerprint: "fp",
      phase: "SUBMITTED",
      revision: 3,
      deliveryManifest: "f".repeat(64),
      terminal: false,
      merchantActive: true,
      observedAt: options.observedAt ?? Date.now(),
    });
    f.tables.deliveries.push({
      _id: "d1",
      orderId: "order-1",
      files: [{}, {}, {}],
    });
  }
  f.tables.memberships.push({
    _id: "m1",
    privySubject: options.subject ?? "did:privy:buyer",
    scopeId: "scope-1",
    accountId: "buyer-1",
    role: "buyer",
    status: options.membershipStatus ?? "active",
  });
  return f;
}

const READ_ORDER = { quoteId: "quote-1" };

describe("DECISION Q1/Q2: orders:read is membership-gated", () => {
  test("denied: an anonymous caller", async () => {
    const f = orderDouble({ identity: ANON });
    await expect(handlerOf(orders.read)(f.ctx, READ_ORDER)).rejects.toThrow(
      "Authenticated Privy identity required",
    );
  });

  test("denied: a non-Privy issuer", async () => {
    const f = orderDouble({
      identity: { issuer: "evil.example", subject: "did:privy:buyer" },
    });
    await expect(handlerOf(orders.read)(f.ctx, READ_ORDER)).rejects.toThrow(
      "Authenticated Privy identity required",
    );
  });

  test("denied: an authenticated subject with no membership in the quote scope", async () => {
    const f = orderDouble({ subject: "did:privy:stranger" });
    f.tables.memberships[0].privySubject = "did:privy:buyer";
    await expect(handlerOf(orders.read)(f.ctx, READ_ORDER)).rejects.toThrow(
      "Active membership required",
    );
  });

  test("denied: a revoked membership", async () => {
    const f = orderDouble({ membershipStatus: "revoked" });
    await expect(handlerOf(orders.read)(f.ctx, READ_ORDER)).rejects.toThrow(
      "Active membership required",
    );
  });

  test("allowed: an active member reads the full projection", async () => {
    const f = orderDouble({});
    const record = await handlerOf(orders.read)(f.ctx, READ_ORDER);
    expect(record).toMatchObject({
      orderId: "order-1",
      network: "preprod",
      address: "mn_addr_preprod1example",
      phase: "SUBMITTED",
      revision: 3,
      fileCount: 3,
    });
    expect(record).toHaveProperty("deliveryManifest");
    expect(record).toHaveProperty("observedAt");
    expect(record).toHaveProperty("fresh");
  });

  test("allowed: a blank quoteId is null without touching the tables", async () => {
    const f = orderDouble({});
    expect(await handlerOf(orders.read)(f.ctx, { quoteId: "   " })).toBeNull();
  });

  test("allowed: an approved quote with no chain order is null, not an error", async () => {
    const f = orderDouble({ chainOrder: false });
    expect(await handlerOf(orders.read)(f.ctx, READ_ORDER)).toBeNull();
  });

  test("denied: fileCount is not reachable without membership, so Q2 is answered by the gate", async () => {
    // fileCount is derived from deliveries/fileGrants rows. With the gate in
    // place an anonymous caller never reaches the count, so the disclosure
    // question is answered by denial rather than by narrowing the return.
    const anon = orderDouble({ identity: ANON });
    await expect(
      handlerOf(orders.read)(anon.ctx, READ_ORDER),
    ).rejects.toThrow();
    const member = orderDouble({});
    const record = await handlerOf(orders.read)(member.ctx, READ_ORDER);
    expect(typeof (record as { fileCount: number }).fileCount).toBe("number");
  });

  test("sibling public queries keep their behaviour", async () => {
    // diagnostics:read still returns its redacted shape for a member.
    const diag = ctxDouble(BUYER);
    diag.tables.paymentInbox.push({
      _id: "i1",
      provider: "stripe",
      accountId: "did:privy:buyer",
      eventId: "evt_1",
      eventType: "charge",
      digest: "d",
      paymentIntentRef: null,
      receivedAt: 1,
    });
    const diagResult = await handlerOf(diagnostics.read)(diag.ctx, {});
    expect(diagResult).toMatchObject({ subjectBound: true });
    await expect(
      handlerOf(diagnostics.read)(ctxDouble(ANON).ctx, {}),
    ).rejects.toThrow();

    // session:current still echoes the Privy subject.
    expect(
      await handlerOf(authSession.current)(ctxDouble(BUYER).ctx, {}),
    ).toEqual({ subject: "did:privy:buyer" });
    await expect(
      handlerOf(authSession.current)(ctxDouble(ANON).ctx, {}),
    ).rejects.toThrow();

    // paymentMonitoring:status still refuses anonymous callers and returns a
    // state for a member.
    await expect(
      handlerOf(paymentMonitoring.status)(ctxDouble(ANON).ctx, {
        quoteId: "quote-1",
      }),
    ).rejects.toThrow();
    const monitorCtx = ctxDouble(BUYER);
    monitorCtx.tables.frozenQuotes.push({
      _id: "fq",
      id: "quote-1",
      scopeId: "scope-1",
      buyerAccountId: "buyer-1",
      version: 1,
      expiresAt: Date.now() + 600_000,
    });
    monitorCtx.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      scopeId: "scope-1",
      accountId: "buyer-1",
      role: "buyer",
      status: "active",
    });
    const status = await handlerOf(paymentMonitoring.status)(monitorCtx.ctx, {
      quoteId: "quote-1",
    });
    expect(status).toHaveProperty("state");
  });
});

describe("F19 sweepGrants and freeze use indexed reads", () => {
  const TTL = 5 * 60 * 1000;
  const GRACE = 60 * 60 * 1000;

  function grantCtx() {
    const f = ctxDouble(null);
    const deleted: string[] = [];
    const base = f.ctx as unknown as { db: Record<string, unknown> };
    const g = {
      ...base,
      db: {
        ...base.db,
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    };
    return { ctx: g as never, tables: f.tables, deleted: () => deleted };
  }

  const grant = (id: string, consumed: boolean, ageMs: number) => ({
    _id: id,
    orderId: "order-1",
    uploaderId: "merchant-1",
    expiresAt: Date.now() - ageMs,
    consumed,
    storageId: `blob-${id}`,
  });

  test("sweepGrants removes only expired unconsumed grants", async () => {
    const f = grantCtx();
    f.tables.fileGrants.push(
      grant("old-unconsumed", false, TTL + GRACE + 1000),
      grant("old-consumed", true, TTL + GRACE + 1000),
      grant("young-unconsumed", false, 1000),
    );
    const result = await files.sweepGrants(f.ctx);
    expect(result).toEqual({ removed: 1, remaining: 0 });
    expect(f.deleted()).toEqual(["old-unconsumed"]);
  });

  test("sweepGrants is bounded by SWEEP_LIMIT per call", async () => {
    const f = grantCtx();
    const total = files.SWEEP_LIMIT + 25;
    for (let i = 0; i < total; i++)
      f.tables.fileGrants.push(
        grant(`expired-${i}`, false, TTL + GRACE + 1000),
      );
    const result = await files.sweepGrants(f.ctx);
    expect(result.removed).toBe(files.SWEEP_LIMIT);
    expect(f.deleted()).toHaveLength(files.SWEEP_LIMIT);
    expect(files.SWEEP_LIMIT).toBe(64);
  });

  test("sweepGrants reads through an index range, never the whole table", async () => {
    const f = grantCtx();
    const queried: string[] = [];
    let fullScans = 0;
    const base = f.ctx as unknown as { db: Record<string, unknown> };
    const g = {
      ...base,
      db: {
        get: base.db.get,
        insert: base.db.insert,
        patch: base.db.patch,
        delete: base.db.delete,
        query: (table: string) => {
          queried.push(table);
          return {
            withIndex: (_name: string, range: (q: unknown) => unknown) => {
              const captured: [string, unknown][] = [];
              const q = {
                eq: (field: string, value: unknown) => {
                  captured.push([field, value]);
                  return q;
                },
                lt: (field: string, value: unknown) => {
                  captured.push([field, value]);
                  return q;
                },
              };
              range(q);
              const matched = () =>
                (f.tables[table as "fileGrants"] ?? []).filter((row) =>
                  captured.every(([field, value]) => row[field] === value),
                );
              return {
                take: async (n: number) => matched().slice(0, n),
                collect: async () => matched(),
              };
            },
            fullTableScan: () => {
              fullScans += 1;
              return { collect: async () => [], take: async () => [] };
            },
          };
        },
      },
    };
    await files.sweepGrants(g as never).catch(() => undefined);
    expect(queried).toEqual(["fileGrants"]);
    expect(fullScans).toBe(0);
  });
});
