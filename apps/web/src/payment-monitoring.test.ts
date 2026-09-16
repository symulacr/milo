import { describe, expect, test } from "bun:test";
import {
  MonitoringController,
  type MonitoringTransport,
  type MonitorStatus,
  monitoringControls,
  unknownMonitoringOutcome,
} from "./payment-monitoring-runtime";

const eligible: MonitorStatus = {
  quoteVersion: 7,
  canStart: true,
  canStop: false,
  state: "none",
  expiresAt: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(status: MonitorStatus = eligible) {
  const starts: unknown[] = [];
  const stops: unknown[] = [];
  let queries = 0;
  const transport: MonitoringTransport = {
    status: async () => {
      queries++;
      return status;
    },
    start: async (args) => {
      starts.push(args);
    },
    stop: async (args) => {
      stops.push(args);
    },
  };
  return {
    controller: new MonitoringController("real-quote", transport),
    transport,
    starts,
    stops,
    queries: () => queries,
  };
}

describe("read-only monitoring controls", () => {
  test("requires explicit unchecked consent and exact server version", async () => {
    const h = harness();
    await h.controller.mutate("start");
    await h.controller.refresh();
    await h.controller.mutate("start");
    expect(h.starts).toEqual([]);
    h.controller.consent(true);
    await h.controller.mutate("start");
    expect(h.starts).toEqual([
      {
        quoteId: "real-quote",
        expectedVersion: 7,
        consent: "monitor-test-payment",
      },
    ]);
    expect(h.controller.getSnapshot().consent).toBe(false);
    expect(h.controller.getSnapshot().needsRefresh).toBe(true);
  });
  test("duplicate mutation clicks are synchronously fenced; refresh is a new query", async () => {
    const h = harness();
    const pending = deferred<unknown>();
    h.transport.start = async (args) => {
      h.starts.push(args);
      return pending.promise;
    };
    await h.controller.refresh();
    h.controller.consent(true);
    const first = h.controller.mutate("start");
    await h.controller.mutate("start");
    await h.controller.refresh();
    expect(h.starts).toHaveLength(1);
    expect(h.queries()).toBe(1);
    pending.resolve(null);
    await first;
    await h.controller.refresh();
    expect(h.queries()).toBe(2);
  });
  test("quote or session replacement suppresses pending query and mutation results", async () => {
    const h = harness();
    const query = deferred<MonitorStatus>();
    h.transport.status = () => query.promise;
    const loading = h.controller.refresh();
    h.controller.invalidate();
    query.resolve(eligible);
    await loading;
    expect(h.controller.getSnapshot().status).toBeUndefined();
    h.transport.status = async () => eligible;
    await h.controller.refresh();
    h.controller.consent(true);
    const mutation = deferred<unknown>();
    h.transport.start = () => mutation.promise;
    const starting = h.controller.mutate("start");
    h.controller.invalidate();
    mutation.reject(new Error("secret provider error"));
    await starting;
    expect(h.controller.getSnapshot().message).toBe(
      "Refresh monitoring status.",
    );
    expect(h.controller.getSnapshot().consent).toBe(false);
    const replacement = new MonitoringController("other-quote", h.transport);
    expect(replacement.getSnapshot().status).toBeUndefined();
    expect(replacement.getSnapshot().consent).toBe(false);
  });
  test("local expiry disables start but never grants server authority", async () => {
    const active = {
      ...eligible,
      state: "running" as const,
      expiresAt: 100,
      canStop: true,
    };
    expect(monitoringControls(active, 99).stale).toBe(false);
    expect(monitoringControls(active, 100)).toEqual({
      stale: true,
      canStart: false,
      canStop: true,
    });
    const h = harness(active);
    await h.controller.refresh();
    h.controller.consent(true);
    await h.controller.mutate("start", 100);
    expect(h.starts).toEqual([]);
    expect(
      monitoringControls({ ...active, state: "expired", canStart: false }, 100)
        .canStart,
    ).toBe(false);
  });
  test("revoked consent owner can stop independently of start eligibility or consent", async () => {
    const h = harness({
      ...eligible,
      quoteVersion: null,
      canStart: false,
      canStop: true,
      state: "unavailable",
    });
    await h.controller.refresh();
    await h.controller.mutate("stop");
    expect(h.stops).toEqual([{ quoteId: "real-quote" }]);
    expect(h.starts).toEqual([]);
  });
  test("unknown mutation outcome is sanitized and blocks retry until refresh", async () => {
    const h = harness();
    h.transport.start = async (args) => {
      h.starts.push(args);
      throw new Error("secret Stripe details");
    };
    await h.controller.refresh();
    h.controller.consent(true);
    await h.controller.mutate("start");
    expect(h.controller.getSnapshot().message).toBe(unknownMonitoringOutcome);
    h.controller.consent(true);
    await h.controller.mutate("start");
    expect(h.starts).toHaveLength(1);
    h.transport.status = async () => {
      throw new Error("private quote");
    };
    await h.controller.refresh();
    expect(h.controller.getSnapshot().status).toBeUndefined();
    expect(h.controller.getSnapshot().message).toBe(
      "Monitoring status could not be verified. Refresh status to try again.",
    );
    expect(h.controller.getSnapshot().needsRefresh).toBe(true);
  });
  test("server denial and absent version cannot be bypassed by consent", async () => {
    for (const status of [
      { ...eligible, canStart: false },
      { ...eligible, quoteVersion: null },
    ]) {
      const h = harness(status);
      await h.controller.refresh();
      h.controller.consent(true);
      await h.controller.mutate("start");
      expect(h.starts).toEqual([]);
    }
  });
});
