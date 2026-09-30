/**
 * Typed error taxonomy for the Midnight client boundary.
 *
 * Four codes cover the failure classes the wallet/proof/submit path must
 * distinguish (U6 milestone). Call sites throw subclasses; classifiers fold
 * wallet-sdk / Effect shapes into the same codes so integration and UI do not
 * invent parallel string matching.
 *
 * Error messages and `detail` fields are safe to surface: no secrets, no
 * private-state dumps, no raw witness material.
 */

export const MIDNIGHT_CLIENT_ERROR_CODES = [
  "REJECTED_SIGNATURE",
  "LOCKED_WALLET",
  "WRONG_NETWORK",
  "INSUFFICIENT_DUST",
] as const;

export type MidnightClientErrorCode =
  (typeof MIDNIGHT_CLIENT_ERROR_CODES)[number];

export type MidnightClientErrorDetail = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

/** Base class. `code` is the taxonomy discriminator. */
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

/** The wallet or user refused to sign / approve a request. */
export class RejectedSignatureError extends MidnightClientError {
  constructor(
    message = "Signature or wallet approval was rejected.",
    detail: MidnightClientErrorDetail = {},
  ) {
    super("REJECTED_SIGNATURE", message, detail);
    this.name = "RejectedSignatureError";
  }
}

/** The wallet is locked, disconnected, or otherwise unavailable. */
export class LockedWalletError extends MidnightClientError {
  constructor(
    message = "Wallet is locked or not connected.",
    detail: MidnightClientErrorDetail = {},
  ) {
    super("LOCKED_WALLET", message, detail);
    this.name = "LockedWalletError";
  }
}

/** The active network is not the one the guard allows. */
export class WrongNetworkError extends MidnightClientError {
  constructor(
    message = "Active Midnight network is not allowed by the network guard.",
    detail: MidnightClientErrorDetail = {},
  ) {
    super("WRONG_NETWORK", message, detail);
    this.name = "WrongNetworkError";
  }
}

/** The wallet cannot cover the DUST fee / balancing requirement. */
export class InsufficientDustError extends MidnightClientError {
  constructor(
    message = "Insufficient DUST to cover fees or balancing.",
    detail: MidnightClientErrorDetail = {},
  ) {
    super("INSUFFICIENT_DUST", message, detail);
    this.name = "InsufficientDustError";
  }
}

export function isMidnightClientError(
  value: unknown,
): value is MidnightClientError {
  return value instanceof MidnightClientError;
}

/**
 * Effect / wallet-sdk error walk. Same shape the dust readiness helper
 * understands (packages/integration/src/dust.mjs): FiberFailure causes, Fail
 * wrappers, Transacting causes, and Sequential/Parallel pairs. Hostile
 * getters must not crash the walk.
 */
function walkErrorGraph(error: unknown, limit = 16): object[] {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const collected: object[] = [];
  for (let count = 0; queue.length > 0 && count < limit; count++) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    collected.push(value);
    const read = (key: string | symbol): unknown => {
      try {
        return (value as Record<string | symbol, unknown>)[key];
      } catch {
        return undefined;
      }
    };
    const fiberCause = read(Symbol.for("effect/Runtime/FiberFailure/Cause"));
    if (fiberCause) queue.push(fiberCause);
    const tag = read("_tag");
    if (tag === "Fail") queue.push(read("error"));
    else if (tag === "Die") queue.push(read("defect"));
    else if (tag === "Wallet.Transacting" && read("cause"))
      queue.push(read("cause"));
    else if (tag === "Sequential" || tag === "Parallel") {
      queue.push(read("left"), read("right"));
    }
    queue.push(read("cause"));
  }
  return collected;
}

function firstTag(nodes: object[]): string | undefined {
  for (const node of nodes) {
    try {
      const tag = (node as Record<string, unknown>)["_tag"];
      if (typeof tag === "string") return tag;
    } catch {
      /* hostile getter: skip */
    }
  }
  return undefined;
}

