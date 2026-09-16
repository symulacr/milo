import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";

export async function installMonitorFixtures(root, project) {
  assert.equal(
    path.resolve(project),
    path.resolve(root, ".tools/convex-local/project"),
    "Synthetic provider must remain in the isolated clone",
  );
  await fs.copyFile(
    path.join(root, "scripts/convex-local-monitor-fixtures.ts"),
    path.join(project, "convex/localMonitorVerification.ts"),
  );
  const provider = await fs.readFile(
    path.join(root, "scripts/convex-local-monitor-provider.ts"),
    "utf8",
  );
  await fs.writeFile(
    path.join(project, "packages/backend/src/local-monitor-provider.ts"),
    provider.replace(
      '"../packages/backend/src/admission-policy"',
      '"./admission-policy"',
    ),
  );
  const workerPath = path.join(project, "convex/stripeMonitoring.ts");
  const worker = await fs.readFile(workerPath, "utf8");
  const boundary = '"../packages/backend/src/stripe-observer.server"';
  assert.equal(
    worker.split(boundary).length,
    2,
    "Expected exactly one monitoring provider import",
  );
  await fs.writeFile(
    workerPath,
    worker.replace(
      boundary,
      '"../packages/backend/src/local-monitor-provider"',
    ),
  );
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, predicate, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  do {
    state = await read();
    if (predicate(state)) return state;
    await pause(100);
  } while (Date.now() < deadline);
  assert.fail(
    `${label} timed out; last synthetic state: ${JSON.stringify(state)}`,
  );
}

