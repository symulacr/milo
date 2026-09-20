// Await watchdog: turn a silent stall into a NAMED step.
//
// A real Preprod --sweep deployed its first scenario through the staged path, emitted
// call-finalized for the scenario's deploy, and then produced no output for nine minutes
// while consuming 11 seconds of CPU in total: the process was alive and blocked on a
// promise, and nothing in the trail said which await was pending. The circuit call path
// ends in midnight-js-contracts' submitTx, which the SDK documents as waiting indefinitely
// in providers.publicDataProvider.watchForTxData(txId); on Preprod that observation comes
// over a relay subscription the network closes, so the transaction can land on chain while
// the promise never settles.
//
// This module wraps one awaited operation with a NAME and a DEADLINE:
//
//   const watchdog = createAwaitWatchdog({ emit, label: "sweep" });
//   const result = await watchdog.step("findDeployedContract:buyer", () =>
//     findDeployedContract(providers, options),
//   );
//
// On deadline expiry it emits ONE event naming the step, how long it waited, and the
// process CPU actually burned while waiting (the "idle CPU" observation, measured rather
// than asserted), then rejects with AwaitStallError so the caller records a named failure
// instead of hanging forever. Steps nest (a call encloses its prove/balance/submit/confirm
// stages); only the outermost step arms the deadline, and a breach names the INNERMOST
// pending frame, so the event names the await that is actually blocking rather than the
// wrapper that started earlier. When nothing exceeds its deadline the wrapper is
// transparent: the resolved value and the rejection are passed through unchanged, and the
// only work done is an in-memory stack push/pop.
//
// Live readout: the in-memory stack of pending steps is exposed as `pending()` / `stack()`,
// and the first watchdog installed process-wide registers a SIGUSR2 handler that dumps every
// live watchdog's stack through its own `emit`. That is how an operator attaches to a hung
// Preprod process and asks what it is waiting on right now:
//
//   kill -USR2 <pid>          # emits await-pending, durable in transactions.jsonl
//
// SIGUSR2 is chosen over a per-step file write because it costs nothing on the hot path
// (no I/O per await), it cannot leave a stale "pending" file behind after a crash, and the
// existing emit already appends to the durable trail as well as stdout. An optional
// periodic heartbeat (`heartbeatMs`) can also re-emit the pending step on an interval for
// an operator watching stdout rather than attaching; it is off by default so an untroubled
// run stays exactly as quiet as it was.

/** Thrown when a watched step exceeds its deadline. `detail` is the emitted event. */
export class AwaitStallError extends Error {
  constructor(step, elapsedMs, detail) {
    super(
      `await stalled: step ${JSON.stringify(step)} did not settle within ${elapsedMs}ms`,
    );
    this.name = "AwaitStallError";
    this.step = step;
    this.elapsedMs = elapsedMs;
    this.detail = detail;
  }
}

// Every live watchdog in this process, so one signal can report all of them.
const watchdogs = new Set();
let signalHandlerInstalled = false;

function installSignalHandler() {
  if (signalHandlerInstalled) return;
  signalHandlerInstalled = true;
  // SIGUSR2 is a no-op on platforms that do not define it; the readout is a convenience,
  // never a prerequisite for the deadline.
  try {
    process.on("SIGUSR2", () => {
      for (const watchdog of watchdogs) watchdog.reportPending("signal");
    });
  } catch {
    signalHandlerInstalled = false;
  }
}

/** Deadline in milliseconds. `MILO_AWAIT_TIMEOUT_MS=0` disables the deadline entirely and
 * leaves only the live readout. Bounded so a typo cannot silently disable the watchdog
 * (too small) or turn every Preprod step into a false alarm (too large). Unset keeps the
 * 10 minute default: longer than the observed 9 minute stall, far shorter than forever. */
export const AWAIT_TIMEOUT_DEFAULT_MS = 600_000;
export const AWAIT_TIMEOUT_MIN_MS = 1_000;
export const AWAIT_TIMEOUT_MAX_MS = 86_400_000;

export function resolveAwaitTimeoutMs(env = process.env) {
  const setting = env.MILO_AWAIT_TIMEOUT_MS;
  // An unset or blank value keeps the default. Number("") is 0, which would otherwise read
  // as the deliberate "disable" value and silently turn the watchdog off on an empty env var.
  if (setting === undefined || String(setting).trim() === "")
    return AWAIT_TIMEOUT_DEFAULT_MS;
  const raw = Number(setting);
  if (!Number.isFinite(raw)) return AWAIT_TIMEOUT_DEFAULT_MS;
  if (raw === 0) return 0;
  return Math.min(
    AWAIT_TIMEOUT_MAX_MS,
    Math.max(AWAIT_TIMEOUT_MIN_MS, Math.trunc(raw)),
  );
}