function hasTag(nodes: object[], tag: string): boolean {
  return nodes.some((node) => {
    try {
      return (node as Record<string, unknown>)["_tag"] === tag;
    } catch {
      return false;
    }
  });
}

/** Wallet.InsufficientFunds limited to the DUST token. */
export function isInsufficientDustError(error: unknown): boolean {
  if (error instanceof InsufficientDustError) return true;
  const nodes = walkErrorGraph(error);
  return nodes.some((node) => {
    try {
      const record = node as Record<string, unknown>;
      return (
        record["_tag"] === "Wallet.InsufficientFunds" &&
        record["tokenType"] === "dust"
      );
    } catch {
      return false;
    }
  });
}

/**
 * Signature / approval refusal. Wallet.Sign is the wallet-sdk signing failure
 * tag (packages/integration/src/diagnostics.mjs). A bare Fail whose cause is a
 * RejectedSignatureError also matches.
 */
export function isRejectedSignatureError(error: unknown): boolean {
  if (error instanceof RejectedSignatureError) return true;
  const nodes = walkErrorGraph(error);
  if (hasTag(nodes, "Wallet.Sign")) return true;
  return nodes.some((node) => {
    try {
      const name = (node as Record<string, unknown>)["name"];
      return name === "RejectedSignatureError";
    } catch {
      return false;
    }
  });
}

/**
 * Locked / disconnected wallet. Covers the connector's not-connected throws
 * and the ConnectionError name the diagnostics sink already lists.
 */
export function isLockedWalletError(error: unknown): boolean {
  if (error instanceof LockedWalletError) return true;
  const nodes = walkErrorGraph(error);
  return nodes.some((node) => {
    try {
      const record = node as Record<string, unknown>;
      const name = record["name"];
      const message = record["message"];
      if (name === "LockedWalletError" || name === "ConnectionError") {
        return true;
      }
      return (
        typeof message === "string" &&
        /wallet is not connected|locked or not connected/i.test(message)
      );
    } catch {
      return false;
    }
  });
}

export function isWrongNetworkError(error: unknown): boolean {
  if (error instanceof WrongNetworkError) return true;
  const nodes = walkErrorGraph(error);
  return nodes.some((node) => {
    try {
      const record = node as Record<string, unknown>;
      if (record["name"] === "WrongNetworkError") return true;
      const message = record["message"];
      return (
        typeof message === "string" &&
        /unsupported midnight network|network guard|only preprod/i.test(message)
      );
    } catch {
      return false;
    }
  });
}

/**
 * Fold a wallet/SDK error into one taxonomy code, or null when it matches
 * none. Prefer constructing the subclass at the throw site; use this when
 * re-throwing an upstream error through the client boundary.
 */
export function classifyMidnightClientError(
  error: unknown,
): MidnightClientErrorCode | null {
  if (isMidnightClientError(error)) return error.code;
  if (isWrongNetworkError(error)) return "WRONG_NETWORK";
  if (isInsufficientDustError(error)) return "INSUFFICIENT_DUST";
  if (isRejectedSignatureError(error)) return "REJECTED_SIGNATURE";
  if (isLockedWalletError(error)) return "LOCKED_WALLET";
  return null;
}

/**
 * Re-throw `error` as the matching taxonomy subclass. Non-matching errors are
 * re-thrown unchanged so unknown failures stay visible.
 */
export function rethrowAsMidnightClientError(
  error: unknown,
  fallbackMessage: string,
): never {
  const code = classifyMidnightClientError(error);
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;
  const detail = {
    causeName: error instanceof Error ? error.name : undefined,
    causeTag: firstTag(walkErrorGraph(error)),
  };
  switch (code) {
    case "WRONG_NETWORK":
      throw new WrongNetworkError(message, detail);
    case "INSUFFICIENT_DUST":
      throw new InsufficientDustError(message, detail);
    case "REJECTED_SIGNATURE":
      throw new RejectedSignatureError(message, detail);
    case "LOCKED_WALLET":
      throw new LockedWalletError(message, detail);
    default:
      throw error;
  }
}
