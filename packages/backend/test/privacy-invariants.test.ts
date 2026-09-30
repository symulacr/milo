/**
 * M9 — Privacy invariants as tests:
 *  1. No plaintext commercial terms on-chain (commitments only).
 *  2. No PII/secrets in logs or diagnostics projections.
 *  3. Authorized file reads only (never a bearer URL / unscoped storage id).
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AtomicDeliveryRepository,
  authorizeDeliveryRead,
  type DeliveryAccount,
  type DeliveryOrder,
  type FrozenDelivery,
  freezeDelivery,
  type UploadGrant,
} from "../src/delivery-policy";
import { publicConfigResponse } from "../src/public-config";

const ROOT = new URL("../../..", import.meta.url).pathname;
const CONTRACT = join(ROOT, "packages/contract");
const CONVEX = join(ROOT, "convex");
const BACKEND_SRC = join(ROOT, "packages/backend/src");

describe("M9.1 no plaintext terms on-chain", () => {
  test("public Configuration carries termsCommitment, never Terms openings", async () => {
    const source = await readFile(join(CONTRACT, "src/order.compact"), "utf8");
    const configBlock = source.match(
      /export struct Configuration \{([\s\S]*?)\}/,
    )?.[1];
    expect(configBlock).toBeTruthy();
    for (const field of [
      "serviceVersion",
      "packQuantity",
      "outputCount",
      "unitPrice",
      "total",
      "currency",
      "scopeDigest",
      "rightsDigest",
      "paymentPolicy",
      "salt",
    ]) {
      expect(configBlock).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(configBlock).toContain("termsCommitment");
  });

  test("ledger exports never hold a Terms struct or role secrets", async () => {
    const source = await readFile(join(CONTRACT, "src/order.compact"), "utf8");
    const ledgerLines = source
      .split("\n")
      .filter((line) => /export (sealed )?ledger /.test(line))
      .join("\n");
    expect(ledgerLines).not.toMatch(/Terms/);
    expect(ledgerLines).not.toMatch(/secret/i);
    expect(ledgerLines).not.toMatch(/unitPrice|total|salt/);
    // Witnesses (private openings) are not ledger exports.
    expect(source).toMatch(/witness agreedTerms\(\): Terms;/);
    expect(source).toMatch(/witness buyerSecret\(\): Bytes<32>;/);
  });

  test("generated Configuration type has no plaintext commercial fields", async () => {
    const dts = await readFile(
      join(CONTRACT, "generated/contract/index.d.ts"),
      "utf8",
    );
    const configType = dts.match(
      /export type Configuration = \{([\s\S]*?)\};/,
    )?.[1];
    expect(configType).toBeTruthy();
    for (const field of [
      "unitPrice",
      "total",
      "currency",
      "salt",
      "scopeDigest",
      "rightsDigest",
      "paymentPolicy",
    ]) {
      expect(configBlockAbsent(configType ?? "", field)).toBe(true);
    }
    expect(configType).toContain("termsCommitment");
  });

  test("public constructor reconstruction never emits a Terms opening", async () => {
    const { reconstructPublicConstructor } = await import(
      "../src/public-constructor.mjs"
    );
    const quote = {
      constructorVersion: 1 as const,
      constructorEncoding: "milo:compact-configuration:v1" as const,
      network: "preprod",
      nonce: "4".repeat(64),
      termsCommitment: "a".repeat(64),
      buyerCommitment: "1".repeat(64),
      merchantCommitment: "2".repeat(64),
      operatorCommitment: "3".repeat(64),
      acceptanceDeadlineSeconds: 10,
      deliveryDeadlineSeconds: 20,
      reviewDeadlineSeconds: 30,
      resolutionDeadlineSeconds: 40,
    };
    const config = reconstructPublicConstructor(quote);
    const keys = Object.keys(config);
    expect(keys).toContain("termsCommitment");
    for (const banned of [
      "unitPrice",
      "total",
      "currency",
      "salt",
      "scopeDigest",
      "rightsDigest",
      "paymentPolicy",
      "terms",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });
});

function configBlockAbsent(block: string, field: string) {
  return !new RegExp(`\\b${field}\\b`).test(block);
}

describe("M9.2 no PII/secrets in logs or public projections", () => {
  test("diagnostics projection is correlation ids only", async () => {
    const { byIntentRows } = await import("../../../convex/diagnostics");
    const rows = await byIntentRows(
      {
        query: () => ({
          withIndex: () => ({
            take: async () => [
              {
                _id: "op",
                paymentIntentId: "pi_secret_value",
                action: "capture",
                state: "pending",
                generation: 1,
                attempt: 0,
                rawBody: "SHOULD_NOT_LEAK",
                secret: "whsec_leak",
              },
            ],
          }),
        }),
      } as never,
      "pi",
    );
    expect(rows).toEqual([
      {
        id: "op",
        action: "capture",
        state: "pending",
        generation: 1,
        attempt: 0,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("SHOULD_NOT_LEAK");
    expect(JSON.stringify(rows)).not.toContain("whsec_leak");
  });

  test("public-config response strips extended server fields and secrets", async () => {
    const res = publicConfigResponse(
      new Request("https://milo.example/api/public-config"),
      {
        privyAppId: "app",
        convexUrl: "https://x.convex.cloud",
        midnightNetwork: "preprod",
        privyAppSecret: "PRIVY_SECRET",
        stripeSecretKey: "sk_live_LEAK",
        webhookSecret: "whsec_LEAK",
      } as never,
    );
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("PRIVY_SECRET");
    expect(text).not.toContain("sk_live_LEAK");
    expect(text).not.toContain("whsec_LEAK");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("stripe customer provisioning errors are redacted (no provider payload)", async () => {
    const { provisionTestCustomerFacts } = await import(
      "../src/stripe-customer-provisioning.server"
    );
    process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = JSON.stringify([
      { operatorId: "op", sourceId: "verified-import" },
    ]);
    try {
      await expect(
        provisionTestCustomerFacts(
          {
            requestId: "r1",
            operatorId: "op",
            sourceId: "verified-import",
            buyerAccountId: "buyer",
            stripeAccountId: "acct_x",
            stripeCustomerId: "cus_x",
          },
          async () => {
            throw new Error("should not commit");
          },
          () => ({
            accounts: {
              retrieveCurrent: async () => {
                throw new Error("secret provider body acct_live_LEAK");
              },
            },
            customers: { retrieve: async () => ({ id: "cus_x" }) },
          }),
        ),
      ).rejects.toThrow("Stripe test customer facts unavailable");
    } finally {
      delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
    }
  });

  test("convex/backend log sites never print secrets or raw webhook bodies", async () => {
    const roots = [CONVEX, BACKEND_SRC];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/\.(ts|mjs|js)$/.test(entry.name)) continue;
        if (entry.name.endsWith(".test.ts")) continue;
        const text = await readFile(join(root, entry.name), "utf8");
        for (const line of text.split("\n")) {
          if (!/console\.(log|info|warn|error|debug)/.test(line)) continue;
          if (
            /whsec_|sk_live_|sk_test_|PRIVY_APP_SECRET|STRIPE_SECRET|privateState|rawBody|seed/i.test(
              line,
            )
          ) {
            offenders.push(`${entry.name}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("M9.3 authorized file reads only", () => {
  function readFixture() {
    // freezeDelivery requires the merchant in ACCEPTED; reads happen later.
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
      revision: 1,
    };
    const files = [0, 1, 2].map((index) => ({
      grantId: `grant-${index}`,
      sha256: `${index}`.repeat(64),
      contentType: "image/png" as const,
      byteLength: 8,
    }));
    const grants = new Map<string, UploadGrant>(
      files.map((entry, index) => [
        entry.grantId,
        {
          id: entry.grantId,
          orderId: "order",
          uploaderId: "merchant",
          expiresAt: 10_000,
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
    let saved: FrozenDelivery | undefined;
    let membership = true;
    let confirmed = true;
    const attached = new Set<string>();
    const repository: AtomicDeliveryRepository = {
      transact: (operation) =>
        operation({
          authenticatedAccount: () => account,
          serverNow: () => 1_000,
          getOrder: (id) => (id === order.id ? order : undefined),
          membershipActive: () => membership,
          getUploadGrant: (id) => grants.get(id),
          getFrozenDelivery: () => saved,
          confirmedDeliveryMatches: () => confirmed,
          storageAttached: (id) => attached.has(id),
          insertDeliveryAndConsumeGrants: (delivery) => {
            saved = delivery;
            for (const entry of delivery.files) {
              const grant = grants.get(entry.grantId);
              if (grant) grant.consumed = true;
              attached.add(entry.storageId);
            }
          },
        }),
    };
    freezeDelivery(repository, { orderId: "order", files });
    // After freeze the delivery is submitted; buyer/operator reads use this phase.
    order.phase = "SUBMITTED";
    return {
      repository,
      order,
      setAccount: (value: DeliveryAccount | undefined) => {
        account = value;
      },
      setMember: (value: boolean) => {
        membership = value;
      },
      setConfirmed: (value: boolean) => {
        confirmed = value;
      },
    };
  }

  test("anonymous and non-member callers cannot read delivery bytes", () => {
    const f = readFixture();
    f.setAccount(undefined);
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 }),
    ).toThrow();
    f.setAccount({ id: "buyer", enabled: true, invited: true });
    f.setMember(false);
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 }),
    ).toThrow();
  });

  test("strangers and out-of-scope operators are refused", () => {
    const f = readFixture();
    f.setAccount({ id: "stranger", enabled: true, invited: true });
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 }),
    ).toThrow();
    f.order.phase = "DISPUTED";
    f.setAccount({ id: "other-operator", enabled: true, invited: true });
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 }),
    ).toThrow();
  });

  test("buyer/operator reads require the confirmed chain binding", () => {
    const f = readFixture();
    f.setAccount({ id: "buyer", enabled: true, invited: true });
    f.setConfirmed(false);
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 }),
    ).toThrow(/confirmed chain/);
    f.setConfirmed(true);
    const descriptor = authorizeDeliveryRead(f.repository, {
      orderId: "order",
      fileIndex: 0,
    });
    // Byte-transport descriptor only — never a URL or bearer token.
    expect(Object.keys(descriptor).sort()).toEqual([
      "byteLength",
      "contentType",
      "grantId",
      "sha256",
      "storageId",
    ]);
    expect(JSON.stringify(descriptor)).not.toMatch(/https?:\/\//);
  });

  test("merchant can read own delivery; index and order are re-checked", () => {
    const f = readFixture();
    f.setAccount({ id: "merchant", enabled: true, invited: true });
    expect(
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 0 })
        .storageId,
    ).toBe("storage-0");
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "order", fileIndex: 3 }),
    ).toThrow();
    expect(() =>
      authorizeDeliveryRead(f.repository, { orderId: "other", fileIndex: 0 }),
    ).toThrow();
  });
});
