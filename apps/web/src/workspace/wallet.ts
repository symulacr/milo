import { useSyncExternalStore } from "react";
import {
  DappWalletConnector,
  type WalletChoice,
  type WalletConnectionState,
  walletChoices,
  watchWallets,
} from "../../../../packages/midnight-client/src";

let state: WalletConnectionState = { status: "disconnected" };
let choices: readonly WalletChoice[] = [];
const listeners = new Set<() => void>();
let connector: DappWalletConnector | undefined;
let watching = false;

const notify = () => {
  for (const listener of listeners) listener();
};

/** Start the bounded late-injection watch once, from the first subscriber. */
const watch = () => {
  if (watching || typeof window === "undefined") return;
  watching = true;
  watchWallets(
    () => window.midnight,
    () => {
      choices = walletChoices(window.midnight);
      notify();
    },
  );
};

export function walletConnector(): DappWalletConnector {
  connector ??= new DappWalletConnector((next) => {
    state = next;
    notify();
  });
  return connector;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  watch();
  return () => {
    listeners.delete(listener);
  };
};

export const useWallet = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );

/** The wallets found so far; a late injection appears here without a reload. */
export const useWallets = () =>
  useSyncExternalStore(
    subscribe,
    () => choices,
    () => choices,
  );

/** The rdns of the wallet this browser used last, so a reload reconnects. */
const LAST_KEY = "milo:wallet-rdns";

export const lastRdns = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

/**
 * Connect one wallet. The handle must be passed synchronously from the click
 * handler, because a wallet opens its approval popup inside `connect`.
 */
export const connectWallet = (choice: WalletChoice) => {
  try {
    localStorage.setItem(LAST_KEY, choice.rdns);
  } catch {
    // Storage disabled: the connection still works, only the memory is lost.
  }
  return walletConnector().connect(choice.api);
};

/** Start the chain chunk on intent; the chain module caches the import. */
export const warmChain = (): void => void import("../chain").catch(() => {});

/** The wallet to connect when the user has not picked one: last, else first. */
export const preferredWallet = (
  found: readonly WalletChoice[] = choices,
): WalletChoice | undefined =>
  found.find((wallet) => wallet.rdns === lastRdns()) ?? found[0];

/**
 * Is the connected account a different one than this session signed in with?
 *
 * `me.walletAddress` is the last 16 characters of the address the session signed
 * in with (`convex/auth.ts` stores `wallet-<last16>@wallet.milo.local`), so this
 * is a suffix match, not an exact one. That is enough to catch a switched
 * account, which is the failure the user needs to see; it is not a security
 * check and does not pretend to be. When either side is unknown the answer is
 * "no", because guessing would block a legitimate user.
 */
export const differentAccount = (
  connected: string | null | undefined,
  linked: string | null | undefined,
): boolean =>
  Boolean(
    connected &&
      linked &&
      linked.length >= 8 &&
      !connected.toLowerCase().endsWith(linked.toLowerCase()),
  );

/** The one hint per wallet state; the connector distinguishes the failures. */
export const walletHint = (state: WalletConnectionState): string =>
  state.status === "error"
    ? state.message
    : state.status === "connected"
      ? `Connected on Midnight Preprod as ${state.account.unshieldedAddress}.`
      : "Not connected. A Midnight wallet signs every order step.";

export const shortAddress = (address: string) =>
  address.length > 22
    ? `${address.slice(0, 14)}…${address.slice(-6)}`
    : address;
