import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { AdmissionContext } from "./admissionContext";
import {
  attachUpload,
  bindUpload,
  GRANT_TTL_MS,
  markInspected,
  requestUpload,
  resolveRead,
  storeAndAttachUpload,
} from "./files";
import type { Row } from "./orderProjection.double";
import { readSurface, writeSurface } from "./orderProjection.double";

// AUDIT15 A-01: no privy.io fallback, so declare the issuer under test.
process.env.CONVEX_SITE_URL ??= "privy.io";

/** The mutation an action's function reference names, resolved by its registered name. */
function mutationFor(name: string) {
  const table: Record<string, unknown> = {
    "files:bindUploadMutation": bindUpload,
    "files:markInspectedMutation": markInspected,
    "files:resolveReadMutation": resolveRead,
  };
  const handler = table[name];
  if (!handler) throw new Error(`unregistered function reference: ${name}`);
  return handler as (ctx: never, args: never) => Promise<unknown>;
}

function databaseDouble(options?: {
  identity?: { issuer: string; subject: string } | null;
  now?: number;
}) {
  const now = options?.now ?? Date.now();
  const order: Row = {
    _id: "order-1",
    id: "order-1",
    buyerId: "buyer-1",
    merchantId: "merchant-1",
    disputeOperatorId: "operator-1",
    scopeId: "order-1",
    profile: "image-pack-v1",
    outputCount: 3,
    phase: "ACCEPTED",
    revision: 1,
  };
  const membership: Row = {
    _id: "member-1",
    privySubject: "did:privy:merchant",
    accountId: "merchant-1",
    scopeId: "order-1",
    role: "merchant",
    status: "active",
  };
  const tables: Record<string, Row[]> = {
    orders: [order],
    memberships: [membership],
    fileGrants: [],
    deliveries: [],
  };
  const storageBlobs = new Map<string, { size: number }>();
  let uploadSeq = 0;
  let identity =
    options && "identity" in options
      ? options.identity
      : {
          issuer: "privy.io",
          subject: "did:privy:merchant",
        };
  const scheduled: Array<{ name: string; args: unknown }> = [];
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    runMutation: async (ref: unknown, args: unknown) => {
      const handler = mutationFor(getFunctionName(ref as never));
      return await handler(ctx as never, args as never);
    },
    storage: {
      getMetadata: async (id: string) => storageBlobs.get(id) ?? null,
      get: async (id: string) => {
        const blob = storageBlobs.get(id);
        if (!blob) return null;
        return { arrayBuffer: async () => new Uint8Array(blob.size).buffer };
      },
      generateUploadUrl: async () => {
        uploadSeq += 1;
        return `https://upload.example/${uploadSeq}`;
      },
      store: async (bytes: Uint8Array) => {
        const id = `blob-stored-${storageBlobs.size + 1}`;
        storageBlobs.set(id, { size: bytes.byteLength });
        return id;
      },
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown, args: unknown) => {
        scheduled.push({ name: getFunctionName(ref as never), args });
      },
    },
    db: {
      ...readSurface(tables),
      ...writeSurface(tables),
    },
  };
  return {
    ctx: ctx as unknown as AdmissionContext & {
      storage: {
        store: (bytes: Uint8Array) => Promise<string>;
        get: (
          id: string,
        ) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
      };
      runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
    },
    tables,
    order,
    membership,
    storageBlobs,
    scheduled,
    setIdentity: (value: typeof identity) => {
      identity = value;
    },
    now,
  };
}

