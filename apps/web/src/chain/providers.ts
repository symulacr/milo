import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type {
  FinalizedTransaction,
  TransactionId,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type {
  MidnightProvider,
  PrivateStateProvider,
  ProofProvider,
  PublicDataProvider,
  UnboundTransaction,
  WalletProvider,
  ZKConfigProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { ChainError, messageFor } from "./errors.ts";
import { toHex } from "./order.ts";

export type ChainProviders<PS> = {
  readonly privateStateProvider: PrivateStateProvider<string, PS>;
  readonly publicDataProvider: PublicDataProvider;
  readonly zkConfigProvider: ZKConfigProvider<string>;
  readonly proofProvider: ProofProvider;
  readonly walletProvider: WalletProvider;
  readonly midnightProvider: MidnightProvider;
  readonly keys: WalletKeys;
  /** The network the wallet reported, already read during assembly. */
  readonly networkId: string;
};

export type ChainProviderInput<PS> = {
  readonly connected: ConnectedAPI;
  readonly zkBaseUrl: string;
  readonly privateStateProvider: PrivateStateProvider<string, PS>;
  readonly createZkConfigProvider: (
    baseUrl: string,
    fetchFunc?: typeof fetch,
  ) => ZKConfigProvider<string>;
  readonly createHttpProofProvider: (
    url: string,
    zkConfigProvider: ZKConfigProvider<string>,
  ) => ProofProvider;
  readonly createWalletProofProvider: (
    api: ConnectedAPI,
    zkConfigProvider: ZKConfigProvider<string>,
  ) => Promise<ProofProvider>;
  readonly createPublicDataProvider: (
    indexerUri: string,
    indexerWsUri: string,
  ) => PublicDataProvider;
  readonly deserializeTransaction: (bytes: Uint8Array) => FinalizedTransaction;
  readonly setNetworkId: (networkId: string) => void;
  readonly fetchFunc?: typeof fetch;
};

type WalletKeys = {
  readonly coinPublicKey: string;
  readonly encryptionPublicKey: string;
  readonly shieldedAddress: string;
};

type WalletConfig = {
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly proverServerUri?: string;
  readonly networkId: string;
};

const SUPPORTED_NETWORK = "preprod";

/**
 * Wallets report the network id they define themselves, so casing is theirs;
 * only `mainnet` is connector-standard. Reconcile to the one id Milo signs
 * under: `preprod` and `PreProd` serialize to different ledger bytes.
 */
function canonicalNetworkId(network: string): string {
  if (network.trim().toLowerCase() !== SUPPORTED_NETWORK)
    throw new ChainError(
      "WRONG_NETWORK",
      `Only PREPROD is enabled. This wallet reports "${network}".`,
    );
  return SUPPORTED_NETWORK;
}

export const encodeHex = toHex;

export function decodeHex(text: string): Uint8Array {
  const normalized = text.startsWith("0x") ? text.slice(2) : text;
  if (normalized.length === 0 || normalized.length % 2 !== 0)
    throw new ChainError(
      "INVALID_REQUEST",
      "The wallet returned a transaction that is not a whole number of bytes.",
    );
  if (!/^[0-9a-f]+$/i.test(normalized))
    throw new ChainError(
      "INVALID_REQUEST",
      "The wallet returned a transaction that is not hex-encoded.",
    );
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(
      normalized.slice(index * 2, index * 2 + 2),
      16,
    );
  return bytes;
}

export async function readWalletKeys(
  connected: ConnectedAPI,
): Promise<WalletKeys> {
  if (typeof connected.getShieldedAddresses !== "function")
    throw new ChainError(
      "WALLET_UNAVAILABLE",
      "The connected wallet does not expose getShieldedAddresses; it cannot supply the coin and encryption public keys.",
    );
  const shielded = await connected.getShieldedAddresses();
  if (
    !shielded?.shieldedCoinPublicKey ||
    !shielded?.shieldedEncryptionPublicKey ||
    !shielded?.shieldedAddress
  )
    throw new ChainError(
      "WALLET_UNAVAILABLE",
      "The connected wallet returned an incomplete shielded address record; refusing to build providers from it.",
    );
  return {
    coinPublicKey: shielded.shieldedCoinPublicKey,
    encryptionPublicKey: shielded.shieldedEncryptionPublicKey,
    shieldedAddress: shielded.shieldedAddress,
  };
}

export async function readWalletConfig(
  connected: ConnectedAPI,
): Promise<WalletConfig> {
  if (typeof connected.getConfiguration !== "function")
    throw new ChainError(
      "WALLET_UNAVAILABLE",
      "The connected wallet does not expose getConfiguration; the indexer and proving endpoints are unknown.",
    );
  const configuration = await connected.getConfiguration();
  if (!configuration?.indexerUri || !configuration?.indexerWsUri)
    throw new ChainError(
      "WALLET_UNAVAILABLE",
      "The wallet returned no indexer endpoints; public chain data cannot be read.",
    );
  return {
    indexerUri: configuration.indexerUri,
    indexerWsUri: configuration.indexerWsUri,
    proverServerUri: configuration.proverServerUri,
    networkId: canonicalNetworkId(configuration.networkId),
  };
}

export function connectorWalletProvider(
  connected: ConnectedAPI,
  keys: WalletKeys,
  deserializeTransaction: (bytes: Uint8Array) => FinalizedTransaction,
): WalletProvider {
  return {
    getCoinPublicKey: () => keys.coinPublicKey,
    getEncryptionPublicKey: () => keys.encryptionPublicKey,
    async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      if (typeof connected.balanceUnsealedTransaction !== "function")
        throw new ChainError(
          "WALLET_UNAVAILABLE",
          "The connected wallet does not expose balanceUnsealedTransaction; it cannot pay fees for a contract call.",
        );
      const balanced = await connected.balanceUnsealedTransaction(
        encodeHex(tx.serialize()),
      );
      if (typeof balanced?.tx !== "string" || balanced.tx.length === 0)
        throw new ChainError(
          "WALLET_REJECTED",
          "The wallet returned no balanced transaction.",
        );
      return deserializeTransaction(decodeHex(balanced.tx));
    },
  };
}

export function connectorMidnightProvider(
  connected: ConnectedAPI,
): MidnightProvider {
  return {
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      if (typeof connected.submitTransaction !== "function")
        throw new ChainError(
          "WALLET_UNAVAILABLE",
          "The connected wallet does not expose submitTransaction; it cannot relay a transaction.",
        );
      await connected.submitTransaction(encodeHex(tx.serialize()));
      const identifiers = tx.identifiers();
      const txId = identifiers[0];
      if (typeof txId !== "string" || txId.length === 0)
        throw new ChainError(
          "TX_FAILED",
          "The submitted transaction carries no identifier, so it cannot be watched for finalization.",
        );
      return txId;
    },
  };
}

