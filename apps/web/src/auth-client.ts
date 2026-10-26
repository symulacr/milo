import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { loadPublicConfig } from "./notice";

function createMiloAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [convexClient(), crossDomainClient(), magicLinkClient()],
  });
}

type MiloAuthClient = ReturnType<typeof createMiloAuthClient>;

let active: MiloAuthClient | null = null;

export function authClientFor(baseURL: string): MiloAuthClient {
  active ??= createMiloAuthClient(baseURL);
  return active;
}

/** Sign-in runs before the provider mounts, so it may have to load the config. */
async function authClient(): Promise<MiloAuthClient | null> {
  if (!active) {
    const config = await loadPublicConfig().catch(() => null);
    if (config?.betterAuthUrl) authClientFor(config.betterAuthUrl);
  }
  return active;
}

type MagicLinkResult = { sent: boolean; message: string };

const UNAVAILABLE = "Sign-in is not available on this site. Try again later.";

/** The wait is in `X-Retry-After` seconds (better-auth.com/docs/concepts/rate-limit).
 * The result object drops the response, so this is only reachable from `onError`. */
export const retryWait = (response: Response | undefined): string => {
  const seconds = response?.headers?.get("x-retry-after")?.trim();
  return seconds && /^\d+$/.test(seconds)
    ? `Wait ${seconds} seconds, then try again.`
    : "";
};

/** One failure path. The limiter's wait wins when present, else the server's
 * classified sentence, else the generic line — always naming the address so a
 * typo is fixable instead of retried. */
const refusal = (
  cause: unknown,
  address: string,
  wait: string,
): MagicLinkResult => {
  const message = (cause as { message?: string } | null)?.message?.trim();
  const text =
    wait || message || "Milo did not send the sign-in link. Try again.";
  return { sent: false, message: `${text} The address was ${address}.` };
};

export async function sendMagicLink(
  email: string,
  callbackURL = "/orders",
): Promise<MagicLinkResult> {
  const address = email.trim().toLowerCase();
  if (!address) return { sent: false, message: "Enter an email address." };
  const client = await authClient();
  if (!client) return { sent: false, message: UNAVAILABLE };
  let wait = "";
  try {
    const result = await client.signIn.magicLink(
      { email: address, callbackURL },
      {
        onError: ({ response }) => {
          wait = retryWait(response);
        },
      },
    );
    if (result.error) return refusal(result.error, address, wait);
    return {
      sent: true,
      message: `Check ${address}. The sign-in link works one time.`,
    };
  } catch (cause) {
    return refusal(cause, address, wait);
  }
}

type WalletSignInResult =
  | { ok: true; address: string }
  | { ok: false; message: string };

const WALLET_FAILURE =
  "The wallet did not finish the sign-in. Open it, set Midnight Preprod and try again.";

type Challenge = { message: string };

export async function signInWithWallet(
  connectedApi: ConnectedAPI,
): Promise<WalletSignInResult> {
  const client = await authClient();
  if (!client) return { ok: false, message: UNAVAILABLE };
  // The wallet routes are rate-limited too, and `$fetch` drops the response.
  let wait = "";
  const onError = ({ response }: { response?: Response }) => {
    wait = retryWait(response);
  };
  try {
    const status = await connectedApi.getConnectionStatus();
    if (status.status !== "connected" || status.networkId !== "preprod")
      return { ok: false, message: WALLET_FAILURE };
    const { unshieldedAddress } = await connectedApi.getUnshieldedAddress();
    if (!unshieldedAddress) return { ok: false, message: WALLET_FAILURE };
    const challenge = await client.$fetch<Challenge>("/wallet/nonce", {
      method: "POST",
      body: { address: unshieldedAddress },
      onError,
    });
    // A rate-limited wallet is not a wallet fault, so the wait wins over the
    // sentence that would send the user to fix a working wallet.
    if (challenge.error || !challenge.data?.message)
      return {
        ok: false,
        message: wait || "Milo did not send a sign-in challenge. Try again.",
      };
    const signed = await connectedApi.signData(challenge.data.message, {
      encoding: "text",
      keyType: "unshielded",
    });
    const scheme = (signed as { scheme?: string }).scheme;
    const verified = await client.$fetch<{ success: boolean }>(
      "/wallet/verify",
      {
        method: "POST",
        body: {
          message: challenge.data.message,
          verifyingKey: signed.verifyingKey,
          signature: signed.signature,
          scheme,
        },
        onError,
      },
    );
    if (verified.error || !verified.data?.success)
      return { ok: false, message: wait || WALLET_FAILURE };
    (client as { updateSession?: () => void }).updateSession?.();
    return { ok: true, address: unshieldedAddress };
  } catch {
    return { ok: false, message: WALLET_FAILURE };
  }
}

export async function signOut(): Promise<void> {
  await active?.signOut();
}