// API mapping is explicit so the harness cannot silently test fixture mutations as production endpoints.
export async function verifyMonitorScheduler({
  admin,
  url,
  adminKey,
  startEndpoint,
  stopEndpoint,
  stopBackend,
  startBackend,
}) {
  assert.match(startEndpoint, /^(?!local)[\w/]+:\w+$/);
  assert.match(stopEndpoint, /^(?!local)[\w/]+:\w+$/);
  const report = {
    syntheticProvider: true,
    onlyCopiedMonitoringWorkerImportOverridden: true,
    publicStatusAuthorizationAndRedaction: true,
    scenarios: [],
  };
  async function scenario(name) {
    const quoteId = `local-monitor-${name}-${randomUUID()}`;
    const subject = `did:privy:${quoteId}`;
    const accountId = quoteId;
    const scopeId = quoteId;
    const membershipId = await admin.mutation("localVerification:seed", {
      table: "memberships",
      document: {
        privySubject: subject,
        accountId,
        scopeId,
        role: "buyer",
        status: "active",
      },
    });
    await admin.mutation("localVerification:admissionFixture", {
      runId: quoteId,
      accountId,
      scopeId,
    });
    await admin.mutation("localMonitorVerification:prepare", { quoteId });
    const actor = new ConvexHttpClient(url, { logger: false });
    actor.setAdminAuth(adminKey, { issuer: "privy.io", subject });
    const read = () =>
      admin.query("localMonitorVerification:snapshot", { quoteId });
    const baseline = await read();
    const status = async () => {
      const result = await actor.query("paymentMonitoring:status", {
        quoteId,
        refreshToken: randomUUID(),
      });
      assert.deepEqual(Object.keys(result).sort(), [
        "canStart",
        "canStop",
        "expiresAt",
        "quoteVersion",
        "state",
      ]);
      return result;
    };
    assert.deepEqual(await status(), {
      state: "none",
      expiresAt: null,
      canStop: false,
      canStart: true,
      quoteVersion: 1,
    });
    const stranger = new ConvexHttpClient(url, { logger: false });
    await assert.rejects(
      stranger.query("paymentMonitoring:status", { quoteId }),
    );
    stranger.setAdminAuth(adminKey, {
      issuer: "privy.io",
      subject: `did:privy:other_${randomUUID()}`,
    });
    await assert.rejects(
      stranger.query("paymentMonitoring:status", { quoteId }),
    );
    const start = () =>
      actor.mutation(startEndpoint, {
        quoteId,
        expectedVersion: 1,
        consent: "monitor-test-payment",
      });
    const stop = () => actor.mutation(stopEndpoint, { quoteId });
    return { quoteId, membershipId, read, baseline, start, stop, status };
  }
  function unchangedBindings(s, baseline) {
    assert.deepEqual(
      s.payments,
      baseline.payments,
      "Monitoring must not create or rebind payment intents",
    );
    assert.deepEqual(
      s.jobs,
      baseline.jobs,
      "Monitoring must not create provisioning jobs",
    );
  }
  async function quiescent(f, before) {
    // Longer than the unmodified 15-second monitor interval, plus synthetic I/O delay.
    await pause(21_000);
    const after = await f.read();
    assert.deepEqual(
      after.monitors,
      before.monitors,
      "Stopped generation advanced",
    );
    assert.deepEqual(
      after.observations,
      before.observations,
      "Stopped generation wrote authorization",
    );
    unchangedBindings(after, f.baseline);
    const known = new Set(before.scheduled.map((j) => j._id));
    assert.ok(
      after.scheduled.every((j) => known.has(j._id)),
      "Stopped work scheduled a new function",
    );
    // Let the real 60-second watchdog run rather than canceling it in a fixture.
    return until(
      f.read,
      (s) => {
        assert.deepEqual(
          s.monitors,
          before.monitors,
          "Fenced watchdog advanced stopped work",
        );
        assert.deepEqual(
          s.observations,
          before.observations,
          "Fenced watchdog wrote authorization",
        );
        unchangedBindings(s, f.baseline);
        assert.ok(
          s.scheduled.every((j) => known.has(j._id)),
          "Fenced watchdog rescheduled work",
        );
        return s.scheduled.every(
          (j) => !["pending", "inProgress"].includes(j.state.kind),
        );
      },
      "Stopped watchdog drain",
      65_000,
    );
  }

  const live = await scenario("start-stop-restart");
  await live.start();
  let observed = await until(
    live.read,
    (s) => s.observations.length === 1,
    "First scheduled observation",
  );
  const firstReceipt = observed.observations[0]._id;
  await stopBackend();
  await startBackend();
  observed = await until(
    live.read,
    (s) =>
      s.observations.length === 1 && s.observations[0]._id !== firstReceipt,
    "Same-database scheduled continuation",
    30_000,
  );
  unchangedBindings(observed, live.baseline);
  assert.equal((await live.status()).canStart, false);
  assert.equal((await live.status()).canStop, true);
  await live.stop();
  const stopped = await live.read();
  assert.equal(stopped.monitors[0].state, "stopped");
  assert.equal(stopped.observations.length, 0);
  assert.equal((await live.status()).state, "stopped");
  assert.equal((await live.status()).canStop, false);
  await quiescent(live, stopped);
  report.scenarios.push({
    name: "start-stop-restart",
    observationsBeforeStop: 2,
    attempts: stopped.monitors[0].attempt,
    sameDatabaseRestart: true,
  });

  // These scenarios run concurrently to keep real-interval evidence bounded.
  await Promise.all(
    ["stop-in-flight", "revoke-in-flight", "expiry-in-flight"].map(
      async (name) => {
        const f = await scenario(name);
        await f.start();
        const running = await until(
          f.read,
          (s) =>
            s.monitors[0]?.state === "running" &&
            s.monitors[0].claimed === true,
          `${name} provider claimed`,
        );
        if (name === "stop-in-flight") await f.stop();
        if (name === "revoke-in-flight")
          await admin.mutation("localMonitorVerification:revoke", {
            membershipId: f.membershipId,
          });
        if (name === "revoke-in-flight") {
          const revokedStatus = await f.status();
          assert.equal(revokedStatus.canStart, false);
          assert.equal(revokedStatus.quoteVersion, null);
          assert.ok(["unavailable", "stopped"].includes(revokedStatus.state));
        }
        if (name === "expiry-in-flight")
          await admin.mutation("localMonitorVerification:nearExpiry", {
            monitorId: running.monitors[0]._id,
            remainingMs: 500,
          });
        const settled = await until(
          f.read,
          (s) => s.monitors[0]?.state === "stopped",
          `${name} settled`,
        );
        assert.equal(
          settled.observations.length,
          0,
          "Invalid in-flight result wrote authorization",
        );
        await quiescent(f, settled);
        report.scenarios.push({
          name,
          attempts: settled.monitors[0].attempt,
          authorizationRows: 0,
          paymentRows: settled.payments.length,
          provisioningJobs: settled.jobs.length,
        });
      },
    ),
  );
  return report;
}
