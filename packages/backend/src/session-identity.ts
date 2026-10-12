/**
 * The one identity gate every authenticated Convex path calls.
 *
 * Provider-neutral by construction: the two constants below are the only place an identity
 * provider is named in the backend. Swapping providers is an edit here plus the matching
 * `providers` entry in convex/auth.config.ts — not a change at any of the call sites. That
 * decoupling was measured and priced in hardening/v8/auth-swap (15 call sites, 9 modules,
 * one uniform shape).
 *
 * The expected issuer must match the one Convex validates in auth.config.ts, so a token
 * Convex accepted under some other issuer is still refused here rather than trusted. Input
 * must come from Convex auth.getUserIdentity(), never from a client-decoded JWT.
 */

/** Expected issuer. Must equal the `issuer` Convex validates in convex/auth.config.ts. */
const ISSUER = "privy.io";

/** Expected subject shape for that issuer. `did:privy:` identifiers carry a name-safe tail. */
const SUBJECT_PATTERN = /^did:privy:[a-zA-Z0-9_-]+$/;

export function requireSessionSubject(
  identity: { issuer: string; subject: string } | null,
): string {
  if (identity?.issuer !== ISSUER || !SUBJECT_PATTERN.test(identity.subject)) {
    throw new Error("Authenticated session required");
  }
  return identity.subject;
}
