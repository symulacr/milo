import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { WalletProviderSlot } from "../../../packages/midnight-client/src/provider-factory.ts";

export class WalletProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletProviderUnavailableError";
  }
}

export type ConnectorWalletProvider = WalletProviderSlot & {
  readonly shieldedAddress: string;
};

const REQUIRED_METHODS = [
  "getShieldedAddresses",
  "balanceUnsealedTransaction",
  "submitTransaction",
] as const;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const missing = (method: string): string =>
  `The connected wallet does not expose ${method}.`;

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
          `The wallet could not balance the transaction: ${describe(error)}`,
        );
      }
    },
  };
}

export async function connectorSupportsSignedReserve(
  api: ConnectedAPI,
): Promise<{ supported: boolean; reason?: string }> {
  for (const method of REQUIRED_METHODS) {
    if (typeof api[method] !== "function")
      return { supported: false, reason: missing(method) };
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
      reason: `The connected wallet failed to report its shielded addresses: ${describe(error)}`,
    };
  }
  return { supported: true };
}
