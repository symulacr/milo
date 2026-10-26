import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { errorDiagnostics } from "./diagnostics.mjs";

export const bytes32 = () => new Uint8Array(randomBytes(32));

/** One indexer POST, asserted the way every local driver asserted it.
 *
 * This is the one GraphQL POST in the package. The progress probe and the
 * verification gate each carried their own copy with a different timeout and a
 * different error shape; both now call this with their own `timeoutMs`.
 *
 * `timeoutMs` is clamped to whatever remains of `deadline` when one is given, so a
 * caller with an overall budget cannot be outlived by a single request. */
export async function graphql(
  env,
  query,
  variables,
  { timeoutMs = 15_000, deadline } = {},
) {
  const remaining = deadline === undefined ? timeoutMs : deadline - Date.now();
  assert(
    remaining > 0,
    `indexer budget exhausted before ${String(query).slice(0, 60)}`,
  );
  const response = await fetch(env.indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
  });
  assert(response.ok, `indexer HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.errors, JSON.stringify(body.errors));
  return body.data;
}

/**
 * The trail writer, staged emitter, crash handler and promise deadline the local
 * drivers each carried. Omit `trailPath` for stdout-only; `stamped` adds `at`.
 */
export function createHarness({
  trailPath,
  runDir,
  failFields = {},
  stamped = Boolean(trailPath),
}) {
  if (runDir) mkdirSync(runDir, { recursive: true });
  let stage = "configuration";
  const emit = (event, fields = {}) => {
    const record = {
      event,
      ...(stamped ? { at: Date.now() } : {}),
      stage,
      ...fields,
    };
    const line = JSON.stringify(record);
    if (trailPath) appendFileSync(trailPath, `${line}\n`);
    process.stdout.write(`${line}\n`);
  };
  const fail = (error) => {
    emit("failed", {
      ...failFields,
      ...errorDiagnostics(error),
      message: error?.message || String(error),
      stack: error?.stack?.split("\n").slice(0, 8).join(" | ") ?? null,
    });
    process.exit(1);
  };
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  const withTimeout = (promise, ms, label) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        emit("step-timeout", { label, ms });
        reject(new Error(`timeout after ${ms}ms: ${label}`));
      }, ms);
    });
    return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
  };
  return {
    emit,
    fail,
    withTimeout,
    setStage: (next) => {
      stage = next;
    },
    get stage() {
      return stage;
    },
  };
}
