/**
 * Browser-side instrumentation for e2e/rig.
 *
 * `installInstrumentation` is passed to Playwright's addInitScript, so it is
 * serialised and re-evaluated in the page: it must be completely
 * self-contained and must never read a module-scope binding. Everything it
 * records is an observation of the page, not an instruction from it.
 *
 * Recorded per the goal's definition, identically before and after any change:
 * clicks/taps, form fields filled, discrete non-content keypresses, page
 * navigations, wallet approvals, confirmation dialogs, scrolls-to-find, route
 * changes and time-to-goal.
 *
 * Field values are never recorded. Only the field's identity and the current
 * value length are kept, so a form filled with anything sensitive still leaves
 * no content in an evidence file.
 */

/* c8 ignore start - browser-side, measured by the rig runs, not by coverage */
export function installInstrumentation(options) {
  const config = options || {};
  // Wall-clock anchor owned by the runner, so timestamps stay comparable across
  // a navigation: every document gets a fresh window, the run does not.
  const started = typeof config.startedAt === "number" ? config.startedAt : Date.now();
  const events = [];
  let goalMarked = false;
  let lastPath = location.pathname + location.search + location.hash;

  const rig = {
    version: 1,
    runId: config.runId || "",
    flowId: config.flowId || "",
    startedAt: started,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    events,
    goalTimeMs: null,
    lastGoal: "",
  };
  window.__MILO_RIG__ = rig;

  const now = () => Date.now() - started;

  function push(kind, detail) {
    const record = { k: kind, t: now(), url: location.pathname };
    if (detail) {
      for (const key in detail) {
        if (detail[key] !== undefined && detail[key] !== null) {
          record[key] = detail[key];
        }
      }
    }
    events.push(record);
    if (events.length > 20000) events.splice(0, 5000);
    // Streamed to the runner so a navigation cannot discard the run so far.
    try {
      if (typeof window.__miloRigEmit === "function") window.__miloRigEmit(record);
    } catch (error) {
      events.push({ k: "emit-failed", t: now(), error: String(error).slice(0, 120) });
    }
    return record;
  }

  function describe(node) {
    if (!node || node.nodeType !== 1) return { tag: "unknown" };
    const text = (node.innerText || node.textContent || "").trim();
    const label =
      node.getAttribute("aria-label") ||
      (node.labels && node.labels[0] && node.labels[0].innerText) ||
      (text.length > 60 ? `${text.slice(0, 60)}…` : text);
    let path = "";
    let cursor = node;
    while (cursor && cursor.nodeType === 1 && path.length < 200) {
      const parent = cursor.parentElement;
      if (!parent) break;
      const name = cursor.tagName.toLowerCase();
      const siblings = parent.children;
      let index = 1;
      for (let i = 0; i < siblings.length; i += 1) {
        if (siblings[i] === cursor) {
          index = i + 1;
          break;
        }
      }
      path = `${name}[${index}]${path ? ` > ${path}` : ""}`;
      cursor = parent;
    }
    return {
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute("role") || "",
      name: label,
      testId: node.getAttribute("data-testid") || "",
      type: node.getAttribute("type") || "",
      path,
    };
  }

  const INTERACTIVE =
    "a[href],button,input,select,textarea,summary,[role=button],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[role=menuitem],[onclick]";

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      const actionable =
        target && target.closest ? target.closest(INTERACTIVE) : null;
      if (!actionable) return;
      push("click", {
        ...describe(actionable),
        trusted: event.isTrusted === true,
        pointer: event.detail > 0 ? "mouse" : "keyboard-or-script",
      });
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      const actionable =
        target && target.closest ? target.closest(INTERACTIVE) : null;
      if (!actionable) return;
      push("tap", {
        ...describe(actionable),
        pointerType: event.pointerType || "",
        trusted: event.isTrusted === true,
      });
    },
    true,
  );

  const NON_CONTENT_KEYS = new Set([
    "Tab",
    "Enter",
    "Escape",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Backspace",
    "Delete",
  ]);

  document.addEventListener(
    "keydown",
    (event) => {
      if (!NON_CONTENT_KEYS.has(event.key)) return;
      if (event.repeat) return;
      const active = document.activeElement;
      push("key", {
        key: event.key,
        shift: event.shiftKey === true,
        ctrl: event.ctrlKey === true,
        meta: event.metaKey === true,
        focusTag: active ? active.tagName.toLowerCase() : "",
        focusName: active ? describe(active).name.slice(0, 60) : "",
        trusted: event.isTrusted === true,
      });
    },
    true,
  );

  const fieldState = new WeakMap();
  function trackField(element) {
    const key = (element.name || "") + "|" + (element.id || "");
    const previous = fieldState.get(element);
    const length = String(element.value || "").length;
    const first = previous === undefined;
    fieldState.set(element, length);
    if (first) {
      push("field-focus", {
        field: key,
        type: element.type || element.tagName.toLowerCase(),
      });
    }
    if (previous !== length) {
      push("field-fill", {
        field: key,
        type: element.type || element.tagName.toLowerCase(),
        length,
        delta: previous === undefined ? length : length - previous,
      });
    }
  }
  for (const type of ["input", "change"]) {
    document.addEventListener(
      type,
      (event) => {
        const element = event.target;
        if (
          !element ||
          !element.tagName ||
          !/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)
        ) {
          return;
        }
        trackField(element);
      },
      true,
    );
  }

  function routeChanged(kind) {
    const next = location.pathname + location.search + location.hash;
    if (next === lastPath) return;
    const from = lastPath;
    lastPath = next;
    push("route", { from, to: next, kind });
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function patched() {
      const out = original.apply(this, arguments);
      routeChanged(method);
      return out;
    };
  }
  window.addEventListener("popstate", () => routeChanged("popstate"));
  window.addEventListener("hashchange", () => routeChanged("hashchange"));
  push("route", {
    from: "",
    to: lastPath,
    kind: "initial",
  });
  push("navigation", { url: location.href, kind: "document" });

  let scrollEvents = 0;
  let scrollDistance = 0;
  let lastScrollY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const delta = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      scrollEvents += 1;
      scrollDistance += Math.abs(delta);
      push("scroll", {
        y: Math.round(window.scrollY),
        delta: Math.round(delta),
        index: scrollEvents,
      });
    },
    { passive: true },
  );
  window.addEventListener(
    "wheel",
    () => {
      push("wheel", { index: scrollEvents });
    },
    { passive: true },
  );

  function dialogLabel(node) {
    if (!node) return "dialog";
    const title =
      node.getAttribute("aria-label") ||
      (node.innerText || "").trim().split("\n")[0] ||
      "";
    return title.slice(0, 80);
  }
  const openDialogs = new Set();
  function observeDialog(node) {
    if (!node || openDialogs.has(node)) return;
    openDialogs.add(node);
    push("dialog", {
      name: dialogLabel(node),
      action: "open",
      role: node.getAttribute("role") || "",
    });
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('[role="dialog"],dialog[open]')) {
          observeDialog(node);
        }
        if (node.querySelectorAll) {
          for (const inner of node.querySelectorAll(
            '[role="dialog"],dialog[open],.dialog-content',
          )) {
            observeDialog(inner);
          }
        }
      }
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1) continue;
        const closing = [node]
          .concat(node.querySelectorAll ? node.querySelectorAll('[role="dialog"],dialog[open],.dialog-content') : [])
          .filter((element) => openDialogs.has(element));
        for (const element of closing) {
          openDialogs.delete(element);
          push("dialog", { name: dialogLabel(element), action: "close" });
        }
      }
    }
  });
  const startObserving = () => {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    for (const existing of document.querySelectorAll(
      '[role="dialog"],dialog[open],.dialog-content',
    )) {
      observeDialog(existing);
    }
  };
  if (document.documentElement) startObserving();
  else document.addEventListener("DOMContentLoaded", startObserving, { once: true });

  const WRAPPED_API = [
    "getConnectionStatus",
    "getConfiguration",
    "getUnshieldedAddress",
    "getShieldedBalances",
    "getUnshieldedBalances",
    "submitTransaction",
    "signData",
  ];
  const wrapped = new WeakSet();
  function wrapEntry(rdns, entry) {
    if (!entry || typeof entry !== "object" || wrapped.has(entry)) return entry;
    wrapped.add(entry);
    push("wallet", {
      event: "discovered",
      rdns: String(rdns),
      apiVersion: String(entry.apiVersion || ""),
      name: String(entry.name || ""),
    });
    if (typeof entry.connect === "function") {
      const connect = entry.connect.bind(entry);
      entry.connect = function patchedConnect(networkId) {
        push("wallet", {
          event: "connect-request",
          rdns: String(rdns),
          networkId: String(networkId),
        });
        let outcome;
        try {
          outcome = connect(networkId);
        } catch (error) {
          push("wallet", {
            event: "connect-error",
            rdns: String(rdns),
            networkId: String(networkId),
            error: String((error && error.message) || error).slice(0, 160),
          });
          throw error;
        }
        return Promise.resolve(outcome).then(
          function onApproved(api) {
            push("wallet", {
              event: "connect-approved",
              rdns: String(rdns),
              networkId: String(networkId),
              isApi: !!api && typeof api === "object",
            });
            if (api && typeof api === "object") {
              for (const method of WRAPPED_API) {
                if (typeof api[method] !== "function" || wrapped.has(api[method])) {
                  continue;
                }
                const inner = api[method].bind(api);
                const marker = {};
                wrapped.add(marker);
                api[method] = function patchedMethod() {
                  push("wallet", {
                    event: "api-call",
                    rdns: String(rdns),
                    method: method,
                  });
                  return inner.apply(null, arguments);
                };
              }
            }
            return api;
          },
          function onRejected(error) {
            push("wallet", {
              event: "connect-rejected",
              rdns: String(rdns),
              networkId: String(networkId),
              error: String((error && error.message) || error).slice(0, 160),
            });
            throw error;
          },
        );
      };
    }
    return entry;
  }

  let registry = window.midnight;
  function sweepRegistry() {
    if (!registry || typeof registry !== "object") return;
    for (const rdns in registry) {
      registry[rdns] = wrapEntry(rdns, registry[rdns]);
    }
  }
  sweepRegistry();
  const descriptor = Object.getOwnPropertyDescriptor(window, "midnight");
  Object.defineProperty(window, "midnight", {
    configurable: true,
    enumerable: true,
    get() {
      return registry;
    },
    set(value) {
      registry = value;
      sweepRegistry();
      push("wallet", {
        event: "registry-set",
        rdnss: value && typeof value === "object" ? Object.keys(value) : [],
      });
    },
  });
  if (descriptor && descriptor.get) {
    // A page that defined midnight before us keeps its accessor; poll instead.
    const timer = window.setInterval(sweepRegistry, 400);
    window.addEventListener("pagehide", () => window.clearInterval(timer));
  }

  rig.markGoal = function markGoal(name) {
    if (!goalMarked) {
      rig.goalTimeMs = now();
      goalMarked = true;
    }
    rig.lastGoal = String(name || "");
    push("goal", { name: String(name || ""), first: true });
    return rig.goalTimeMs;
  };
  rig.read = function read() {
    return {
      version: rig.version,
      runId: rig.runId,
      flowId: rig.flowId,
      viewport: rig.viewport,
      reducedMotion: rig.reducedMotion,
      goalTimeMs: rig.goalTimeMs,
      lastGoal: rig.lastGoal,
      scrollEvents: scrollEvents,
      scrollDistance: scrollDistance,
      events: events.slice(),
    };
  };

  window.addEventListener("error", (event) => {
    push("pageerror", {
      message: String((event && event.message) || "").slice(0, 300),
      source: String((event && event.filename) || "").slice(0, 200),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event && event.reason;
    push("unhandledrejection", {
      message: String(
        (reason && (reason.message || reason.stack)) || reason || "",
      ).slice(0, 300),
    });
  });
}
/* c8 ignore stop */

export const AXE_RUN_OPTIONS = {
  resultTypes: ["violations"],
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
};

/** Reduce one run's raw events to the goal's counters. */
export function clickCostFromEvents(events) {
  const count = (kind) => events.filter((event) => event.k === kind).length;
  const clicks = events.filter(
    (event) => event.k === "click" && event.trusted === true,
  );
  const fields = events.filter((event) => event.k === "field-fill");
  const distinctFields = new Set(fields.map((event) => event.field));
  const goals = events.filter((event) => event.k === "goal");
  const dialogs = events.filter(
    (event) => event.k === "dialog" && event.action === "open",
  );
  const walletApprovals = events.filter(
    (event) => event.k === "wallet" && event.event === "connect-approved",
  );
  const walletRejections = events.filter(
    (event) => event.k === "wallet" && event.event === "connect-rejected",
  );
  const scrolls = events.filter((event) => event.k === "scroll");
  const goalTimeMs = goals.length > 0 ? goals[0].t : null;
  const scrollsToFind = goalTimeMs === null
    ? scrolls.length
    : scrolls.filter((event) => event.t <= goalTimeMs).length;
  return {
    clicks: clicks.length,
    taps: count("tap"),
    fieldsFilled: distinctFields.size,
    fieldEvents: fields.length,
    keypresses: count("key"),
    navigations: events.filter((event) => event.k === "navigation").length,
    routeChanges: events.filter((event) => event.k === "route").length,
    walletApprovals: walletApprovals.length,
    walletRejections: walletRejections.length,
    confirmationDialogs: dialogs.length,
    scrollsToFind,
    scrollDistance:
      scrolls.reduce((total, event) => total + Math.abs(event.delta || 0), 0),
    timeToGoalMs: goalTimeMs,
    pageErrors: count("pageerror") + count("unhandledrejection"),
  };
}

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values) {
  return percentile(values, 0.5);
}

/** Median and p95 over every metric, across at least five runs. */
export function aggregateRuns(runs) {
  if (runs.length < 1) return { runs: 0, metrics: {} };
  const keys = Object.keys(runs[0]).filter(
    (key) => typeof runs[0][key] === "number",
  );
  const metrics = {};
  for (const key of keys) {
    const values = runs.map((run) => run[key]).filter((v) => v !== null);
    if (values.length === 0) continue;
    metrics[key] = {
      median: Math.round(median(values) * 100) / 100,
      p95: Math.round(percentile(values, 0.95) * 100) / 100,
      min: Math.min(...values),
      max: Math.max(...values),
      n: values.length,
    };
  }
  return { runs: runs.length, metrics };
}