/** Holding NIGHT generates nothing on its own: the ledger only creates a DUST UTXO
 * once the key has a registration-table entry, which Lace's "Generate tDUST" writes.
 * Two different quantities are easy to conflate, so both are stated:
 *  - first spendable DUST: ~1-2 minutes after registering, and a first registration
 *    also credits what the UTXO would have generated since it arrived;
 *  - the cap: about 5 DUST per NIGHT, reached linearly over roughly a week.
 * So a wallet showing NIGHT and 0 DUST is the expected first-run state, not an edge
 * case. Read it before the first signing step instead of letting the wallet fail with
 * BalanceCheckOverspend after proving. */
export async function assertDustAvailable(
  connected: ConnectedAPI,
): Promise<void> {
  if (typeof connected.getDustBalance !== "function") return;
  const { balance } = await connected.getDustBalance();
  if (balance > 0n) return;
  throw new ChainError("INSUFFICIENT_DUST", messageFor("INSUFFICIENT_DUST"));
}

export async function assembleChainProviders<PS>(
  input: ChainProviderInput<PS>,
): Promise<ChainProviders<PS>> {
  const config = await readWalletConfig(input.connected);
  input.setNetworkId(config.networkId);

  const zkConfigProvider = input.createZkConfigProvider(
    input.zkBaseUrl,
    input.fetchFunc,
  );
  const publicDataProvider = input.createPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
  );

  // Capability decides the proving path, never wallet identity: the v4
  // connector deprecates proverServerUri in favour of getProvingProvider.
  const proving =
    typeof input.connected.getProvingProvider === "function"
      ? input.createWalletProofProvider(input.connected, zkConfigProvider)
      : config.proverServerUri
        ? Promise.resolve(
            input.createHttpProofProvider(
              config.proverServerUri,
              zkConfigProvider,
            ),
          )
        : null;
  if (!proving)
    throw new ChainError(
      "MISSING_PROOF_SERVER",
      messageFor("MISSING_PROOF_SERVER"),
    );

  // Three independent wallet reads: the shielded keys, the DUST balance and the
  // proving provider each need only the connection, so they overlap instead of
  // queueing. Awaiting them in the original order keeps the same error precedence
  // as the sequential version; the swallow handlers stop an early rejection of a
  // later-awaited promise being reported as unhandled.
  const keysTask = readWalletKeys(input.connected);
  const dustTask = assertDustAvailable(input.connected);
  keysTask.catch(() => {});
  dustTask.catch(() => {});
  const proofProvider = await proving;
  const keys = await keysTask;
  await dustTask;

  return {
    privateStateProvider: input.privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider: connectorWalletProvider(
      input.connected,
      keys,
      input.deserializeTransaction,
    ),
    midnightProvider: connectorMidnightProvider(input.connected),
    keys,
    // The configuration was already read here; returning it saves the caller a
    // second wallet round-trip for a value it would otherwise ask for again.
    networkId: config.networkId,
  };
}
