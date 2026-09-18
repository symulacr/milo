import type { MonitorStatus } from "../../../convex/paymentMonitor";

export type { MonitorStatus };
export interface MonitoringTransport {
  status(args: { quoteId: string }): Promise<MonitorStatus>;
  start(args: {
    quoteId: string;
    expectedVersion: number;
    consent: "monitor-test-payment";
  }): Promise<unknown>;
  stop(args: { quoteId: string }): Promise<unknown>;
}

export function monitoringControls(
  status: MonitorStatus | undefined,
  now: number,
) {
  const elapsed =
    !!status && status.expiresAt !== null && now >= status.expiresAt;
  const stale =
    elapsed && (status.state === "waiting" || status.state === "running");
  return {
    stale,
    canStart: !!status?.canStart && status.quoteVersion !== null && !stale,
    canStop: !!status?.canStop,
  };
}

// A synchronous lease also fences promises after the form is replaced.
export class MonitoringRequestGuard {
  private busy = false;
  private revision = 0;
  acquire(): number | null {
    if (this.busy) return null;
    this.busy = true;
    return ++this.revision;
  }
  current(ticket: number) {
    return this.busy && this.revision === ticket;
  }
  release(ticket: number) {
    if (this.current(ticket)) this.busy = false;
  }
  invalidate() {
    ++this.revision;
    this.busy = false;
  }
}

export const unknownMonitoringOutcome =
  "The monitoring request outcome is unknown. Refresh status before deciding what to do next; do not assume it failed or repeat it blindly.";

type MonitoringSnapshot = {
  status?: MonitorStatus;
  consent: boolean;
  busy: boolean;
  needsRefresh: boolean;
  message: string;
};

export class MonitoringController {
  private guard = new MonitoringRequestGuard();
  private listeners = new Set<() => void>();
  private snapshot: MonitoringSnapshot = {
    consent: false,
    busy: false,
    needsRefresh: true,
    message: "Look up this quote’s monitoring status.",
  };
  constructor(
    readonly quoteId: string,
    private transport: MonitoringTransport,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<MonitoringSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  invalidate() {
    this.guard.invalidate();
    this.update({
      status: undefined,
      consent: false,
      busy: false,
      needsRefresh: true,
      message: "Refresh monitoring status.",
    });
  }
  consent(value: boolean) {
    this.update({ consent: value });
  }
  async refresh() {
    const ticket = this.guard.acquire();
    if (ticket === null) return;
    this.update({
      busy: true,
      consent: false,
      needsRefresh: true,
      message: "Checking monitoring status with the server…",
    });
    try {
      const status = await this.transport.status({ quoteId: this.quoteId });
      if (this.guard.current(ticket))
        this.update({
          status,
          needsRefresh: false,
          message: "Monitoring status refreshed.",
        });
    } catch {
      if (this.guard.current(ticket))
        this.update({
          status: undefined,
          message:
            "Monitoring status could not be verified. Refresh status to try again.",
        });
    } finally {
      if (this.guard.current(ticket)) {
        this.guard.release(ticket);
        this.update({ busy: false });
      }
    }
  }
  async mutate(action: "start" | "stop", now = Date.now()) {
    const { status, consent, needsRefresh } = this.snapshot;
    const controls = monitoringControls(status, now);
    if (
      needsRefresh ||
      !status ||
      (action === "start" ? !consent || !controls.canStart : !controls.canStop)
    )
      return;
    const ticket = this.guard.acquire();
    if (ticket === null) return;
    this.update({
      busy: true,
      consent: false,
      needsRefresh: true,
      message:
        "Waiting for the monitoring request. No outcome is confirmed yet; do not repeat it.",
    });
    try {
      if (action === "start" && status.quoteVersion !== null) {
        await this.transport.start({
          quoteId: this.quoteId,
          expectedVersion: status.quoteVersion,
          consent: "monitor-test-payment",
        });
      } else {
        await this.transport.stop({ quoteId: this.quoteId });
      }
      if (this.guard.current(ticket))
        this.update({
          message:
            "Monitoring request acknowledged. Refresh status to verify the current state.",
        });
    } catch {
      if (this.guard.current(ticket))
        this.update({ message: unknownMonitoringOutcome });
    } finally {
      if (this.guard.current(ticket)) {
        this.guard.release(ticket);
        this.update({ busy: false });
      }
    }
  }
}
