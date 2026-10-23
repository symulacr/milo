const SUBJECT = /^(?:[A-Za-z0-9_-]{16,}|did:privy:[a-zA-Z0-9_-]+)$/;

const fail = (message: string) => ({ verified: false, message });

export function backendSessionStatus(
  signedIn: boolean,
  loading: boolean,
  authenticated: boolean,
  result: unknown,
  expectedSubject: string | undefined,
  refreshing = false,
): { verified: boolean; message: string } {
  if (!signedIn) return fail("Sign in to verify the backend session.");
  if (!expectedSubject || !SUBJECT.test(expectedSubject))
    return fail(
      "Waiting for the current identity before backend verification.",
    );
  if (loading || refreshing)
    return fail("Waiting for backend token verification…");
  if (!authenticated)
    return fail(
      "Backend token not verified. Check the Convex deployment’s auth configuration and retry sign-in.",
    );
  if (result === undefined)
    return fail("Checking the authenticated backend session…");
  if (
    result instanceof Error ||
    !result ||
    typeof result !== "object" ||
    !("subject" in result) ||
    typeof result.subject !== "string" ||
    result.subject !== expectedSubject
  )
    return fail(
      "Backend session check failed. Confirm auth/session:current is deployed and permits this session.",
    );
  return {
    verified: true,
    message:
      "Backend token verified. The authenticated session query succeeded; sample orders remain synthetic and no protocol authority is granted.",
  };
}
