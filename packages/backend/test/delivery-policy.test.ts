import { describe, expect, test } from "bun:test";
import {
  type AtomicDeliveryRepository,
  authorizeDeliveryRead,
  type DeliveryAccount,
  type DeliveryOrder,
  type FrozenDelivery,
  freezeDelivery,
  type UploadGrant,
} from "../src/delivery-policy";

function fixture() {
  let account: DeliveryAccount | undefined = {
    id: "merchant",
    enabled: true,
    invited: true,
  };
  const order: DeliveryOrder = {
    id: "order",
    buyerId: "buyer",
    merchantId: "merchant",
    disputeOperatorId: "operator",
    profile: "image-pack-v1",
    outputCount: 3,
    phase: "ACCEPTED",
    revision: 2,
  };
  const files = [0, 1, 2].map((index) => ({
    grantId: `grant-${index}`,
    sha256: `${index}`.repeat(64),
    contentType: "image/png" as const,
    byteLength: 123,
  }));
  const grants = new Map<string, UploadGrant>(
    files.map((entry, index) => [
      entry.grantId,
      {
        id: entry.grantId,
        orderId: "order",
        uploaderId: "merchant",
        expiresAt: 2_000,
        consumed: false,
        storageId: `storage-${index}`,
        inspected: {
          storageId: `storage-${index}`,
          sha256: entry.sha256,
          contentType: entry.contentType,
          byteLength: entry.byteLength,
        },
      },
    ]),
  );
  const attached = new Set<string>();
  let saved: FrozenDelivery | undefined;
  let membership = true;
  let confirmed = false;
  let now = 1_000;
  let writes = 0;
  // Explicit synchronous transaction double; not deployed Convex concurrency evidence.
  const repository: AtomicDeliveryRepository = {
    transact: (operation) =>
      operation({
        authenticatedAccount: () => account,
        serverNow: () => now,
        getOrder: (id) => (id === order.id ? order : undefined),
        membershipActive: () => membership,
        getUploadGrant: (id) => grants.get(id),
        getFrozenDelivery: () => saved,
        confirmedDeliveryMatches: () => confirmed,
        storageAttached: (id) => attached.has(id),
        insertDeliveryAndConsumeGrants: (delivery) => {
          writes++;
          saved = delivery;
          for (const entry of delivery.files) {
            const grant = grants.get(entry.grantId);
            if (!grant) throw new Error("test grant missing");
            grant.consumed = true;
            attached.add(entry.storageId);
          }
        },
      }),
  };
  return {
    repository,
    request: { orderId: order.id, files },
    order,
    grants,
    attached,
    setAccount: (value: DeliveryAccount | undefined) => {
      account = value;
    },
    setMember: (value: boolean) => {
      membership = value;
    },
    setConfirmed: (value: boolean) => {
      confirmed = value;
    },
    setNow: (value: number) => {
      now = value;
    },
    writes: () => writes,
  };
}

function account(id: string): DeliveryAccount {
  return { id, enabled: true, invited: true };
}

