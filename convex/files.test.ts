import { describe, expect, test } from "bun:test";
import type { AdmissionContext } from "./admissionContext";
import {
  attachUpload,
  GRANT_GRACE_MS,
  GRANT_TTL_MS,
  markInspected,
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
  const grant: Row = {
    _id: "grant-1",
    orderId: "order-1",
    uploaderId: "merchant-1",
    expiresAt: now + GRANT_TTL_MS,
    consumed: false,
    storageId: undefined,
    inspected: undefined,
  };
  const tables: Record<string, Row[]> = {
    orders: [order],
    memberships: [membership],
    fileGrants: [grant],
    deliveries: [],
  };
  const storageBlobs = new Map<string, { size: number }>([
    ["blob-1", { size: 32 }],
    ["blob-foreign", { size: 32 }],
    ["blob-other-grant", { size: 32 }],
  ]);
  let identity =
    options && "identity" in options
      ? options.identity
      : {
          issuer: "privy.io",
          subject: "did:privy:merchant",
        };
  const scheduled: string[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    storage: {
      getMetadata: async (id: string) => storageBlobs.get(id) ?? null,
    },
    scheduler: {
      runAfter: async (_delay: number, name: string) => {
        scheduled.push(String(name));
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
        const filter = (
          predicate: (row: Row) => boolean,
          indexName: string,
        ) => {
          const matched = rows().filter(predicate);
          return {
            unique: async () => (matched.length === 1 ? matched[0] : null),
            take: async (n: number) => matched.slice(0, n),
            first: async () => matched[0] ?? null,
            collect: async () => matched,
            [Symbol.for("index")]: indexName,
          };
        };
        return {
          withIndex: (
            index: string,
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
            return filter(
              (row) =>
                captured.every(([field, value]) => row[field] === value),
              index,
            );
          },
          fullTableScan: () => filter(() => true, "full"),
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
    ctx: ctx as unknown as AdmissionContext,
    tables,
    grant,
    order,
    membership,
    storageBlobs,
    scheduled,
    setIdentity: (value: typeof identity) => {
      identity = value;
    },
  };
}

describe("RECONSTRUCTED attachUpload grant bind", () => {
  test("binds storageId to the issued grant and schedules trusted inspection", async () => {
    const f = databaseDouble();
    await attachUpload(f.ctx, {
      grantId: "grant-1",
      storageId: "blob-1",
    });
    expect(f.grant.storageId).toBe("blob-1");
    expect(f.scheduled).toContain("files:inspect");
  });

  test("refuses missing grant, unauthenticated, non-merchant, wrong owner, revoked membership", async () => {
    const missing = databaseDouble();
    await expect(
      attachUpload(missing.ctx, { grantId: "nope", storageId: "blob-1" }),
    ).rejects.toThrow();

    const anonymous = databaseDouble({
      identity: null,
    });
    await expect(
      attachUpload(anonymous.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();

    const buyer = databaseDouble({
      identity: { issuer: "privy.io", subject: "did:privy:buyer" },
    });
    buyer.membership.role = "buyer";
    buyer.membership.accountId = "buyer-1";
    buyer.membership.privySubject = "did:privy:buyer";
    await expect(
      attachUpload(buyer.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();

    const wrongOwner = databaseDouble({
      identity: { issuer: "privy.io", subject: "did:privy:other" },
    });
    wrongOwner.membership.accountId = "other-merchant";
    wrongOwner.membership.privySubject = "did:privy:other";
    await expect(
      attachUpload(wrongOwner.ctx, {
        grantId: "grant-1",
        storageId: "blob-1",
      }),
    ).rejects.toThrow();

    const revoked = databaseDouble();
    revoked.membership.status = "revoked";
    await expect(
      attachUpload(revoked.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();
    expect(revoked.grant.storageId).toBeUndefined();
  });

  test("refuses uploader mismatch, consumed, already-set, and expired grants", async () => {
    const mismatch = databaseDouble();
    mismatch.grant.uploaderId = "someone-else";
    await expect(
      attachUpload(mismatch.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();

    const consumed = databaseDouble();
    consumed.grant.consumed = true;
    await expect(
      attachUpload(consumed.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();

    const already = databaseDouble();
    already.grant.storageId = "blob-other-grant";
    await expect(
      attachUpload(already.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();

    const expired = databaseDouble();
    expired.grant.expiresAt = Date.now() - 1;
    await expect(
      attachUpload(expired.ctx, { grantId: "grant-1", storageId: "blob-1" }),
    ).rejects.toThrow();
  });

  test("refuses missing storage object before any grant write", async () => {
    const f = databaseDouble();
    await expect(
      attachUpload(f.ctx, { grantId: "grant-1", storageId: "blob-missing" }),
    ).rejects.toThrow();
    expect(f.grant.storageId).toBeUndefined();
  });

  test("refuses storage already bound to another active grant; consumed grant is not a live claim", async () => {
    const f = databaseDouble();
    f.tables.fileGrants.push({
      _id: "grant-2",
      orderId: "order-1",
      uploaderId: "merchant-1",
      expiresAt: Date.now() + GRANT_TTL_MS,
      consumed: false,
      storageId: "blob-other-grant",
      inspected: undefined,
    });
    await expect(
      attachUpload(f.ctx, {
        grantId: "grant-1",
        storageId: "blob-other-grant",
      }),
    ).rejects.toThrow();

    const consumed = databaseDouble();
    consumed.tables.fileGrants.push({
      _id: "grant-2",
      orderId: "order-1",
      uploaderId: "merchant-1",
      expiresAt: Date.now() + GRANT_TTL_MS,
      consumed: true,
      storageId: "blob-other-grant",
      inspected: undefined,
    });
    await attachUpload(consumed.ctx, {
      grantId: "grant-1",
      storageId: "blob-other-grant",
    });
    expect(consumed.grant.storageId).toBe("blob-other-grant");
  });
});

describe("RECONSTRUCTED markInspected producer fence", () => {
  const inspected = {
    storageId: "blob-1",
    sha256: "a".repeat(64),
    contentType: "image/png",
    byteLength: 12,
  };

  test("stamps an attached unconsumed grant from witnessed bytes", async () => {
    const f = databaseDouble();
    f.grant.storageId = "blob-1";
    await markInspected(f.ctx, { grantId: "grant-1", inspected });
    expect(f.grant.inspected).toEqual(inspected);
  });

  test("refuses re-stamp, post-consume stamp, and storageId mismatch", async () => {
    const restamp = databaseDouble();
    restamp.grant.storageId = "blob-1";
    restamp.grant.inspected = { ...inspected };
    await expect(
      markInspected(restamp.ctx, { grantId: "grant-1", inspected }),
    ).rejects.toThrow();

    const consumed = databaseDouble();
    consumed.grant.storageId = "blob-1";
    consumed.grant.consumed = true;
    await expect(
      markInspected(consumed.ctx, { grantId: "grant-1", inspected }),
    ).rejects.toThrow();

    const mismatch = databaseDouble();
    mismatch.grant.storageId = "blob-1";
    await expect(
      markInspected(mismatch.ctx, {
        grantId: "grant-1",
        inspected: { ...inspected, storageId: "blob-other" },
      }),
    ).rejects.toThrow();
    expect(mismatch.grant.inspected).toBeUndefined();
  });
});

describe("RECONSTRUCTED grant TTL constants", () => {
  test("pins 5 minute grant TTL and 1 hour grace", () => {
    expect(GRANT_TTL_MS).toBe(5 * 60 * 1000);
    expect(GRANT_GRACE_MS).toBe(60 * 60 * 1000);
  });
});
