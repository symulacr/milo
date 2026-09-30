/**
 * @milo/midnight-client — browser-oriented Midnight client foundation.
 *
 * Minimal exports only. Wave B (buyer reserve UI) imports from here;
 * see README.md for the wiring plan.
 */

export {
  type AcceptCallInput,
  type AcceptRequest,
  type AssembledProviders,
  assembleProviders,
  type MidnightProviderSlots,
  type OrderCircuitRequest,
  type PreparedAcceptCall,
  type PreparedReserveCall,
  type ProviderAssemblyInput,
  prepareAcceptCall,
  prepareReserveCall,
  type ReserveCallInput,
  type ReserveRequest,
  WALLET_SIGNED_RESERVE_RUNTIME,
  type WalletSignedReserveRuntime,
} from "./circuits.ts";
export {
  assertSupportedNetwork,
  encodeNetworkLabel,
  NETWORK_LABEL_BYTES,
  SUPPORTED_MIDNIGHT_NETWORK,
  type SupportedMidnightNetwork,
} from "./network.ts";
export {
  type BuyerPrivateState,
  type Configuration,
  type MerchantPrivateState,
  Phase,
  Role,
  type Terms,
} from "./types.ts";
export {
  assertWalletConnected,
  discoverWallets,
  LaceWalletConnector,
  verifyPreprodConnection,
  type WalletAccount,
  type WalletConnectionState,
  type WalletConnector,
  type WalletRegistry,
} from "./wallet.ts";
export {
  MidnightWalletSdkConnector,
  type WalletSdkSession,
  type WalletSdkStatusAPI,
  walletSdkConnectedApi,
  walletSdkInitialApi,
  walletSdkStatusApi,
} from "./wallet-sdk-connector.ts";
export {
  classifyMidnightClientError,
  InsufficientDustError,
  isInsufficientDustError,
  isLockedWalletError,
  isMidnightClientError,
  isRejectedSignatureError,
  isWrongNetworkError,
  LockedWalletError,
  MIDNIGHT_CLIENT_ERROR_CODES,
  MidnightClientError,
  type MidnightClientErrorCode,
  type MidnightClientErrorDetail,
  rethrowAsMidnightClientError,
  RejectedSignatureError,
  WrongNetworkError,
} from "./errors.ts";
export {
  assembleProviderFactory,
  assembleProvidersFromSlots,
  buildMidnightProvider,
  buildProofProvider,
  buildWalletProvider,
  type BalanceStrategy,
  type FactoryEvent,
  missingProviderSlots,
  type ProviderFactoryInput,
  REQUIRED_PROVIDER_SLOTS,
  type WalletActor,
  type WalletSecretKeys,
} from "./provider-factory.ts";
export {
  assertLocalDisposableNetwork,
  assertNetworkGuard,
  LOCAL_DISPOSABLE_NETWORK,
  type LocalDisposableNetwork,
  type NetworkForGuard,
  NETWORK_GUARD_ALLOWED,
  NETWORK_GUARD_MODES,
  type NetworkGuardMode,
} from "./network.ts";
