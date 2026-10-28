import {
  connectWallet,
  preferredWallet,
  useWallet,
  walletConnector,
} from "./wallet";

export const WALLET_MISSING =
  "No Midnight wallet found. Install Lace on Preprod, unlock it, then retry.";

/** Connect the remembered wallet, or the first one found. Returns false if none. */
export const connectPreferred = (): boolean => {
  const choice = preferredWallet();
  if (!choice) return false;
  void connectWallet(choice);
  return true;
};

export const useConnected = () =>
  useWallet().status === "connected"
    ? walletConnector().connectedApi()
    : undefined;

export const TEST_CARD =
  "Stripe test mode: Milo uses a test card. No real money moves.";
