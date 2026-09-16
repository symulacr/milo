import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { localProvisioningAuthority } from "./convex-local-provisioning-fixtures.mjs";

export async function installCustomerSourceFixtures(root, project) {
  assert.equal(
    path.resolve(project),
    path.resolve(root, ".tools/convex-local/project"),
    "Synthetic customer provider must remain in the isolated clone",
  );
  const adapterPath = path.join(
    project,
    "packages/backend/src/stripe-customer-provisioning.server.ts",
  );
  const adapter = await fs.readFile(adapterPath, "utf8");
  const boundary =
    'import { testStripeClient } from "./stripe-provisioning.server";';
  assert.equal(
    adapter.split(boundary).length,
    2,
    "Expected exactly one provider factory import",
  );
  await fs.copyFile(
    path.join(root, "scripts/convex-local-customer-source-provider.ts"),
    path.join(
      project,
      "packages/backend/src/local-customer-source-provider.ts",
    ),
  );
  await fs.writeFile(
    adapterPath,
    adapter.replace(
      boundary,
      'import { testStripeClient } from "./local-customer-source-provider";',
    ),
  );
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function expectedCommit(input) {
  const value = {
    buyerAccountId: input.buyerAccountId,
    stripeAccountId: input.stripeAccountId,
    stripeCustomerId: input.stripeCustomerId,
  };
  return {
    requestId: input.requestId,
    provenance: {
      operatorId: input.operatorId,
      sourceId: input.sourceId,
      evidenceFingerprint: createHash("sha256")
        .update(
          canonical({
            domain: "milo.stripe-test-customer-provider-facts",
            version: 1,
            stripeAccountId: input.stripeAccountId,
            stripeCustomerId: input.stripeCustomerId,
            deleted: false,
            livemode: false,
            buyerMapping: {
              authority: "operator-asserted",
              buyerAccountId: input.buyerAccountId,
            },
          }),
        )
        .digest("hex"),
    },
    payload: { kind: "customer", value },
  };
}

export async function verifyCustomerSource({
  admin,
  url,
  stopBackend,
  startBackend,
  setAuthorities,
}) {
  const endpoint = "stripeCustomerProvisioning:provision";
  const tables = [
    "stripeCustomers",
    "trustedProvisioning",
    "trustedProvisioningAudit",
    "memberships",
    "approvedQuotes",
    "frozenQuotes",
    "paymentIntents",
    "paymentJobs",
    "paymentMonitors",
    "paymentObservations",
    "deploymentObservations",
    "admissionTimingPolicies",
    "canonicalBindings",
  ];
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          await admin.query("localVerification:rows", { table }),
        ]),
      ),
    );
  const input = (kind = "Valid") => {
    const id = randomUUID().replaceAll("-", "");
    return {
      requestId: `customer-source-${id}`,
      ...localProvisioningAuthority,
      buyerAccountId: `synthetic-customer-source-${id}`,
      stripeAccountId: "acct_SyntheticCustomerSource",
      stripeCustomerId: `cus_${kind}${id}`,
    };
  };
  const action = (args) => admin.action(endpoint, args);
  const report = {
    scope:
      "Synthetic read-only provider facts through the real internal Node action, adapter validation and protected mutation; not owner proof, buyer authorization, live Stripe or hosted evidence",
    onlyOneCopiedProviderFactoryImportOverridden: true,
    authenticationScope:
      "Anonymous non-admin transport only; admin impersonation retains internal authority and is not a non-admin JWT test",
    cases: [],
  };
  const noWrites = async (name, operation, pattern) => {
    const before = await snapshot();
    await assert.rejects(operation, pattern);
    assert.deepEqual(await snapshot(), before, `${name} wrote rows`);
    report.cases.push(name);
  };
  const anonymous = new ConvexHttpClient(url, { logger: false });
  await noWrites("anonymous-internal-action-inaccessible", () =>
    anonymous.action(endpoint, input()),
  );
  await noWrites(
    "unallowlisted-source",
    () => action({ ...input(), sourceId: "unallowlisted-source" }),
    /Allowlisted operator\/source/,
  );
  for (const kind of ["Mismatch", "Live", "Deleted", "ProviderError"])
    await noWrites(
      `${kind}-no-writes`,
      () => action(input(kind)),
      /Stripe test customer facts unavailable/,
    );
  await noWrites(
    "account-mismatch-no-writes",
    () => action({ ...input(), stripeAccountId: "acct_WrongAccount" }),
    /Stripe test customer facts unavailable/,
  );
  await noWrites(
    "invalid-identifiers-no-writes",
    () => action({ ...input(), stripeCustomerId: "not-a-customer" }),
    /Invalid trusted customer fact identifiers/,
  );
  await noWrites("caller-evidence-rejected-by-action-validator", () =>
    action({ ...input(), evidenceFingerprint: "a".repeat(64) }),
  );

  const request = input();
  const before = await snapshot();
  const ids = await Promise.all(
    Array.from({ length: 4 }, () => action(request)),
  );
  assert.equal(new Set(ids).size, 1);
  const persisted = await snapshot();
  const delta = (table) =>
    persisted[table].filter(
      (row) => !before[table].some((old) => old._id === row._id),
    );
  const [target] = delta("stripeCustomers");
  const [binding] = delta("trustedProvisioning");
  const [audit] = delta("trustedProvisioningAudit");
  for (const table of tables) {
    if (
      [
        "stripeCustomers",
        "trustedProvisioning",
        "trustedProvisioningAudit",
      ].includes(table)
    ) {
      assert.equal(delta(table).length, 1);
      assert.deepEqual(
        persisted[table].filter((row) =>
          before[table].some((old) => old._id === row._id),
        ),
        before[table],
      );
    } else assert.deepEqual(persisted[table], before[table]);
  }
  const commit = expectedCommit(request);
  const stripSystem = ({ _id, _creationTime, ...row }) => row;
  assert.deepEqual(stripSystem(target), commit.payload.value);
  assert.equal(binding._id, ids[0]);
  assert.equal(binding.targetId, target._id);
  assert.equal(binding.payload, canonical(commit.payload));
  assert.equal(binding.kind, "customer");
  assert.equal(binding.status, "active");
  assert.equal(binding.version, 1);
  assert.deepEqual(stripSystem(audit), {
    requestId: request.requestId,
    operation: canonical({
      action: "provision",
      payload: commit.payload,
      provenance: commit.provenance,
    }),
    ...commit.provenance,
    recordedAt: audit.recordedAt,
    bindingId: binding._id,
  });
  assert.ok(Number.isFinite(audit.recordedAt));
  assert.ok(
    !JSON.stringify([target, binding, audit]).includes(
      "synthetic-provider-private",
    ),
  );
  report.cases.push(
    "four-concurrent-same-request-actions-one-target-binding-audit",
    "exact-minimal-target-audit-and-derived-evidence-no-sensitive-provider-metadata",
  );

  await noWrites(
    "competing-buyer-mapping-conflict",
    () => action({ ...input(), stripeCustomerId: request.stripeCustomerId }),
    /Stripe customer already bound/,
  );
  await noWrites(
    "existing-buyer-cannot-rebind",
    () => action({ ...input(), buyerAccountId: request.buyerAccountId }),
    /Immutable binding conflict/,
  );
  await noWrites(
    "same-request-changed-mapping-conflict",
    () =>
      action({ ...request, buyerAccountId: `${request.buyerAccountId}-other` }),
    /Provisioning request conflict/,
  );
  await stopBackend();
  await startBackend();
  assert.deepEqual(await snapshot(), persisted);
  assert.equal(await action(request), binding._id);
  assert.deepEqual(await snapshot(), persisted);
  report.cases.push(
    "owned-native-restart-persists-target-binding-audit-and-idempotent-action-retry",
  );

  await admin.mutation("trustedProvisioning:revoke", {
    requestId: `${request.requestId}-revoke`,
    provenance: commit.provenance,
    bindingId: binding._id,
    expectedVersion: 1,
  });
  await noWrites(
    "revoked-binding-original-action-retry-rejected",
    () => action(request),
    /Trusted provisioning revoked/,
  );
  const revoked = await snapshot();
  await stopBackend();
  await startBackend();
  assert.deepEqual(await snapshot(), revoked);
  await noWrites(
    "revocation-persists-after-native-restart",
    () => action(request),
    /Trusted provisioning revoked/,
  );
  try {
    await setAuthorities([]);
    await noWrites(
      "removed-source-action-rejected",
      () => action(input()),
      /Allowlisted operator\/source/,
    );
    await noWrites(
      "removed-source-protected-mutation-rechecks-derived-commit",
      () =>
        admin.mutation(
          "trustedProvisioning:provision",
          expectedCommit(input()),
        ),
      /Allowlisted operator\/source/,
    );
  } finally {
    await setAuthorities([localProvisioningAuthority]);
  }
  report.allowlistRemovalScope =
    "Action and final protected mutation tested separately after removal; not an in-flight provider/commit race";
  return report;
}
