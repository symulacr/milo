export type ChainErrorCode =
  | "WALLET_UNAVAILABLE"
  | "WALLET_REJECTED"
  | "PERMISSION_REJECTED"
  | "WALLET_DISCONNECTED"
  | "INVALID_REQUEST"
  | "WRONG_NETWORK"
  | "INSUFFICIENT_DUST"
  | "MISSING_PROOF_SERVER"
  | "ZK_ARTIFACT_UNAVAILABLE"
  | "WASM_UNAVAILABLE"
  | "CONTRACT_REJECTED"
  | "TX_FAILED"
  | "UNKNOWN";

export class ChainError extends Error {
  readonly code: ChainErrorCode;
  readonly detail?: string;

  constructor(code: ChainErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ChainError";
    this.code = code;
    this.detail = detail;
  }
}

const MESSAGES: Record<ChainErrorCode, string> = {
  WALLET_UNAVAILABLE:
    "Your wallet cannot do this step. Open it, set it to Midnight Preprod, and connect again.",
  WALLET_REJECTED:
    "You declined the request in your wallet. Approve it there to continue.",
  PERMISSION_REJECTED:
    "Your wallet did not give this site permission. Grant it there, then reload the page.",
  WALLET_DISCONNECTED:
    "The connection to your wallet stopped. Connect it again on Midnight Preprod.",
  INVALID_REQUEST:
    "Your wallet did not accept the transaction. Milo did not send it.",
  WRONG_NETWORK:
    "Set your wallet to Midnight Preprod. Milo does not use other networks.",
  INSUFFICIENT_DUST:
    "Your wallet has no tDUST for the fee. In your wallet, press Generate tDUST and keep it open a minute. If you have no tNIGHT yet, get some from the Preprod faucet first.",
  MISSING_PROOF_SERVER:
    "Your wallet has no proof service for this step. Turn on proving in your wallet, then try again.",
  ZK_ARTIFACT_UNAVAILABLE:
    "The contract keys did not load. Reload the page and try again.",
  WASM_UNAVAILABLE:
    "The Midnight runtime did not load in this browser. Reload the page.",
  CONTRACT_REJECTED:
    "The contract did not accept this step. The order is not in the correct state for it. Reload the order.",
  TX_FAILED:
    "The network did not accept the transaction. The step is not complete. Try again.",
  UNKNOWN: "The step did not complete.",
};
/** A wallet reports a code as a connector name or a ledger number; read both.
 * `138` is `BalanceCheckOverspend`: no DUST for the fee. */
const codeOf = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { code?: unknown }).code;
  return candidate === undefined ? undefined : String(candidate);
};

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return typeof error === "string" ? error : "";
};

const BY_CODE: Record<string, ChainErrorCode> = {
  Rejected: "WALLET_REJECTED",
  PermissionRejected: "PERMISSION_REJECTED",
  Disconnected: "WALLET_DISCONNECTED",
  InvalidRequest: "INVALID_REQUEST",
  InternalError: "WALLET_UNAVAILABLE",
  138: "INSUFFICIENT_DUST",
};

const BY_MESSAGE: readonly (readonly [RegExp, ChainErrorCode])[] = [
  [
    /insufficient.?dust|not enough dust|dust.?balance|insufficient.?funds|cannot pay fee|balancecheckoverspend/i,
    "INSUFFICIENT_DUST",
  ],
  [
    /failed to fetch zk artifact|text\/html from|zk artifact/i,
    "ZK_ARTIFACT_UNAVAILABLE",
  ],
  [/webassembly|wasm|__wbindgen/i, "WASM_UNAVAILABLE"],
  // A wallet can expose a method it does not implement; that is unavailability.
  [/method not implemented|not a function/i, "WALLET_UNAVAILABLE"],
  [/disconnected|not connected|connection lost/i, "WALLET_DISCONNECTED"],
  [/wrong network|unsupported network|mainnet|not preprod/i, "WRONG_NETWORK"],
  [/deploytxfailederror|calltxfailederror|txfailederror/i, "TX_FAILED"],
  [
    /failed assert|reverted|contract call failed|call tx failed/i,
    "CONTRACT_REJECTED",
  ],
];

export function toChainError(error: unknown): ChainError {
  if (error instanceof ChainError) return error;
  const message = messageOf(error);
  const code =
    BY_CODE[codeOf(error) ?? ""] ??
    BY_MESSAGE.find(([pattern]) => pattern.test(message))?.[1] ??
    "UNKNOWN";
  return new ChainError(
    code,
    code === "UNKNOWN"
      ? `${MESSAGES.UNKNOWN} ${error instanceof Error ? error.message : String(error)}`
      : MESSAGES[code],
    message,
  );
}

export function messageFor(code: ChainErrorCode): string {
  return MESSAGES[code];
}
