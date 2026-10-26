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
