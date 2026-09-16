/** Input must come from Convex auth.getUserIdentity(), never decoded client JWTs. */
export function requirePrivySubject(
  identity: { issuer: string; subject: string } | null,
): string {
  if (
    identity?.issuer !== "privy.io" ||
    !/^did:privy:[a-zA-Z0-9_-]+$/.test(identity.subject)
  ) {
    throw new Error("Authenticated Privy identity required");
  }
  return identity.subject;
}
