import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import {
  installCustomerSourceFixtures,
  verifyCustomerSource,
} from "./convex-local-customer-source-verify.mjs";
import {
  installMonitorFixtures,
  verifyMonitorScheduler,
} from "./convex-local-monitor-verify.mjs";
import {
  localProvisioningAuthority,
  provisioningFixtures,
} from "./convex-local-provisioning-fixtures.mjs";

const customerSource = process.argv.includes("--customer-source");
const monitorStart = process.argv.includes("--monitor")
  ? "paymentMonitoring:start"
  : undefined;
const monitorStop = process.argv.includes("--monitor")
  ? "paymentMonitoring:stop"
  : undefined;
assert.equal(
  Boolean(monitorStart),
  Boolean(monitorStop),
  "Supply both production monitor endpoints",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules/convex/bin/main.js");
const cliVersion = "1.45.0";
// Official version.convex.dev response for npm-cli-1.45.0; never resolve latest at runtime.
const backendVersion = "precompiled-2026-08-25-7cce8fb";
const backendSha256 =
  "97bab85225a860dfd5e9039d9899d76bd419ddc8d863a313f289992b25e82df9";
const backendArtifactUrl = `https://github.com/get-convex/convex-backend/releases/download/${backendVersion}/convex-local-backend-x86_64-unknown-linux-gnu.zip`;
const tools = path.join(root, ".tools/convex-local");
const home = path.join(tools, "home");
const project = path.join(tools, "project");
const state = path.join(project, ".convex/local/default");
const env = {
  PATH: process.env.PATH,
  HOME: home,
  TMPDIR: process.env.TMPDIR || "/tmp",
  CONVEX_AGENT_MODE: "anonymous",
  DO_NOT_TRACK: "1",
  CI: "1",
};
const installed = JSON.parse(
  await fs.readFile(path.join(root, "node_modules/convex/package.json")),
);
assert.equal(installed.version, cliVersion);
assert.equal(
  `${process.platform}/${process.arch}`,
  "linux/x64",
  "Pinned native artifact is Linux x64",
);
const originalEnv = await fs
  .readFile(path.join(root, ".env.local"))
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
await fs.mkdir(home, { recursive: true });
await fs.mkdir(project, { recursive: true });
await fs.chmod(tools, 0o700);
const lock = await fs.open(path.join(tools, "running.lock"), "wx");
let backend;
let interrupted = false;
let cleanupPromise;
const children = new Set();
const terminations = new WeakMap();
function ownedSpawn(executable, args, options) {
  assert.ok(!interrupted, "Local verification interrupted");
  const child = spawn(executable, args, { ...options, detached: true });
  children.add(child);
  return child;
}
function terminate(child) {
  if (!child) return Promise.resolve();
  if (!terminations.has(child)) terminations.set(child, terminateGroup(child));
  return terminations.get(child);
}
async function terminateGroup(child) {
  if (!child?.pid) return;
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      return false;
    }
  };
  // Only groups created by this harness; includes the CLI's native child.
  if (signalGroup("SIGTERM")) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!signalGroup(0)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (signalGroup(0)) signalGroup("SIGKILL");
  }
  children.delete(child);
}
function cleanup() {
  cleanupPromise ??= (async () => {
    await Promise.all([...children].map(terminate));
    await lock.close();
    await fs.unlink(path.join(tools, "running.lock"));
  })();
  return cleanupPromise;
}
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    interrupted = true;
    void cleanup().then(
      () => process.exit(code),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
}
async function command(args, extraEnv = {}) {
  const child = ownedSpawn(process.execPath, [cli, ...args], {
    cwd: project,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const [code] = await once(child, "exit");
  await terminate(child);
  assert.equal(code, 0, `Convex ${args[0]} failed`);
}
async function stop() {
  await terminate(backend);
  backend = undefined;
}
try {
  await fs.rm(path.join(tools, "verification.json"), { force: true });
  const binary = path.join(
    home,
    ".cache/convex/binaries",
    backendVersion,
    "convex-local-backend",
  );
  let bytes = await fs.readFile(binary).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (bytes === null) {
    const response = await fetch(backendArtifactUrl);
    assert.ok(response.ok, `Backend download failed: ${response.status}`);
    const archive = path.join(tools, "backend.zip");
    const extracted = path.join(tools, "backend.unverified");
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()), {
      mode: 0o600,
    });
    // Read one exact ZIP member, never extract archive-controlled filesystem paths.
    const child = ownedSpawn(
      "python3",
      [
        "-c",
        "import pathlib,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n entries=[i for i in z.infolist() if i.filename == 'convex-local-backend']\n assert len(entries) == 1 and not entries[0].is_dir()\n pathlib.Path(sys.argv[2]).write_bytes(z.read(entries[0]))",
        archive,
        extracted,
      ],
      { cwd: project, env, stdio: "inherit" },
    );
    const [code] = await once(child, "exit");
    await terminate(child);
    assert.equal(code, 0, "Backend ZIP extraction failed");
    bytes = await fs.readFile(extracted);
    await fs.rm(extracted);
    await fs.rm(archive);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    sha256,
    backendSha256,
    "Official native backend artifact changed",
  );
  await fs.mkdir(path.dirname(binary), { recursive: true });
  const verifiedBinary = `${binary}.verified`;
  await fs.writeFile(verifiedBinary, bytes, { mode: 0o700 });
  await fs.chmod(verifiedBinary, 0o700);
  await fs.rename(verifiedBinary, binary);
  console.log("Pinned native backend checksum verified before execution");
  // Refuse a repurposed sandbox before the CLI can select any deployment.
  for (const name of [".env", ".env.local"]) {
    const contents = await fs
      .readFile(path.join(project, name), "utf8")
      .catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return "";
      });
    assert.ok(
      !/^\s*CONVEX_(?:DEPLOY_KEY|SELF_HOSTED_URL|SELF_HOSTED_ADMIN_KEY)\s*=/m.test(
        contents,
      ),
      "Unexpected deployment credentials in isolated project",
    );
    for (const match of contents.matchAll(
      /^\s*CONVEX_DEPLOYMENT\s*=\s*([^\r\n]*)/gm,
    )) {
      assert.match(
        match[1],
        /^anonymous:/,
        "Only anonymous local deployment selection is allowed",
      );
    }
  }
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({ private: true, dependencies: { convex: cliVersion } }),
  );
  await fs
    .symlink(
      path.join(root, "node_modules"),
      path.join(project, "node_modules"),
    )
    .catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  const tsconfig = JSON.parse(
    await fs.readFile(path.join(root, "tsconfig.json")),
  );
  tsconfig.include = ["convex/**/*.ts"];
  await fs.writeFile(
    path.join(project, "tsconfig.json"),
    JSON.stringify(tsconfig),
  );
  await fs.writeFile(
    path.join(project, "convex.json"),
    JSON.stringify({ functions: "convex/" }),
  );
  // Bootstrap without auth.config so the deployment environment can be set first.
  await fs.rm(path.join(project, "convex"), { recursive: true, force: true });
  await fs.mkdir(path.join(project, "convex"));
  await fs.copyFile(
    path.join(root, "convex/tsconfig.json"),
    path.join(project, "convex/tsconfig.json"),
  );
  await fs.writeFile(path.join(project, "convex/bootstrap.ts"), "export {};\n");
  await command([
    "dev",
    "--once",
    "--local-backend-version",
    backendVersion,
    "--typecheck",
    "enable",
  ]);
  const config = JSON.parse(await fs.readFile(path.join(state, "config.json")));
  assert.equal(config.backendVersion, backendVersion);
  assert.ok(config.deploymentName.startsWith("anonymous-"));
  const url = `http://127.0.0.1:${config.ports.cloud}`;
  const localEnv = {
    CONVEX_SELF_HOSTED_URL: url,
    CONVEX_SELF_HOSTED_ADMIN_KEY: config.adminKey,
  };
  // An explicit env-file suppresses the anonymous .env.local for this local process.
  await fs.writeFile(
    path.join(project, "local-only.env"),
    Object.entries(localEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    { mode: 0o600 },
  );
  async function start() {
    backend = ownedSpawn(
      binary,
      [
        "--interface",
        "127.0.0.1",
        "--port",
        String(config.ports.cloud),
        "--site-proxy-port",
        String(config.ports.site),
        "--instance-name",
        config.deploymentName,
        "--instance-secret",
        config.instanceSecret,
        "--local-storage",
        path.join(state, "convex_local_storage"),
        path.join(state, "convex_local_backend.sqlite3"),
      ],
      { cwd: project, env, stdio: "ignore" },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(
        backend.exitCode,
        null,
        "Native backend exited during startup",
      );
      try {
        if ((await fetch(`${url}/version`)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Native backend startup timed out");
  }
  await start();
  await command(
    [
      "env",
      "set",
      "MILO_TRUSTED_PROVISIONING_AUTHORITIES",
      JSON.stringify([localProvisioningAuthority]),
      "--env-file",
      "local-only.env",
    ],
    localEnv,
  );
  await command(
    [
      "env",
      "set",
      "PRIVY_APP_ID",
      "local-convex-verification",
      "--env-file",
      "local-only.env",
    ],
    localEnv,
  );
  await fs.rm(path.join(project, "convex"), { recursive: true, force: true });
  await fs.cp(path.join(root, "convex"), path.join(project, "convex"), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(root, "scripts/convex-local-fixtures.ts"),
    path.join(project, "convex/localVerification.ts"),
  );
  await fs.rm(path.join(project, "packages"), { recursive: true, force: true });
  await fs.cp(
    path.join(root, "packages/backend/src"),
    path.join(project, "packages/backend/src"),
    { recursive: true },
  );
  await fs.cp(
    path.join(root, "packages/domain/src"),
    path.join(project, "packages/domain/src"),
    { recursive: true },
  );
  if (monitorStart) await installMonitorFixtures(root, project);
  if (customerSource) await installCustomerSourceFixtures(root, project);
  await command(
    [
      "deploy",
      "--yes",
      "--typecheck",
      "enable",
      "--env-file",
      "local-only.env",
    ],
    localEnv,
  );
  const client = new ConvexHttpClient(url, { logger: false });
  await assert.rejects(
    client.query("auth/session:current", {}),
    /Authenticated Privy identity required/,
  );
  const invalidJwtClient = new ConvexHttpClient(url, { logger: false });
  invalidJwtClient.setAuth("invalid.local.jwt");
  await assert.rejects(invalidJwtClient.query("auth/session:current", {}));
  const admin = new ConvexHttpClient(url, { logger: false });
  admin.setAdminAuth(config.adminKey);
  const subject = `did:privy:local_${randomUUID()}`;
  const fixture = {
    privySubject: subject,
    accountId: "local-buyer",
    scopeId: "local-verification",
    role: "buyer",
    status: "active",
  };
  await assert.rejects(
    client.mutation("localVerification:seed", {
      table: "memberships",
      document: fixture,
    }),
  );
  const membershipId = await admin.mutation("localVerification:seed", {
    table: "memberships",
    document: fixture,
  });
  const actingAs = new ConvexHttpClient(url, { logger: false });
  actingAs.setAdminAuth(config.adminKey, { issuer: "privy.io", subject });
  assert.deepEqual(await actingAs.query("auth/session:current", {}), {
    subject,
  });
  const inputs = await admin.mutation("localVerification:admissionFixture", {
    runId: randomUUID(),
    accountId: fixture.accountId,
    scopeId: fixture.scopeId,
  });
  await assert.rejects(
    client.mutation("admission:bind", inputs[0]),
    /Authenticated Privy identity required/,
  );
  const outsider = new ConvexHttpClient(url, { logger: false });
  outsider.setAdminAuth(config.adminKey, {
    issuer: "privy.io",
    subject: `did:privy:outsider_${randomUUID()}`,
  });
  await assert.rejects(
    outsider.mutation("admission:bind", inputs[0]),
    /Active membership required/,
  );
  assert.deepEqual(
    await actingAs.mutation("admission:bind", {
      ...inputs[0],
      expectedQuoteVersion: 2,
    }),
    { kind: "rejected", reason: "frozen quote version changed" },
  );
  // Separate clients avoid the HTTP client's per-client mutation queue.
  const outcomes = await Promise.all(
    Array.from({ length: 16 }, (_, index) => {
      const concurrent = new ConvexHttpClient(url, { logger: false });
      concurrent.setAdminAuth(config.adminKey, { issuer: "privy.io", subject });
      return concurrent.mutation("admission:bind", inputs[index % 2]);
    }),
  );
  assert.equal(
    outcomes.filter((result) => result.kind === "bound").length,
    1,
    JSON.stringify(outcomes),
  );
  assert.equal(
    outcomes.filter((result) => result.kind === "already-bound").length,
    7,
  );
  assert.equal(
    outcomes.filter((result) => result.kind === "rejected").length,
    8,
  );
  const winner = outcomes.find((result) => result.kind === "bound").binding;
  const persistedBindings = (
    await admin.query("localVerification:rows", {
      table: "canonicalBindings",
    })
  ).filter((row) => row.quoteId === inputs[0].quoteId);
  assert.equal(persistedBindings.length, 1);
  assert.equal(persistedBindings[0].address, winner.address);
  const provisioning = provisioningFixtures(randomUUID());
  const tables = [
    "trustedProvisioning",
    "trustedProvisioningAudit",
    "memberships",
    "stripeCustomers",
    "approvedQuotes",
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
  const beforeProvisioning = await snapshot();
  const constructorQuote = provisioning.find(
    (args) => args.payload.kind === "quote",
  );
  const invalidConstructors = [
    { constructorVersion: 2 },
    { constructorEncoding: "unsupported" },
    { buyerCommitment: "0".repeat(64) },
    { merchantCommitment: constructorQuote.payload.value.buyerCommitment },
    { operatorCommitment: "short" },
    { nonce: "legacy-nonce" },
    { rolesFingerprint: "a".repeat(64) },
    { initialStateFingerprint: "a".repeat(64) },
    { buyerSecret: "must-not-be-persisted" },
  ];
  for (const patch of invalidConstructors) {
    const args = structuredClone(constructorQuote);
    args.requestId = randomUUID();
    Object.assign(args.payload.value, patch);
    await assert.rejects(admin.mutation("trustedProvisioning:provision", args));
    assert.deepEqual(await snapshot(), beforeProvisioning);
  }
  for (const key of [
    "constructorVersion",
    "constructorEncoding",
    "buyerCommitment",
    "merchantCommitment",
    "operatorCommitment",
  ]) {
    const args = structuredClone(constructorQuote);
    args.requestId = randomUUID();
    delete args.payload.value[key];
    await assert.rejects(admin.mutation("trustedProvisioning:provision", args));
    assert.deepEqual(await snapshot(), beforeProvisioning);
  }
  const provisioningIds = [];
  let provisioningConflicts = 0;
  for (const args of provisioning) {
    await assert.rejects(
      client.mutation("trustedProvisioning:provision", args),
      /internal|public/i,
    );
    await assert.rejects(
      admin.mutation("trustedProvisioning:provision", {
        ...args,
        provenance: { ...args.provenance, sourceId: "untrusted-local-source" },
      }),
      /Allowlisted operator/,
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, () => {
        const connection = new ConvexHttpClient(url, { logger: false });
        connection.setAdminAuth(config.adminKey);
        return connection.mutation("trustedProvisioning:provision", args);
      }),
    );
    assert.equal(new Set(results).size, 1);
    provisioningIds.push(results[0]);
    const changed = structuredClone(args);
    if (changed.payload.kind === "membership")
      changed.payload.value.role = "merchant";
    if (changed.payload.kind === "customer")
      changed.payload.value.stripeCustomerId += "Other";
    if (changed.payload.kind === "quote") changed.payload.value.version += 1;
    await assert.rejects(
      admin.mutation("trustedProvisioning:provision", changed),
      /Provisioning request conflict/,
    );
    const conflicting = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) => {
        const connection = new ConvexHttpClient(url, { logger: false });
        connection.setAdminAuth(config.adminKey);
        return connection.mutation("trustedProvisioning:provision", {
          ...changed,
          requestId: `${args.requestId}-conflict-${index}`,
        });
      }),
    );
    for (const result of conflicting) {
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /Immutable binding conflict/);
      provisioningConflicts++;
    }
    await assert.rejects(
      admin.mutation("trustedProvisioning:provision", {
        ...args,
        requestId: `${args.requestId}-duplicate`,
      }),
      /reuse original request/,
    );
  }
  const activeProvisioning = await snapshot();
  for (const table of tables) {
    assert.equal(
      activeProvisioning[table].length - beforeProvisioning[table].length,
      table.startsWith("trustedProvisioning") ? 3 : 1,
    );
  }
  const revocations = [];
  const freezeSubject = provisioning.find(
    (args) => args.payload.kind === "membership",
  ).payload.value.privySubject;
  const freezeInput = {
    quoteId: constructorQuote.payload.value.id,
    expectedVersion: constructorQuote.payload.value.version,
  };
  const freezeResults = await Promise.all(
    Array.from({ length: 8 }, () => {
      const connection = new ConvexHttpClient(url, { logger: false });
      connection.setAdminAuth(config.adminKey, {
        issuer: "privy.io",
        subject: freezeSubject,
      });
      return connection.mutation("provisioning:freeze", freezeInput);
    }),
  );
  assert.equal(new Set(freezeResults).size, 1);
  const frozenRows = async () =>
    (
      await admin.query("localVerification:rows", { table: "frozenQuotes" })
    ).filter((row) => row.id === freezeInput.quoteId);
  const frozenBeforeRestart = await frozenRows();
  assert.equal(frozenBeforeRestart.length, 1);
  const {
    _id: frozenId,
    _creationTime: frozenTime,
    ...frozenValue
  } = frozenBeforeRestart[0];
  const {
    expiresAt: approvedExpiry,
    imagePackPolicy: approvedPack,
    ...expectedFrozen
  } = constructorQuote.payload.value;
  assert.deepEqual(frozenValue, expectedFrozen);
  await stop();
  await start();
  const reloadedFrozenRows = await frozenRows();
  assert.deepEqual(reloadedFrozenRows, frozenBeforeRestart);
  // Keep generated-contract runtime identity inside the isolated SDK process.
  const constructorParity = ownedSpawn(
    path.join(root, ".tools/node-runtime/node-v24.20.0-linux-x64/bin/node"),
    [
      path.join(
        root,
        "packages/integration/src/verify-persisted-constructor.mjs",
      ),
    ],
    {
      cwd: root,
      env: { PATH: process.env.PATH },
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  const constructorParityExit = once(constructorParity, "exit");
  constructorParity.stdin.end(JSON.stringify(reloadedFrozenRows[0]));
  assert.equal(
    (await constructorParityExit)[0],
    0,
    "Reloaded Preprod constructor parity failed",
  );
  const freezeReplay = new ConvexHttpClient(url, { logger: false });
  freezeReplay.setAdminAuth(config.adminKey, {
    issuer: "privy.io",
    subject: freezeSubject,
  });
  assert.equal(
    await freezeReplay.mutation("provisioning:freeze", freezeInput),
    freezeResults[0],
  );
  assert.deepEqual(await frozenRows(), frozenBeforeRestart);
  for (const [index, args] of provisioning.entries()) {
    const binding = activeProvisioning.trustedProvisioning.find(
      (row) => row._id === provisioningIds[index],
    );
    assert.equal(binding.status, "active");
    assert.equal(binding.version, args.payload.kind === "quote" ? 3 : 1);
    const table = {
      membership: "memberships",
      customer: "stripeCustomers",
      quote: "approvedQuotes",
    }[args.payload.kind];
    const target = activeProvisioning[table].find(
      (row) => row._id === binding.targetId,
    );
    const { _id, _creationTime, ...value } = target;
    assert.deepEqual(
      value,
      args.payload.kind === "membership"
        ? { ...args.payload.value, status: "active" }
        : args.payload.value,
    );
    const revoke = {
      requestId: `${args.requestId}-revoke`,
      provenance: args.provenance,
      bindingId: binding._id,
      expectedVersion: binding.version,
    };
    revocations.push(revoke);
    await assert.rejects(
      client.mutation("trustedProvisioning:revoke", revoke),
      /internal|public/i,
    );
    await assert.rejects(
      admin.mutation("trustedProvisioning:revoke", {
        ...revoke,
        expectedVersion: binding.version + 1,
      }),
      /Binding version required/,
    );
    const revokeResults = await Promise.all(
      Array.from({ length: 8 }, () => {
        const connection = new ConvexHttpClient(url, { logger: false });
        connection.setAdminAuth(config.adminKey);
        return connection.mutation("trustedProvisioning:revoke", revoke);
      }),
    );
    assert.deepEqual(revokeResults, Array(8).fill(null));
    await assert.rejects(
      admin.mutation("trustedProvisioning:revoke", {
        ...revoke,
        requestId: `${revoke.requestId}-again`,
      }),
      /already revoked/,
    );
    await assert.rejects(
      admin.mutation("trustedProvisioning:provision", {
        ...args,
        requestId: `${args.requestId}-reactivate`,
      }),
      /reuse original request/,
    );
  }
  const persistedProvisioning = await snapshot();
  assert.equal(
    persistedProvisioning.trustedProvisioningAudit.length -
      beforeProvisioning.trustedProvisioningAudit.length,
    6,
  );
  for (const [index, args] of provisioning.entries()) {
    const audit = persistedProvisioning.trustedProvisioningAudit.filter(
      (row) => row.bindingId === provisioningIds[index],
    );
    assert.equal(audit.length, 2);
    assert.deepEqual(
      audit.map((row) => row.requestId).sort(),
      [args.requestId, revocations[index].requestId].sort(),
    );
    for (const row of audit) {
      for (const [key, value] of Object.entries(args.provenance))
        assert.equal(row[key], value);
      assert.ok(Number.isSafeInteger(row.recordedAt));
    }
  }
  for (const table of tables.filter(
    (table) => table !== "trustedProvisioningAudit",
  )) {
    assert.deepEqual(
      persistedProvisioning[table],
      activeProvisioning[table].map((row) =>
        provisioningIds.includes(row._id) ||
        (table === "memberships" &&
          activeProvisioning.trustedProvisioning.some(
            (binding) =>
              provisioningIds.includes(binding._id) &&
              binding.targetId === row._id,
          ))
          ? { ...row, status: "revoked" }
          : row,
      ),
    );
  }
  await assert.rejects(
    client.query("localVerification:rows", {
      table: "trustedProvisioningAudit",
    }),
    /internal|public/i,
  );
  const firstWriteRaces = [];
  for (const original of provisioningFixtures(randomUUID())) {
    const contender = structuredClone(original);
    contender.requestId += "-contender";
    if (contender.payload.kind === "membership")
      contender.payload.value.role = "merchant";
    if (contender.payload.kind === "customer")
      contender.payload.value.stripeCustomerId += "Other";
    if (contender.payload.kind === "quote")
      contender.payload.value.version += 1;
    const kind = original.payload.kind;
    const key =
      kind === "membership"
        ? JSON.stringify([
            original.payload.value.privySubject,
            original.payload.value.scopeId,
          ])
        : kind === "quote"
          ? original.payload.value.id
          : original.payload.value.buyerAccountId;
    const table = {
      membership: "memberships",
      customer: "stripeCustomers",
      quote: "approvedQuotes",
    }[kind];
    const before = await snapshot();
    assert.equal(
      before.trustedProvisioning.filter(
        (row) => row.kind === kind && row.key === key,
      ).length,
      0,
    );
    assert.equal(
      before[table].filter((row) =>
        kind === "membership"
          ? row.privySubject === original.payload.value.privySubject &&
            row.scopeId === original.payload.value.scopeId
          : kind === "quote"
            ? row.id === key
            : row.buyerAccountId === key,
      ).length,
      0,
    );
    const requests = [original, contender];
    // Independent HTTP clients submit different payloads before either binding exists.
    const results = await Promise.allSettled(
      requests.map((args) => {
        const connection = new ConvexHttpClient(url, { logger: false });
        connection.setAdminAuth(config.adminKey);
        return connection.mutation("trustedProvisioning:provision", args);
      }),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    const loserIndex = 1 - winnerIndex;
    assert.match(
      results[loserIndex].reason.message,
      /Immutable binding conflict/,
    );
    const winner = requests[winnerIndex];
    const after = await snapshot();
    for (const name of tables)
      assert.equal(
        after[name].length - before[name].length,
        name === table || name.startsWith("trustedProvisioning") ? 1 : 0,
      );
    const bindings = after.trustedProvisioning.filter(
      (row) => row.kind === kind && row.key === key,
    );
    assert.equal(bindings.length, 1);
    const binding = bindings[0];
    assert.equal(binding._id, results[winnerIndex].value);
    assert.equal(binding.status, "active");
    assert.equal(
      binding.version,
      kind === "quote" ? winner.payload.value.version : 1,
    );
    assert.deepEqual(JSON.parse(binding.payload), winner.payload);
    const { _id, _creationTime, ...target } = after[table].find(
      (row) => row._id === binding.targetId,
    );
    assert.deepEqual(
      target,
      kind === "membership"
        ? { ...winner.payload.value, status: "active" }
        : winner.payload.value,
    );
    const audit = after.trustedProvisioningAudit.filter(
      (row) => row.bindingId === binding._id,
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].requestId, winner.requestId);
    assert.deepEqual(JSON.parse(audit[0].operation), {
      action: "provision",
      payload: winner.payload,
      provenance: winner.provenance,
    });
    for (const [name, value] of Object.entries(winner.provenance))
      assert.equal(audit[0][name], value);
    assert.equal(
      after.trustedProvisioningAudit.filter(
        (row) => row.requestId === requests[loserIndex].requestId,
      ).length,
      0,
    );
    firstWriteRaces.push({
      kind,
      winner,
      loser: requests[loserIndex],
      bindingId: binding._id,
    });
  }
  const persistedAllProvisioning = await snapshot();
  const report = {
    verifiedAt: new Date().toISOString(),
    cliVersion,
    backendVersion,
    backendArtifactUrl,
    sha256,
    checksumVerifiedBeforeExecution: true,
    url,
    generatedCodeAndTypecheck: true,
    authConfigPushed: true,
    anonymousSessionDenied: true,
    malformedJwtDenied: true,
    localAdminIdentityFixture: true,
    fixtureMutationNotPublic: true,
    privyJwtVerified: false,
    anonymousAdmissionDenied: true,
    missingMembershipDenied: true,
    staleQuoteVersionRejected: true,
    concurrentAdmissionRequests: outcomes.length,
    concurrentAdmissionSingleWinner: true,
    concurrentAdmissionIdempotentReplays: 7,
    concurrentAdmissionConflictsRejected: 8,
    canonicalBindingRows: persistedBindings.length,
    observerFixturesAreSynthetic: true,
    internalProvisioning: {
      nativeDatabase: true,
      syntheticFixtureProvenance: localProvisioningAuthority,
      allowlistConfiguredOnLoopbackOnly: true,
      realSourceAuthenticationVerified: false,
      evidenceAttestationVerified: false,
      kinds: provisioning.map((args) => args.payload.kind),
      concurrentRequests: 24,
      bindingRowsCreated: 3,
      idempotentReplays: 21,
      concurrentImmutableConflictsRejected: provisioningConflicts,
      requestConflictsRejected: 3,
      nonAdminInternalAccessDenied: true,
      immutableTargetsVerified: true,
      staleRevocationVersionsRejected: 3,
      revokedBindings: 3,
      auditRowsCreated: 6,
      concurrentIdenticalRevocationRequests: 24,
      concurrentIdenticalRevocationReplays: 21,
      concurrentIdenticalRevocationAuditRows: 3,
      competingFirstWriteRaces: firstWriteRaces.length,
      competingFirstWriteRequests: firstWriteRaces.length * 2,
      competingFirstWriteWinners: firstWriteRaces.length,
      competingFirstWriteLosersRejected: firstWriteRaces.length,
      competingFirstWriteTargetBindingAndAuditVerified: true,
      totalBindingRowsCreated:
        persistedAllProvisioning.trustedProvisioning.length -
        beforeProvisioning.trustedProvisioning.length,
      totalAuditRowsCreated:
        persistedAllProvisioning.trustedProvisioningAudit.length -
        beforeProvisioning.trustedProvisioningAudit.length,
    },
  };
  await stop();
  await start();
  await assert.rejects(
    client.query("auth/session:current", {}),
    /Authenticated Privy identity required/,
  );
  report.nativeRestartPreservedFunctions = true;
  const rows = await admin.query("localVerification:rows", {
    table: "memberships",
  });
  assert.equal(
    rows.find((row) => row._id === membershipId)?.privySubject,
    subject,
  );
  report.nativeRestartPreservedMembership = true;
  const restartedBindings = (
    await admin.query("localVerification:rows", {
      table: "canonicalBindings",
    })
  ).filter((row) => row.quoteId === inputs[0].quoteId);
  assert.deepEqual(restartedBindings, persistedBindings);
  report.nativeRestartPreservedCanonicalBinding = true;
  assert.deepEqual(await snapshot(), persistedAllProvisioning);
  for (const race of firstWriteRaces) {
    assert.equal(
      await admin.mutation("trustedProvisioning:provision", race.winner),
      race.bindingId,
    );
    await assert.rejects(
      admin.mutation("trustedProvisioning:provision", race.loser),
      /Immutable binding conflict/,
    );
  }
  for (const [index, args] of provisioning.entries()) {
    await assert.rejects(
      admin.mutation("trustedProvisioning:provision", args),
      /Trusted provisioning revoked/,
    );
    await admin.mutation("trustedProvisioning:revoke", revocations[index]);
  }
  assert.deepEqual(await snapshot(), persistedAllProvisioning);
  report.internalProvisioning.nativeRestartPreservedFirstWriteWinnersAndRejectedLosers = true;
  report.internalProvisioning.nativeRestartPreservedTargetsBindingsAndAudit = true;
  report.internalProvisioning.nativeRestartReplaysAddedNoRows = true;
  if (monitorStart) {
    report.paymentMonitoring = await verifyMonitorScheduler({
      admin,
      url,
      adminKey: config.adminKey,
      startEndpoint: monitorStart,
      stopEndpoint: monitorStop,
      stopBackend: stop,
      startBackend: start,
    });
  }
  if (customerSource) {
    report.customerSource = await verifyCustomerSource({
      admin,
      url,
      stopBackend: stop,
      startBackend: start,
      setAuthorities: (authorities) =>
        command(
          [
            "env",
            "set",
            "MILO_TRUSTED_PROVISIONING_AUTHORITIES",
            JSON.stringify(authorities),
            "--env-file",
            "local-only.env",
          ],
          localEnv,
        ),
    });
  }
  const finalEnv = await fs
    .readFile(path.join(root, ".env.local"))
    .catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
  assert.ok(
    originalEnv === null
      ? finalEnv === null
      : finalEnv !== null && originalEnv.equals(finalEnv),
    "Root environment configuration changed; inspect privately",
  );
  report.rootEnvUnchanged = true;
  await fs.writeFile(
    path.join(tools, "verification.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await cleanup();
}