// CPU below this percentage of the elapsed wall time reads as "idle and blocked", the shape
// of the observed stall (9 minutes wall, 11 seconds CPU: about 2 percent).
const CPU_IDLE_THRESHOLD_PERCENT = 25;

function toMicros(cpu) {
  return cpu.user + cpu.system;
}

function snapshotContext(context) {
  return { ...context };
}

/**
 * Create one watchdog.
 *
 * @param {object} options
 * @param {(event: object) => unknown} options.emit  Event sink; same single-object
 *   convention as the driver's other emits, so a stall lands in stdout and the durable
 *   transactions.jsonl trail.
 * @param {string} [options.label]  Which phase owns these steps (e.g. "sweep").
 * @param {number} [options.timeoutMs]  Deadline; 0 disables. Default 600000.
 * @param {"throw"|"report"} [options.onTimeout]  "throw" (default) rejects with
 *   AwaitStallError after emitting; "report" emits but keeps waiting.
 * @param {number} [options.heartbeatMs]  Optional periodic pending event; 0 (default) off.
 * @param {(error: unknown) => void} [options.onEmitError]  Reported, never thrown.
 */
export function createAwaitWatchdog({
  emit,
  label = "await",
  timeoutMs = AWAIT_TIMEOUT_DEFAULT_MS,
  onTimeout = "throw",
  heartbeatMs = 0,
  onEmitError,
} = {}) {
  if (typeof emit !== "function")
    throw new TypeError("createAwaitWatchdog requires an emit function");
  const frames = [];
  let context = {};
  let disposed = false;

  const safeEmit = (event) => {
    try {
      Promise.resolve(emit(event)).catch((error) => onEmitError?.(error));
    } catch (error) {
      onEmitError?.(error);
    }
  };

  const watchdog = {
    label,

    /** Merge fields into the ambient context every step records. */
    setContext(fields) {
      context = { ...context, ...fields };
    },

    /** Drop ambient context (all of it, or just the named keys). */
    clearContext(keys) {
      if (!keys) {
        context = {};
        return;
      }
      const next = { ...context };
      for (const key of keys) delete next[key];
      context = next;
    },

    /** The step currently awaited, or null. Cheap: reads the in-memory stack. */
    pending() {
      const frame = frames.at(-1);
      if (!frame) return null;
      return {
        name: frame.name,
        startedAt: new Date(frame.startedAtMs).toISOString(),
        elapsedMs: Date.now() - frame.startedAtMs,
        context: snapshotContext(frame.context),
      };
    },

    /** The whole pending stack, outermost first. */
    stack() {
      return frames.map((frame) => ({
        name: frame.name,
        elapsedMs: Date.now() - frame.startedAtMs,
        context: snapshotContext(frame.context),
      }));
    },

    /** Emit one await-pending event describing what is awaited right now. */
    reportPending(reason = "asked") {
      const stack = watchdog.stack();
      if (stack.length === 0) return;
      safeEmit({
        event: "await-pending",
        reason,
        label,
        pid: process.pid,
        at: new Date().toISOString(),
        pending: stack,
      });
    },

    /**
     * Await `operation` (a promise or a thunk returning one) under `name`.
     *
     * Transparent on success and on the operation's own rejection; only a deadline breach
     * adds anything (one await-stall event, then AwaitStallError unless onTimeout is
     * "report").
     *
     * Only the OUTERMOST watched step arms a deadline. Nested steps are named but inherit
     * the root's clock, and a breach is attributed to the INNERMOST pending frame - the
     * await that is actually blocking. Arming a timer per frame would fire the wrapper's
     * timer first (it started earlier) and name the wrapper instead of the blocked await;
     * at most one frame therefore owns the deadline, and it reports the deepest frame on
     * the stack when it fires.
     */
    async step(name, operation) {
      const isRoot = frames.length === 0;
      const startedAtMs = Date.now();
      const startedCpu = process.cpuUsage();
      const frame = {
        name,
        startedAtMs,
        context: snapshotContext(context),
      };
      frames.push(frame);
      const arms = isRoot && timeoutMs > 0;
      const heartbeat =
        isRoot && heartbeatMs > 0
          ? setInterval(() => {
              const blocked = frames.at(-1) ?? frame;
              safeEmit({
                event: "await-pending",
                reason: "heartbeat",
                label,
                pid: process.pid,
                step: blocked.name,
                rootStep: name,
                elapsedMs: Date.now() - startedAtMs,
                context: { ...frame.context, ...blocked.context },
              });
            }, heartbeatMs)
          : null;
      let deadline = null;
      try {
        const promise =
          typeof operation === "function" ? operation() : operation;
        if (!arms || onTimeout === "report") {
          if (arms) {
            deadline = setTimeout(() => {
              safeEmit(
                stallEvent({
                  label,
                  root: frame,
                  blocked: frames.at(-1) ?? frame,
                  startedCpu,
                  elapsedMs: Date.now() - startedAtMs,
                  timeoutMs,
                  stack: frames,
                }),
              );
            }, timeoutMs);
          }
          return await promise;
        }
        let rejectStall;
        const breach = new Promise((_resolve, reject) => {
          rejectStall = reject;
        });
        deadline = setTimeout(() => {
          const blocked = frames.at(-1) ?? frame;
          const elapsedMs = Date.now() - startedAtMs;
          const detail = stallEvent({
            label,
            root: frame,
            blocked,
            startedCpu,
            elapsedMs,
            timeoutMs,
            stack: frames,
          });
          safeEmit(detail);
          // The blocked inner await is abandoned, not cancelled: a promise that never
          // settles would leave its frame on the stack forever, which would make every
          // later step look nested and silently disable every later deadline. Unwind to
          // (and including) this root frame; the abandoned step's own finally finds its
          // frame already gone and is a no-op.
          const index = frames.indexOf(frame);
          if (index !== -1) frames.splice(index);
          rejectStall(
            new AwaitStallError(blocked.name, Math.round(elapsedMs), detail),
          );
        }, timeoutMs);
        return await Promise.race([promise, breach]);
      } finally {
        if (deadline) clearTimeout(deadline);
        if (heartbeat) clearInterval(heartbeat);
        const index = frames.indexOf(frame);
        if (index !== -1) frames.splice(index, 1);
      }
    },

    /** Stop reporting for this watchdog. Steps already in flight are unaffected. */
    dispose() {
      disposed = true;
      watchdogs.delete(watchdog);
    },

    get disposed() {
      return disposed;
    },
  };

  watchdogs.add(watchdog);
  installSignalHandler();
  return watchdog;
}

