import { ConvexError } from "convex/values";
import { env } from "./encoding";

/**
 * The issuer this deployment trusts. `auth.config.ts` registers the same value,
 * so there is one answer. When it is unset we return the sentinel and every
 * session is refused: a fresh or misconfigured deployment fails closed instead
 * of trusting whatever issuer a previous provider used.
 */
const UNCONFIGURED = "urn:milo:auth-unconfigured";

const issuerFor = (): string =>
  env("CONVEX_SITE_URL") ?? env("BETTER_AUTH_URL") ?? UNCONFIGURED;

const SUBJECT_PATTERN = /^(?:[A-Za-z0-9_-]{16,}|did:privy:[a-zA-Z0-9_-]+)$/;

export function requireSessionSubject(
  identity: { issuer: string; subject: string } | null,
): string {
  const issuer = issuerFor();
  const valid =
    issuer !== UNCONFIGURED &&
    identity?.issuer === issuer &&
    SUBJECT_PATTERN.test(identity.subject);
  if (!valid)
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authenticated session required",
    });
  return (identity as { subject: string }).subject;
}

/**
 * R24 I-07: the same gate, plus a check that the session row still exists.
 *
 * `requireSessionSubject` reads only the JWT, so a session revoked after the
 * token was minted kept working until it expired. `sessionAlive` is expected to
 * be `authComponent.safeGetAuthUser(ctx)`, which already does the session-row
 * join and is already used by `auth.me` — no new table, dependency or query
 * shape.
 *
 * Kept separate rather than folded in because the sync version is used in paths
 * whose tests supply a bare identity double; making it async would break 64 of
 * them for a check that only matters on privileged writes. Callers opt in.
 */
export async function requireLiveSubject(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
  sessionAlive: () => Promise<unknown>,
): Promise<string> {
  const subject = requireSessionSubject(
    (await ctx.auth.getUserIdentity()) as {
      issuer: string;
      subject: string;
    } | null,
  );
  if (!(await sessionAlive()))
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authenticated session required",
    });
  return subject;
}

/**
 * The operator allowlist, parsed once per distinct raw value.
 *
 * This is read on every `orders.list`/`orders.order` call, so re-splitting it
 * per call was pure waste. Memoizing on the raw string (not on "have we read it
 * yet") keeps the behaviour a test can observe: mutating `MILO_OPERATOR_EMAILS`
 * between calls still takes effect, because the key changes.
 */
let cachedRaw: string | undefined;
let cachedList: string[] = [];

export function operatorEmails(): string[] {
  const configured = process.env.MILO_OPERATOR_EMAILS;
  if (typeof configured !== "string") {
    cachedRaw = undefined;
    cachedList = [];
    return cachedList;
  }
  if (configured === cachedRaw) return cachedList;
  cachedRaw = configured;
  cachedList = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return cachedList;
}

/**
 * R35 (b): the one place that answers "is an operator configured?".
 *
 * Three call sites used to answer it three ways — the digest tested
 * `recipients.length === 0`, `orders.order` tested `operatorEmails().length > 0`
 * inside `operatorAllowed`, and nothing at all answered it for diagnostics — so
 * a misconfigured deployment looked healthy from two of the three. They now all
 * read this, and `configured: false` is a fact the API can return instead of an
 * absence a caller has to infer.
 */
export type OperatorConfig = { configured: boolean; count: number };

export function operatorConfig(): OperatorConfig {
  const count = operatorEmails().length;
  return { configured: count > 0, count };
}

/**
 * Logged once per process, not once per call: the point is to make a
 * misconfiguration visible in the deployment log, not to flood a 60 s cron.
 */
let warnedUnconfigured = false;

export function warnIfNoOperator(): void {
  if (warnedUnconfigured || operatorEmails().length > 0) return;
  warnedUnconfigured = true;
  console.warn(
    "operator-unconfigured",
    "MILO_OPERATOR_EMAILS is empty: no dispute can be resolved and no operator key can be issued.",
  );
}

/**
 * R37: the same fact as one sentence a user can act on, or `null` when there is
 * nothing wrong. Two surfaces say this — the diagnostics read and the order
 * payload — and a warning worded two ways is how one ends up softer than the
 * truth. It names the consequence, not the variable: the reader is not the
 * person who can set it.
 */
export const NO_OPERATOR_NOTICE =
  "Disputes cannot be resolved: no operator is configured for this deployment.";

export function disputesBlockedNotice(): string | null {
  return operatorConfig().configured ? null : NO_OPERATOR_NOTICE;
}
