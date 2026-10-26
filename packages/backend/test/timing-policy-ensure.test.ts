/**
 * `admission.bind` rejects without an `admissionTimingPolicies` row, and the
 * `timing` provisioning kind only made writing one *possible*. Nothing called it,
 * so a deployed environment had no policy and admission was unreachable.
 *
 * `ensurePreprodTimingPolicy` is that missing operator action. These tests pin
 * the three properties that make it safe to run against a live deployment:
 * it is internal, it is idempotent, and it refuses to overwrite.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { AdmissionContext } from "../../../convex/admissionContext";
import {
  type Row,
  readSurface,
  writeSurface,
} from "../../../convex/orderProjection.double";
import { ensurePreprodTimingPolicy } from "../../../convex/trustedProvisioning";

type Args = Record<string, unknown>;

const provenance = {
  operatorId: "operator-1",
  sourceId: "verified-import",
  evidenceFingerprint: "a".repeat(64),
};
const configured = JSON.stringify([
  { operatorId: provenance.operatorId, sourceId: provenance.sourceId },
]);
const original = process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
afterEach(() => {
  if (original === undefined)
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
  else process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = original;
});

function handler<T>(fn: unknown) {
  return (fn as { _handler: (ctx: AdmissionContext, args: Args) => Promise<T> })
    ._handler;
}
const ensure = handler<string>(ensurePreprodTimingPolicy);

// Handler double: verifies the mutation's own policy, not Convex authorization.
function fixture() {
  process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES = configured;
  const tables: Record<string, Row[]> = Object.fromEntries(
    [
      "trustedProvisioning",
      "trustedProvisioningAudit",
      "admissionTimingPolicies",
    ].map((name) => [name, []]),
  );
  const ctx = {
    scheduler: { runAfter: async () => null },
    auth: { getUserIdentity: async () => null },
    db: {
      ...readSurface(tables),
      ...writeSurface(tables),
      normalizeId: (table: string, id: string) =>
        id.startsWith(`${table}-`) ? id : null,
    },
  } as unknown as AdmissionContext;
  return { ctx, tables };
}

const request = (requestId = "ensure-1") => ({ requestId, provenance });

describe("ensurePreprodTimingPolicy", () => {
  test("is internal and audited", async () => {
    expect(
      (ensurePreprodTimingPolicy as unknown as { isInternal: boolean })
        .isInternal,
    ).toBe(true);
    const { ctx, tables } = fixture();
    const id = await ensure(ctx, request());
    expect(tables.admissionTimingPolicies).toHaveLength(1);
    expect(tables.admissionTimingPolicies[0]).toMatchObject({
      network: "preprod",
      captureSafetyMarginMs: 1000,
    });
    expect(tables.trustedProvisioningAudit).toHaveLength(1);
    expect(tables.trustedProvisioningAudit[0]).toMatchObject({
      requestId: "ensure-1",
      operatorId: provenance.operatorId,
      sourceId: provenance.sourceId,
      evidenceFingerprint: provenance.evidenceFingerprint,
      bindingId: id,
    });
    expect(tables.trustedProvisioning[0]).toMatchObject({
      kind: "timing",
      key: "preprod",
      version: 1,
      status: "active",
      targetId: tables.admissionTimingPolicies[0]._id,
    });
    expect(id).toBe(tables.trustedProvisioning[0]._id);
  });

  test("is idempotent: a second run returns the same row and writes nothing", async () => {
    const { ctx, tables } = fixture();
    const first = await ensure(ctx, request("ensure-1"));
    const second = await ensure(ctx, request("ensure-2"));
    expect(second).toBe(first);
    expect(tables.admissionTimingPolicies).toHaveLength(1);
    expect(tables.trustedProvisioning).toHaveLength(1);
    expect(tables.trustedProvisioningAudit).toHaveLength(1);
  });

  test("returns the same binding id when the original request is replayed", async () => {
    const { ctx, tables } = fixture();
    const first = await ensure(ctx, request("ensure-1"));
    expect(await ensure(ctx, request("ensure-1"))).toBe(first);
    expect(tables.trustedProvisioningAudit).toHaveLength(1);
  });

  test("refuses to overwrite an existing row with a different margin", async () => {
    const { ctx, tables } = fixture();
    await ensure(ctx, request("ensure-1"));
    tables.admissionTimingPolicies[0].captureSafetyMarginMs = 60_000;
    await expect(ensure(ctx, request("ensure-2"))).resolves.toBe(
      tables.trustedProvisioning[0]._id,
    );
    expect(tables.admissionTimingPolicies[0].captureSafetyMarginMs).toBe(
      60_000,
    );
  });

  test("refuses a policy row that was not written through this audited path", async () => {
    const { ctx, tables } = fixture();
    tables.admissionTimingPolicies.push({
      _id: "hand-inserted",
      network: "preprod",
      captureSafetyMarginMs: 1000,
    });
    await expect(ensure(ctx, request())).rejects.toThrow("not provisioned");
    expect(tables.admissionTimingPolicies).toHaveLength(1);
    expect(tables.trustedProvisioning).toHaveLength(0);
  });

  test("refuses a revoked timing binding", async () => {
    const { ctx, tables } = fixture();
    const id = await ensure(ctx, request("ensure-1"));
    const binding = tables.trustedProvisioning[0];
    expect(binding._id).toBe(id);
    binding.status = "revoked";
    await expect(ensure(ctx, request("ensure-2"))).rejects.toThrow(
      "not provisioned",
    );
    expect(tables.admissionTimingPolicies).toHaveLength(1);
  });

  test("fails closed without a configured authority", async () => {
    const { ctx, tables } = fixture();
    delete process.env.MILO_TRUSTED_PROVISIONING_AUTHORITIES;
    await expect(ensure(ctx, request())).rejects.toThrow(
      "configuration required",
    );
    expect(tables.admissionTimingPolicies).toHaveLength(0);
  });

  test("rejects a request id that is already bound to another operation", async () => {
    const { ctx, tables } = fixture();
    tables.trustedProvisioningAudit.push({
      _id: "audit-other",
      requestId: "shared",
      operation: "different-operation",
      ...provenance,
      recordedAt: Date.now(),
      bindingId: "trustedProvisioning-other",
    });
    await expect(
      ensure(ctx, { requestId: "shared", provenance }),
    ).rejects.toThrow("request conflict");
    expect(tables.admissionTimingPolicies).toHaveLength(0);
  });
});
