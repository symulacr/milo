import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { ConvexError } from "convex/values";
import { env } from "../packages/backend/src/encoding";
import type { DataModel } from "./_generated/dataModel";

export type AdmissionContext = GenericMutationCtx<DataModel>;

/** A query handler's read-only context; five modules copied this alias. */
export type ReadContext = GenericQueryCtx<DataModel>;

/** The read-only database surface a helper needs; two modules copied it. */
export type ReadDb = AdmissionContext["db"];

/**
 * The expected-failure vocabulary. Public functions throw these as
 * `ConvexError({ code, message })`; a bug still surfaces as a plain Error.
 * Exported by name for W1's client mapping.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "WRONG_STATE",
  "CONFLICT",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Throw an expected failure; the client reads `data.code` and `data.message`. */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

/** The one code that means "retry later": a provider or deployment fault. */
export function unavailable(message: string): never {
  fail("PROVIDER_UNAVAILABLE", message);
}

/**
 * A deployment setting, read the same way everywhere. `env()` already trims and
 * treats `""` as absent, so this is the single place that decides what
 * "configured" means.
 *
 * `pattern` narrows the shape. With `code` the value is required and a miss
 * throws that code (a provider key is `PROVIDER_UNAVAILABLE` so the caller
 * retries); without it the caller gets `null` and reports in its own shape,
 * which is what a `{ok:false, reason}` handler needs.
 */
export function readEnv(
  name: string,
  pattern?: RegExp,
  code?: ErrorCode,
): string | null {
  const value = env(name);
  if (value !== undefined && (!pattern || pattern.test(value))) return value;
  if (code) fail(code, `${name} is not configured.`);
  return null;
}

/** `readEnv` that must succeed; the common case, so it reads as one call. */
export const requiredEnv = (name: string, pattern?: RegExp): string =>
  readEnv(name, pattern, "PROVIDER_UNAVAILABLE") as string;
