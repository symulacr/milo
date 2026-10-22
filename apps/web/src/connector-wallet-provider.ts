/**
 * A `WalletProvider` backed by a connected DApp Connector wallet.
 *
 * The browser has no local secret keys: the wallet extension holds them and
 * exposes only the connector surface. `midnight-js` needs a `WalletProvider` to
 * balance a transaction and to name the coin and encryption public keys, so this
 * adapts the connector to that interface and nothing more.
 *
 * Three properties matter here and are enforced rather than assumed:
 *
 * 1. The keys are the wallet's, read once at construction and cached. Reading
 *    them lazily on every call would let a wallet switch accounts mid-session and
 *    silently produce a transaction the user cannot sign.
 * 2. `balanceTx` sends the transaction to the wallet unsealed, which is the
 *    connector's contract for "pay fees and remove imbalances". It does not
 *    sign: signing is the wallet's own step, so this adapter can never produce a
 *    signature the user did not approve.
 * 3. A balancing failure is surfaced with the wallet's message, never swallowed.
 *    A silent fallback would let the caller believe a transaction was balanced
 *    when the wallet refused.
 */

import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { WalletProviderSlot } from "../../../packages/midnight-client/src/provider-factory.ts";

/** Raised when the connector cannot be adapted, so callers fail closed by type. */
export class WalletProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletProviderUnavailableError";
  }
}

export type ConnectorWalletProvider = WalletProviderSlot & {
  /** The shielded address the connector reported, for display and cross-checks. */
  readonly shieldedAddress: string;
};

/**
 * Build a `WalletProvider` from a connected wallet.
 *
 * Fails closed when the connector does not expose the methods the reserve path
 * needs. A wallet that answers `getShieldedAddresses` but not
 * `balanceUnsealedTransaction` cannot pay a fee, so it is not a usable provider
 * and must not be presented as one.
 */
export async function connectorWalletProvider(
  api: ConnectedAPI,
): Promise<ConnectorWalletProvider> {
  if (typeof api.getShieldedAddresses !== "function")
    throw new WalletProviderUnavailableError(
      "The connected wallet does not expose getShieldedAddresses; it cannot supply the coin and encryption public keys.",
    );
  if (typeof api.balanceUnsealedTransaction !== "function")
    throw new WalletProviderUnavailableError(
      "The connected wallet does not expose balanceUnsealedTransaction; it cannot pay fees for a contract call.",
    );

  const shielded = await api.getShieldedAddresses();
  const coinPublicKey = shielded?.shieldedCoinPublicKey;
  const encryptionPublicKey = shielded?.shieldedEncryptionPublicKey;
  const shieldedAddress = shielded?.shieldedAddress;

  if (!coinPublicKey || !encryptionPublicKey || !shieldedAddress)
    throw new WalletProviderUnavailableError(
      "The connected wallet returned an incomplete shielded address record; refusing to build a provider from it.",
    );

  return {
    shieldedAddress,
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,
    async balanceTx(tx: unknown, _ttl?: Date): Promise<unknown> {
      // The connector speaks serialized transactions, so the caller's value must
      // already be a string. Guessing at a conversion here would hide a mismatch
      // between the caller and the wallet until the wallet rejected it.
      if (typeof tx !== "string")
        throw new WalletProviderUnavailableError(
          `balanceTx expects a serialized transaction string from the connector; received ${typeof tx}.`,
        );
      try {
        const balanced = await api.balanceUnsealedTransaction(tx);
        if (typeof balanced?.tx !== "string" || balanced.tx.length === 0)
          throw new WalletProviderUnavailableError(
            "The wallet returned no balanced transaction.",
          );
        return balanced.tx;
      } catch (error) {
        if (error instanceof WalletProviderUnavailableError) throw error;
        throw new WalletProviderUnavailableError(
          `The wallet could not balance the transaction: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

/**
 * Whether a connected wallet can back a signed reserve.
 *
 * This is the runtime answer to the question `WALLET_SIGNED_RESERVE_RUNTIME`
 * answers statically. It reports capability, not success: a wallet can expose
 * every method and still refuse a specific transaction, and only a real signed
 * transaction plus a matching observation proves the path works.
 */
export async function connectorSupportsSignedReserve(
  api: ConnectedAPI,
): Promise<{ supported: boolean; reason?: string }> {
  for (const method of [
    "getShieldedAddresses",
    "balanceUnsealedTransaction",
    "submitTransaction",
  ] as const) {
    if (typeof api[method] !== "function")
      return {
        supported: false,
        reason: `The connected wallet does not expose ${method}.`,
      };
  }
  try {
    const shielded = await api.getShieldedAddresses();
    if (
      !shielded?.shieldedCoinPublicKey ||
      !shielded?.shieldedEncryptionPublicKey
    )
      return {
        supported: false,
        reason:
          "The connected wallet did not return the coin and encryption public keys.",
      };
  } catch (error) {
    return {
      supported: false,
      reason: `The connected wallet failed to report its shielded addresses: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { supported: true };
}
