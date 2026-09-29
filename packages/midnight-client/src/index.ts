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
} from "./circuits";
export {
  assertSupportedNetwork,
  encodeNetworkLabel,
  NETWORK_LABEL_BYTES,
  SUPPORTED_MIDNIGHT_NETWORK,
  type SupportedMidnightNetwork,
} from "./network";
export {
  type BuyerPrivateState,
  type Configuration,
  type MerchantPrivateState,
  Phase,
  Role,
  type Terms,
} from "./types";
export {
  assertWalletConnected,
  discoverWallets,
  LaceWalletConnector,
  verifyPreprodConnection,
  type WalletAccount,
  type WalletConnectionState,
  type WalletConnector,
  type WalletRegistry,
} from "./wallet";
export {
  MidnightWalletSdkConnector,
  type WalletSdkSession,
  type WalletSdkStatusAPI,
  walletSdkConnectedApi,
  walletSdkInitialApi,
  walletSdkStatusApi,
} from "./wallet-sdk-connector";