const png = () =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("upload URL to storageId provenance is closed", () => {
  test("requestUpload issues a one-time ticket bound to the grant", async () => {
    const f = databaseDouble();
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    expect(issued.grantId).toBeTruthy();
    expect(issued.uploadUrl).toContain("https://upload.example/");
    expect(issued.uploadTicket).toBeTruthy();
    expect(issued.expiresAt).toBeGreaterThan(Date.now());
    expect(f.tables.fileGrants[0].uploadTicket).toBe(issued.uploadTicket);
    expect(f.tables.fileGrants[0].storageId).toBeUndefined();
    expect(GRANT_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("the ticket carries CSPRNG entropy, not a Math.random suffix", async () => {
    const f = databaseDouble();
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    // ut_<grantId>_<32 hex chars>: 128 bits from the platform CSPRNG. The old
    // Math.random() suffix was ~10 decimal digits and never looked like this.
    expect(issued.uploadTicket).toMatch(/^ut_.+_[0-9a-f]{32}$/);
    const suffix = issued.uploadTicket.split("_").at(-1) ?? "";
    expect(suffix).toHaveLength(32);
    expect(suffix).not.toBe("0".repeat(32));
  });

  test("attachUpload refuses a storageId without the grant's upload ticket", async () => {
    const f = databaseDouble();
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    f.storageBlobs.set("blob-1", { size: 32 });
    await expect(
      attachUpload(f.ctx, {
        grantId: issued.grantId,
        storageId: "blob-1",
        uploadTicket: "not-the-ticket",
      }),
    ).rejects.toThrow(/provenance|ticket|unavailable/i);
    expect(f.tables.fileGrants[0].storageId).toBeUndefined();
  });

  test("attachUpload refuses a ticket issued for another grant", async () => {
    const f = databaseDouble();
    const first = await requestUpload(f.ctx, { orderId: "order-1" });
    // Second outstanding grant on the same order.
    const second = await requestUpload(f.ctx, { orderId: "order-1" });
    f.storageBlobs.set("blob-1", { size: 32 });
    await expect(
      attachUpload(f.ctx, {
        grantId: second.grantId,
        storageId: "blob-1",
        uploadTicket: first.uploadTicket,
      }),
    ).rejects.toThrow(/provenance|ticket|unavailable/i);
    expect(f.tables.fileGrants[0].storageId).toBeUndefined();
    expect(f.tables.fileGrants[1].storageId).toBeUndefined();
  });

  test("attachUpload binds only with the matching ticket and consumes it once", async () => {
    const f = databaseDouble();
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    f.storageBlobs.set("blob-1", { size: 32 });
    const bound = await attachUpload(f.ctx, {
      grantId: issued.grantId,
      storageId: "blob-1",
      uploadTicket: issued.uploadTicket,
    });
    expect(bound).toEqual({
      grantId: issued.grantId,
      storageId: "blob-1",
    });
    expect(f.tables.fileGrants[0].storageId).toBe("blob-1");
    expect(f.tables.fileGrants[0].uploadTicket).toBeUndefined();
    // Ticket is single-use: a second attach cannot re-bind.
    f.storageBlobs.set("blob-2", { size: 32 });
    await expect(
      attachUpload(f.ctx, {
        grantId: issued.grantId,
        storageId: "blob-2",
        uploadTicket: issued.uploadTicket,
      }),
    ).rejects.toThrow();
    expect(f.tables.fileGrants[0].storageId).toBe("blob-1");
    expect(f.scheduled.map((s) => s.name)).toContain(
      "files:inspectGrantAction",
    );
  });

  test("action-based storeAndAttachUpload produces and binds the storageId itself", async () => {
    const f = databaseDouble();
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    const result = await storeAndAttachUpload(f.ctx as never, {
      grantId: issued.grantId,
      bytes: png(),
    });
    // URL->storageId is closed: the returned id is exactly the bound id, and
    // no client-supplied storageId participated in the bind.
    expect(result.storageId).toMatch(/^blob-stored-/);
    expect(f.tables.fileGrants[0].storageId).toBe(result.storageId);
    expect(result.grantId).toBe(issued.grantId);
    expect(f.scheduled.map((s) => s.name)).toContain(
      "files:inspectGrantAction",
    );
    // The action path is one-shot too: the grant cannot accept another bind.
    await expect(
      attachUpload(f.ctx, {
        grantId: issued.grantId,
        storageId: "blob-other",
        uploadTicket: issued.uploadTicket,
      }),
    ).rejects.toThrow();
    await expect(
      storeAndAttachUpload(f.ctx, {
        grantId: issued.grantId,
        bytes: png(),
      }),
    ).rejects.toThrow();
  });

  test("storeAndAttachUpload refuses an unauthorized or missing grant", async () => {
    const f = databaseDouble();
    await expect(
      storeAndAttachUpload(f.ctx, {
        grantId: "nope",
        bytes: png(),
      }),
    ).rejects.toThrow();
    const anon = databaseDouble({ identity: null });
    const issued = await requestUpload(anon.ctx, { orderId: "order-1" }).catch(
      () => null,
    );
    if (issued) {
      await expect(
        storeAndAttachUpload(anon.ctx, {
          grantId: issued.grantId,
          bytes: png(),
        }),
      ).rejects.toThrow();
    } else {
      // requestUpload itself refuses anonymous callers.
      expect(issued).toBeNull();
    }
    const buyer = databaseDouble();
    await requestUpload(buyer.ctx, { orderId: "order-1" });
    buyer.setIdentity({ issuer: "privy.io", subject: "did:privy:buyer" });
    await expect(
      storeAndAttachUpload(buyer.ctx, {
        grantId: "fileGrants-1",
        bytes: png(),
      }),
    ).rejects.toThrow();
    expect(buyer.tables.fileGrants[0].storageId).toBeUndefined();
  });

  test("storeAndAttachUpload refuses an expired grant", async () => {
    const f = databaseDouble();
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    f.tables.fileGrants[0].expiresAt = Date.now() - 1;
    await expect(
      storeAndAttachUpload(f.ctx, {
        grantId: issued.grantId,
        bytes: png(),
      }),
    ).rejects.toThrow(/unavailable|expired/i);
    expect(f.tables.fileGrants[0].storageId).toBeUndefined();
  });
});

/**
 * R28/R29 AC-01: `grantsForOrder` was an unbounded `.collect()` over a table
 * that only grows (the sweep deliberately keeps consumed grants — see
 * `sweepGrants`). Convex caps a transaction at 32,000 documents scanned, so a
 * long-lived order would eventually fail every `freeze` and never complete.
 *
 * The bound is 512, **newest-first**. The ordering is the load-bearing half:
 * with an ascending window, 600 old consumed grants would push the two live
 * ones out of range, `requestUpload` would count 0 outstanding, and a merchant
 * could open a fourth upload slot — the exact trap this test pins by value.
 */
describe("R29 AC-01: the per-order grant read is bounded and newest-first", () => {
  test("the ceiling is exported and far above any real order", async () => {
    const { ORDER_GRANT_LIMIT } = await import("./files");
    // `requestUpload` allows 3 live grants, so 512 needs 171 upload cycles.
    expect(ORDER_GRANT_LIMIT).toBe(512);
    expect(ORDER_GRANT_LIMIT).toBeGreaterThan(3 * 100);
  });

  test("live grants are found even behind 600 consumed ones", async () => {
    const f = databaseDouble();
    const now = Date.now();
    for (let i = 0; i < 600; i++) {
      f.tables.fileGrants.push({
        _id: `old-${i}`,
        orderId: "order-1",
        uploaderId: "merchant-1",
        expiresAt: now + GRANT_TTL_MS,
        consumed: true,
        storageId: `blob-${i}`,
      });
    }
    for (let i = 0; i < 2; i++) {
      f.tables.fileGrants.push({
        _id: `live-${i}`,
        orderId: "order-1",
        uploaderId: "merchant-1",
        expiresAt: now + GRANT_TTL_MS,
        consumed: false,
      });
    }
    // Two live grants: one more is allowed.
    const issued = await requestUpload(f.ctx, { orderId: "order-1" });
    expect(issued.grantId).toBeTruthy();
    // Three live grants now, so the next call must refuse. This is the
    // assertion that fails on an ascending read: the two live grants would be
    // outside the window and the count would read 1, not 3.
    await expect(requestUpload(f.ctx, { orderId: "order-1" })).rejects.toThrow(
      "outstanding upload limit",
    );
  });

  /**
   * The bound itself, asserted on the source of truth rather than through a
   * proxy. `requestUpload` reaches `grantsForOrder` through a closure over
   * `ctx.db`, so patching the double afterwards cannot observe the read — an
   * earlier version of this test "passed" with `sizes.length === 0`, which is a
   * false pass. The ordering test above is the behavioural proof; this one
   * pins that the read is a `.take`, not a `.collect`.
   */
  test("the per-order read is a bounded take, not an unbounded collect", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./files.ts", import.meta.url),
      "utf8",
    );
    const fn = source.slice(
      source.indexOf("const grantsForOrder ="),
      source.indexOf("/** One sweep run removes"),
    );
    expect(fn).toContain(".take(ORDER_GRANT_LIMIT)");
    expect(fn).not.toContain(".collect()");
    // Newest-first, so a freeze's own grants are inside the window.
    expect(fn).toContain('.order("desc")');
  });
});
