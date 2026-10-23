const LEGACY_ISSUER = "privy.io";
const ISSUER = process.env.BETTER_AUTH_URL ?? LEGACY_ISSUER;

const SUBJECT_PATTERN = /^(?:[A-Za-z0-9_-]{16,}|did:privy:[a-zA-Z0-9_-]+)$/;

export function requireSessionSubject(
  identity: { issuer: string; subject: string } | null,
): string {
  if (identity?.issuer !== ISSUER || !SUBJECT_PATTERN.test(identity.subject)) {
    throw new Error("Authenticated session required");
  }
  return identity.subject;
}
