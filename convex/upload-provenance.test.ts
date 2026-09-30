import { describe, expect, test } from "bun:test";
import type { AdmissionContext } from "./admissionContext";
import {
  attachUpload,
  GRANT_TTL_MS,
  requestUpload,
  storeAndAttachUpload,
} from "./files";

type Row = Record<string, unknown> & { _id: string };

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
    storage: {
      getMetadata: async (id: string) => storageBlobs.get(id) ?? null,
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
      runAfter: async (_delay: number, name: string, args: unknown) => {
        scheduled.push({ name: String(name), args });
      },
    },
    db: {
      get: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const found = rows.find((row) => row._id === id);
          if (found) return found;
        }
        return null;
      },
      query: (table: string) => {
        const rows = () => tables[table] ?? [];
        const filter = (predicate: (row: Row) => boolean) => {
          const matched = rows().filter(predicate);
          return {
            unique: async () => (matched.length === 1 ? matched[0] : null),
            take: async (n: number) => matched.slice(0, n),
            first: async () => matched[0] ?? null,
            collect: async () => matched,
          };
        };
        return {
          withIndex: (
            _index: string,
            range: (q: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            const captured: Array<[string, unknown]> = [];
            const chain = {
              eq: (field: string, value: unknown) => {
                captured.push([field, value]);
                return chain;
              },
            };
            range(chain);
            return filter((row) =>
              captured.every(([field, value]) => row[field] === value),
            );
          },
          fullTableScan: () => filter(() => true),
        };
      },
      insert: async (table: string, doc: Record<string, unknown>) => {
        const _id = `${table}-${tables[table].length + 1}`;
        const row = { ...doc, _id };
        tables[table].push(row);
        return _id;
      },
      patch: async (id: string, fields: Record<string, unknown>) => {
        for (const rows of Object.values(tables)) {
          const found = rows.find((row) => row._id === id);
          if (found) {
            Object.assign(found, fields);
            return;
          }
        }
        throw new Error(`unknown document ${id}`);
      },
      delete: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
    },
  };
  return {
    ctx: ctx as unknown as AdmissionContext & {
      storage: { store: (bytes: Uint8Array) => Promise<string> };
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
    expect(f.scheduled.map((s) => s.name)).toContain("files:inspect");
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
    expect(f.scheduled.map((s) => s.name)).toContain("files:inspect");
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
