export async function fetchPrivyAccessToken(
  getAccessToken: () => Promise<string | null>,
): Promise<string | null> {
  try {
    // Privy refreshes expired/expiring tokens; its React API has no force-refresh argument.
    return await getAccessToken();
  } catch {
    return null;
  }
}

export function backendSessionStatus(
  signedIn: boolean,
  loading: boolean,
  authenticated: boolean,
  result: unknown,
  expectedSubject: string | undefined,
  refreshing = false,
): { verified: boolean; message: string } {
  if (!signedIn)
    return {
      verified: false,
      message: "Sign in to verify the backend session.",
    };
  if (!expectedSubject || !/^did:privy:[a-zA-Z0-9_-]+$/.test(expectedSubject))
    return {
      verified: false,
      message:
        "Waiting for the current Privy identity before backend verification.",
    };
  if (loading || refreshing)
    return {
      verified: false,
      message: "Waiting for backend token verification…",
    };
  if (!authenticated)
    return {
      verified: false,
      message:
        "Backend token not verified. Check the Convex deployment’s Privy authentication configuration and retry sign-in.",
    };
  if (result === undefined)
    return {
      verified: false,
      message: "Checking the authenticated backend session…",
    };
  if (
    result instanceof Error ||
    !result ||
    typeof result !== "object" ||
    !("subject" in result) ||
    typeof result.subject !== "string" ||
    result.subject !== expectedSubject
  )
    return {
      verified: false,
      message:
        "Backend session check failed. Confirm auth/session:current is deployed and permits this Privy session.",
    };
  return {
    verified: true,
    message:
      "Backend token verified. The authenticated session query succeeded; sample orders remain synthetic and no protocol authority is granted.",
  };
}
