import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { ConvexConnection } from "./ConvexConnection";

function IdentityStatus() {
  const { ready, authenticated, logout } = usePrivy();
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const { login } = useLogin({
    onComplete: () => setError(""),
    onError: () =>
      setError(
        "Sign-in did not complete. Retry or check the Privy app’s allowed origins and email login settings.",
      ),
  });
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <p role="status">
        {!ready
          ? slow
            ? "Privy has not become ready. Check network access and app configuration, then reload."
            : "Initializing Privy…"
          : authenticated
            ? "Signed in via Privy. This grants no order authority."
            : "Not signed in. Email sign-in is handled by Privy."}
      </p>
      {error && <p role="alert">{error}</p>}
      {authenticated ? (
        <button
          type="button"
          className="button secondary"
          disabled={!ready}
          onClick={() => {
            void logout().catch(() =>
              setError("Sign-out failed. Please retry."),
            );
          }}
        >
          Sign out of Privy
        </button>
      ) : (
        <button
          type="button"
          className="button"
          disabled={!ready}
          onClick={() => {
            setError("");
            login({ loginMethods: ["email"] });
          }}
        >
          Continue to your order
        </button>
      )}
    </>
  );
}

export default function PrivyConnection({
  appId,
  convexUrl,
}: {
  appId: string;
  convexUrl?: string | null;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <IdentityStatus />
      <h3>Backend session</h3>
      {convexUrl ? (
        <ConvexConnection key={convexUrl} url={convexUrl} />
      ) : (
        <p role="status">
          Convex is not configured. No backend token verification is available.
        </p>
      )}
    </PrivyProvider>
  );
}