/** The one event a stall produces. `root` is the step that armed the deadline; `blocked` is
 * the innermost pending frame at breach - the await actually blocking - so the report names
 * the blocked await rather than the wrapper that enclosed it. */
function stallEvent({
  label,
  root,
  blocked,
  startedCpu,
  elapsedMs,
  timeoutMs,
  stack,
}) {
  const cpu = process.cpuUsage(startedCpu);
  const cpuMicros = toMicros(cpu);
  const wallMicros = Math.max(elapsedMs, 1) * 1000;
  const cpuBusyPercent = (cpuMicros / wallMicros) * 100;
  return {
    event: "await-stall",
    label,
    pid: process.pid,
    step: blocked.name,
    rootStep: root.name,
    ...blocked.context,
    rootStartedAt: new Date(root.startedAtMs).toISOString(),
    blockedStartedAt: new Date(blocked.startedAtMs).toISOString(),
    blockedElapsedMs: Math.max(0, Date.now() - blocked.startedAtMs),
    elapsedMs: Math.round(elapsedMs),
    timeoutMs,
    pendingStack: stack.map((entry) => entry.name),
    cpuBusyPercent: Number(cpuBusyPercent.toFixed(2)),
    cpuIdle: cpuBusyPercent < CPU_IDLE_THRESHOLD_PERCENT,
    cpuIdleThresholdPercent: CPU_IDLE_THRESHOLD_PERCENT,
    note: "the awaited step did not settle before its deadline; cpuIdle says the process was blocked on a promise, not computing",
  };
}

/**
 * Wrap named methods on `target` so every call is a watched step. Kept here (rather than in
 * the driver) because the middleware-provider surface is where midnight-js performs its
 * unnameable awaits: proving, balancing, submission and the confirmation watch. Returns an
 * undo function, so the wrapping is removable without touching the provider objects' shape.
 *
 * @param {object} target
 * @param {Record<string, string>} methods  { methodName: stepName }
 * @param {object} watchdog
 * @returns {() => void} restore
 */
export function watchMethods(target, methods, watchdog) {
  if (!target) return () => {};
  const originals = [];
  for (const [method, stepName] of Object.entries(methods)) {
    if (typeof target[method] !== "function") continue;
    const original = target[method];
    originals.push([method, original]);
    target[method] = (...args) =>
      watchdog.step(stepName, () => original.apply(target, args));
  }
  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}
