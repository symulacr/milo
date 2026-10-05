/**
 * Click-cost accounting for e2e/rig.
 *
 * The rig's whole point is a BEFORE number that a later wave can compare
 * against, so the accounting has to be mechanical: no hand-tallied clicks, and
 * no per-flow special cases. Every number below is derived from the same
 * instrumentation event stream, before and after a change alike.
 *
 * "Click cost" is the user-visible effort to reach a goal:
 *   clicks        trusted pointer/keyboard activations of an interactive element
 *   fieldsFilled  distinct form controls whose value length changed
 *   keypresses    discrete non-content keys (Tab, Enter, arrows, ...)
 *   navigations   document loads
 *   routeChanges  client-side route transitions, including the initial one
 *   walletApprovals  wallet connect() calls the page received an approval for
 *   confirmationDialogs dialogs opened
 *   scrollsToFind scroll events that happened before the goal was reached
 *   timeToGoalMs  wall-clock milliseconds from instrumentation start to goal
 */
import {
  aggregateRuns,
  clickCostFromEvents,
  median,
  percentile,
} from "./instrumentation.mjs";

export const CLICK_COST_FIELDS = [
  "clicks",
  "fieldsFilled",
  "keypresses",
  "navigations",
  "routeChanges",
  "walletApprovals",
  "confirmationDialogs",
  "scrollsToFind",
  "timeToGoalMs",
];

export { clickCostFromEvents, aggregateRuns, median, percentile };

/**
 * Fold one run's raw instrumentation plus its HAR and axe results into a
 * single comparable record.
 */
export function summariseRun({ flowId, runIndex, events, har, axe, ok, error }) {
  const cost = clickCostFromEvents(events);
  return {
    flowId,
    runIndex,
    ok: ok === true,
    error: error ? String(error).slice(0, 300) : null,
    ...cost,
    requests: har ? har.requestCount : null,
    responseBytes: har ? har.responseBytes : null,
    failedRequests: har ? har.failedRequestCount : null,
    axeViolations: Array.isArray(axe) ? axe.length : null,
    axeSerious: Array.isArray(axe)
      ? axe.filter((entry) => entry.impact === "serious" || entry.impact === "critical")
          .length
      : null,
  };
}

/**
 * Median and p95 per flow, plus the fields the B1 table carries forward. This
 * is the shape a Wave 3 BEFORE capture and a Wave 4 AFTER capture both emit, so
 * the two are diffable without a conversion step.
 */
export function summariseFlow(flowId, runs) {
  const aggregate = aggregateRuns(runs);
  const okRuns = runs.filter((run) => run.ok);
  return {
    flowId,
    runs: runs.length,
    passed: okRuns.length,
    failed: runs.length - okRuns.length,
    medianClicks: aggregate.metrics.clicks?.median ?? null,
    p95Clicks: aggregate.metrics.clicks?.p95 ?? null,
    medianTimeToGoalMs: aggregate.metrics.timeToGoalMs?.median ?? null,
    p95TimeToGoalMs: aggregate.metrics.timeToGoalMs?.p95 ?? null,
    medianRequests: aggregate.metrics.requests?.median ?? null,
    p95Requests: aggregate.metrics.requests?.p95 ?? null,
    medianResponseBytes: aggregate.metrics.responseBytes?.median ?? null,
    p95ResponseBytes: aggregate.metrics.responseBytes?.p95 ?? null,
    metrics: aggregate.metrics,
    runs_detail: runs,
  };
}

/**
 * Compare two captures of the same flow set. Used by the AFTER wave; kept here
 * so both sides share one definition of "better".
 */
export function compareCaptures(before, after) {
  const byId = new Map(after.map((row) => [row.flowId, row]));
  const rows = before.map((row) => {
    const other = byId.get(row.flowId);
    if (!other) return { flowId: row.flowId, status: "missing-in-after" };
    const delta = (key) => {
      const a = row[key];
      const b = other[key];
      if (a === null || b === null || a === undefined || b === undefined) {
        return null;
      }
      return Math.round((b - a) * 100) / 100;
    };
    return {
      flowId: row.flowId,
      status: "compared",
      deltaMedianClicks: delta("medianClicks"),
      deltaP95Clicks: delta("p95Clicks"),
      deltaMedianTimeToGoalMs: delta("medianTimeToGoalMs"),
      deltaP95Requests: delta("p95Requests"),
      before: row,
      after: other,
    };
  });
  return rows;
}

export function captureHeader(label, env, options = {}) {
  return {
    label,
    capturedAt: new Date().toISOString(),
    browser: env.browser,
    executablePath: env.executablePath,
    baseUrl: env.baseUrl,
    headless: env.headless,
    reducedMotion: env.reducedMotion,
    loadExtension: env.extension,
    runsPerFlow: options.runs ?? env.runs,
    axeTags: env.axeTags,
  };
}