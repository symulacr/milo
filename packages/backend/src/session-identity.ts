/**
 * The one identity gate every authenticated Convex path calls.
 *
 * Provider-neutral: the issuer is read from the environment, so swapping providers is an env
 * change plus `convex/auth.config.ts` — not a change at any call site. That decoupling was
 * measured and priced in hardening/v8/auth-swap (15 call sites, 9 modules, one shape).
 *
 * The expected issuer must equal the one Convex validates, so a token Convex accepted under
 * some other issuer is still refused here rather than trusted. Input must come from Convex
 * auth.getUserIdentity(), never from a client-decoded JWT.
 */

/**
 * The issuer Convex validates — the Better Auth service's base URL, measured against a running
 * instance (hardening/auth-probe/REPORT.md): Better Auth sets `iss` to the base URL itself.
 *
 * The fallback admits the provider that is *currently deployed* until the deployment is
 * reconfigured. That ordering matters: without it, setting the new issuer in source before the
 * Convex side changes would deny every authenticated request in the interim. It stops applying
 * the moment `BETTER_AUTH_URL` is set, and should be deleted once the deployment is cut over.
 */
const LEGACY_ISSUER = "privy.io";
const ISSUER = process.env.BETTER_AUTH_URL ?? LEGACY_ISSUER;

/**
 * Subject shape. Better Auth issues a 32-character opaque id (measured); the legacy provider
 * issued `did:`-prefixed identifiers. Both are accepted because the issuer check above is what
 * discriminates between providers — this pattern is a secondary sanity check, not the gate.
 */
const SUBJECT_PATTERN = /^(?:[A-Za-z0-9_-]{16,}|did:privy:[a-zA-Z0-9_-]+)$/;

export function requireSessionSubject(
  identity: { issuer: string; subject: string } | null,
): string {
  if (identity?.issuer !== ISSUER || !SUBJECT_PATTERN.test(identity.subject)) {
    throw new Error("Authenticated session required");
  }
  return identity.subject;
}