describe("B-04 protected delivery policy (local transaction double only)", () => {
  test("freezes ordered exact-three manifest and consumes every grant in one transaction", () => {
    const f = fixture();
    const frozen = freezeDelivery(f.repository, f.request);
    expect(frozen.files.map((entry) => entry.storageId)).toEqual([
      "storage-0",
      "storage-1",
      "storage-2",
    ]);
    expect([...f.grants.values()].every((grant) => grant.consumed)).toBe(true);
    expect(f.writes()).toBe(1);
    frozen.files[0].sha256 = "f".repeat(64);
    expect(
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 })
        .sha256,
    ).toBe("0".repeat(64));
    expect(() => freezeDelivery(f.repository, f.request)).toThrow("immutable");
    expect(f.writes()).toBe(1);
  });

  test("denies missing identity, disabled/invite/membership failures, wrong role and order", () => {
    for (const actor of [
      undefined,
      { ...account("merchant"), enabled: false },
      { ...account("merchant"), invited: false },
      account("buyer"),
      account("stranger"),
    ]) {
      const f = fixture();
      f.setAccount(actor);
      expect(() => freezeDelivery(f.repository, f.request)).toThrow();
      expect(f.writes()).toBe(0);
    }
    const f = fixture();
    f.setMember(false);
    expect(() => freezeDelivery(f.repository, f.request)).toThrow();
    f.setMember(true);
    expect(() =>
      freezeDelivery(f.repository, { ...f.request, orderId: "other" }),
    ).toThrow();
    f.order.phase = "SUBMITTED";
    expect(() => freezeDelivery(f.repository, f.request)).toThrow();
  });

  test("rejects guessed, cross-order, expired, consumed, reused and uninspected storage", () => {
    const mutations: ((
      grant: UploadGrant,
      f: ReturnType<typeof fixture>,
    ) => void)[] = [
      (g) => {
        g.id = "other";
      },
      (g) => {
        g.orderId = "other";
      },
      (g) => {
        g.uploaderId = "buyer";
      },
      (g) => {
        g.expiresAt = 1_000;
      },
      (g) => {
        g.consumed = true;
      },
      (g, f) => {
        f.attached.add(g.storageId);
      },
      (g) => {
        g.inspected.storageId = "other";
      },
      (g) => {
        g.inspected.sha256 = "f".repeat(64);
      },
      (g) => {
        g.inspected.contentType = "image/jpeg";
      },
      (g) => {
        g.inspected.byteLength++;
      },
    ];
    for (const mutate of mutations) {
      const f = fixture();
      const grant = f.grants.get("grant-1");
      if (!grant) throw new Error("test grant missing");
      mutate(grant, f);
      expect(() => freezeDelivery(f.repository, f.request)).toThrow();
      expect(f.writes()).toBe(0);
      expect(f.grants.get("grant-0")?.consumed).toBe(false);
    }
    const f = fixture();
    f.grants.delete("grant-1");
    expect(() => freezeDelivery(f.repository, f.request)).toThrow();
  });

  test("enforces byte/type/count limits, distinct grants, and strict client input", () => {
    const f = fixture();
    const original = f.request.files[0];
    for (const changed of [
      { ...original, byteLength: 0 },
      { ...original, byteLength: 5 * 1024 * 1024 + 1 },
      { ...original, byteLength: 1.5 },
      { ...original, contentType: "image/svg+xml" },
      { ...original, sha256: "not-a-digest" },
      { ...original, storageId: "arbitrary" },
    ])
      expect(() =>
        freezeDelivery(f.repository, {
          ...f.request,
          files: [changed, ...f.request.files.slice(1)],
        }),
      ).toThrow();
    expect(() =>
      freezeDelivery(f.repository, {
        ...f.request,
        files: f.request.files.slice(1),
      }),
    ).toThrow();
    expect(() =>
      freezeDelivery(f.repository, {
        ...f.request,
        files: [original, original, original],
      }),
    ).toThrow();
    expect(() =>
      freezeDelivery(f.repository, { ...f.request, role: "merchant" }),
    ).toThrow();
    f.setNow(Number.NaN);
    expect(() => freezeDelivery(f.repository, f.request)).toThrow();
    expect(f.writes()).toBe(0);
  });

  test("reauthorizes every read and requires confirmed manifest for buyer and assigned dispute operator", () => {
    const f = fixture();
    freezeDelivery(f.repository, f.request);
    const input = { orderId: "order", fileIndex: 0 };
    f.setAccount(account("buyer"));
    expect(() => authorizeDeliveryRead(f.repository, input)).toThrow(
      "confirmed chain",
    );
    f.setConfirmed(true);
    const descriptor = authorizeDeliveryRead(f.repository, input);
    expect(descriptor.storageId).toBe("storage-0");
    expect(Object.keys(descriptor)).not.toContain("url");
    f.setMember(false);
    expect(() => authorizeDeliveryRead(f.repository, input)).toThrow();
    f.setMember(true);
    f.setAccount({ ...account("buyer"), enabled: false });
    expect(() => authorizeDeliveryRead(f.repository, input)).toThrow();
    f.setAccount(account("operator"));
    expect(() => authorizeDeliveryRead(f.repository, input)).toThrow();
    f.order.phase = "DISPUTED";
    expect(authorizeDeliveryRead(f.repository, input).sha256).toBe(
      "0".repeat(64),
    );
    f.setAccount(account("other-operator"));
    expect(() => authorizeDeliveryRead(f.repository, input)).toThrow();
    f.setAccount(account("buyer"));
    expect(() =>
      authorizeDeliveryRead(f.repository, { ...input, orderId: "other" }),
    ).toThrow();
    expect(() =>
      authorizeDeliveryRead(f.repository, { ...input, fileIndex: 3 }),
    ).toThrow();
  });
});
