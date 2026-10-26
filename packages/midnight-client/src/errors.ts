export const MIDNIGHT_CLIENT_ERROR_CODES = [
  "REJECTED_SIGNATURE",
  "LOCKED_WALLET",
  "WRONG_NETWORK",
  "INSUFFICIENT_DUST",
] as const;

export type MidnightClientErrorCode =
  (typeof MIDNIGHT_CLIENT_ERROR_CODES)[number];

type MidnightClientErrorDetail = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export class MidnightClientError extends Error {
  readonly code: MidnightClientErrorCode;
  readonly detail: MidnightClientErrorDetail;
  constructor(
    code: MidnightClientErrorCode,
    message: string,
    detail: MidnightClientErrorDetail = {},
  ) {
    super(message);
    this.name = "MidnightClientError";
    this.code = code;
    this.detail = detail;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type D = MidnightClientErrorDetail;

export class RejectedSignatureError extends MidnightClientError {
  constructor(m = "Signature or wallet approval was rejected.", d: D = {}) {
    super("REJECTED_SIGNATURE", m, d);
    this.name = "RejectedSignatureError";
  }
}

export class LockedWalletError extends MidnightClientError {
  constructor(m = "Wallet is locked or not connected.", d: D = {}) {
    super("LOCKED_WALLET", m, d);
    this.name = "LockedWalletError";
  }
}

export class WrongNetworkError extends MidnightClientError {
  constructor(
    m = "Active Midnight network is not allowed by the network guard.",
    d: D = {},
  ) {
    super("WRONG_NETWORK", m, d);
    this.name = "WrongNetworkError";
  }
}

export class InsufficientDustError extends MidnightClientError {
  constructor(m = "Insufficient DUST to cover fees or balancing.", d: D = {}) {
    super("INSUFFICIENT_DUST", m, d);
    this.name = "InsufficientDustError";
  }
}

function isMidnightClientError(value: unknown): value is MidnightClientError {
  return value instanceof MidnightClientError;
}

const FIBER_CAUSE = Symbol.for("effect/Runtime/FiberFailure/Cause");
const LOCKED_MESSAGE = /wallet is not connected|locked or not connected/i;
const NETWORK_MESSAGE =
  /unsupported midnight network|network guard|only preprod/i;
const LOCKED_NAMES = new Set(["LockedWalletError", "ConnectionError"]);
const PAIR_TAGS = new Set(["Sequential", "Parallel"]);

function field(node: unknown, key: string | symbol): unknown {
  try {
    return (node as Record<string | symbol, unknown>)[key];
  } catch {
    return undefined;
  }
}

function walkErrorGraph(error: unknown, limit = 16): object[] {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const collected: object[] = [];
  for (let count = 0; queue.length > 0 && count < limit; count++) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    collected.push(value);
    const fiberCause = field(value, FIBER_CAUSE);
    if (fiberCause) queue.push(fiberCause);
    const tag = field(value, "_tag");
    if (tag === "Fail") queue.push(field(value, "error"));
    else if (tag === "Die") queue.push(field(value, "defect"));
    else if (tag === "Wallet.Transacting" && field(value, "cause"))
      queue.push(field(value, "cause"));
    else if (typeof tag === "string" && PAIR_TAGS.has(tag))
      queue.push(field(value, "left"), field(value, "right"));
    queue.push(field(value, "cause"));
  }
  return collected;
}

function firstTag(nodes: object[]): string | undefined {
  for (const node of nodes) {
    const tag = field(node, "_tag");
    if (typeof tag === "string") return tag;
  }
  return undefined;
}

function matchesMessage(nodes: object[], pattern: RegExp): boolean {
  return nodes.some((node) => {
    const message = field(node, "message");
    return typeof message === "string" && pattern.test(message);
  });
}

type Probe = (nodes: object[]) => boolean;

const PROBES: Record<MidnightClientErrorCode, Probe> = {
  INSUFFICIENT_DUST: (nodes) =>
    nodes.some(
      (node) =>
        field(node, "_tag") === "Wallet.InsufficientFunds" &&
        field(node, "tokenType") === "dust",
    ),
  REJECTED_SIGNATURE: (nodes) =>
    nodes.some((node) => field(node, "_tag") === "Wallet.Sign") ||
    nodes.some((node) => field(node, "name") === "RejectedSignatureError"),
  LOCKED_WALLET: (nodes) =>
    nodes.some((node) => {
      const name = field(node, "name");
      return typeof name === "string" && LOCKED_NAMES.has(name);
    }) || matchesMessage(nodes, LOCKED_MESSAGE),
  WRONG_NETWORK: (nodes) =>
    nodes.some((node) => field(node, "name") === "WrongNetworkError") ||
    matchesMessage(nodes, NETWORK_MESSAGE),
};

const SUBCLASSES: Record<
  MidnightClientErrorCode,
  new (
    message: string,
    detail: D,
  ) => MidnightClientError
> = {
  REJECTED_SIGNATURE: RejectedSignatureError,
  LOCKED_WALLET: LockedWalletError,
  WRONG_NETWORK: WrongNetworkError,
  INSUFFICIENT_DUST: InsufficientDustError,
};

const CLASSIFY_ORDER: readonly MidnightClientErrorCode[] = [
  "WRONG_NETWORK",
  "INSUFFICIENT_DUST",
  "REJECTED_SIGNATURE",
  "LOCKED_WALLET",
];

function probe(code: MidnightClientErrorCode, error: unknown): boolean {
  return PROBES[code](walkErrorGraph(error));
}

export const isInsufficientDustError = (error: unknown): boolean =>
  error instanceof InsufficientDustError || probe("INSUFFICIENT_DUST", error);
export const isRejectedSignatureError = (error: unknown): boolean =>
  error instanceof RejectedSignatureError || probe("REJECTED_SIGNATURE", error);
export const isLockedWalletError = (error: unknown): boolean =>
  error instanceof LockedWalletError || probe("LOCKED_WALLET", error);
export const isWrongNetworkError = (error: unknown): boolean =>
  error instanceof WrongNetworkError || probe("WRONG_NETWORK", error);

export function classifyMidnightClientError(
  error: unknown,
): MidnightClientErrorCode | null {
  if (isMidnightClientError(error)) return error.code;
  const nodes = walkErrorGraph(error);
  for (const code of CLASSIFY_ORDER) {
    if (PROBES[code](nodes)) return code;
  }
  return null;
}

export function rethrowAsMidnightClientError(
  error: unknown,
  fallbackMessage: string,
): never {
  const code = classifyMidnightClientError(error);
  if (!code) throw error;
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;
  throw new SUBCLASSES[code](message, {
    causeName: error instanceof Error ? error.name : undefined,
    causeTag: firstTag(walkErrorGraph(error)),
  });
}
