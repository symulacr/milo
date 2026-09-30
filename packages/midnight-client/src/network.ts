/**
 * Browser Midnight network lock and the U6 network guard.
 *
 * Compile-time: `SupportedMidnightNetwork` is the literal `"preprod"` and
 * `LocalDisposableNetwork` is `"undeployed"`. `NetworkForGuard<M>` narrows the
 * allowed id per guard mode so a mistyped call fails `tsc`, not just at runtime.
 *
 * Runtime: `assertNetworkGuard(network, mode)` fails closed with
 * `WrongNetworkError`. Two explicit switches:
 *   - `"preprod-only"`     — browser / product path; Mainnet and local ids blocked
 *   - `"undeployed-only"`  — disposable local lane; Preprod/Mainnet blocked
 *
 * Consistent with packages/backend/src/public-config.ts
 * (`midnightNetwork: z.literal("preprod")`) and
 * packages/integration/src/config.mjs (`MILO_LOCAL_NETWORK_ID === "undeployed"`).
 */

import { WrongNetworkError } from "./errors.ts";

/** Product/browser network. The only id the browser connector accepts. */
export const SUPPORTED_MIDNIGHT_NETWORK = "preprod" as const;
export type SupportedMidnightNetwork = typeof SUPPORTED_MIDNIGHT_NETWORK;

/** Disposable local-lane network id (packages/integration/src/config.mjs). */
export const LOCAL_DISPOSABLE_NETWORK = "undeployed" as const;
export type LocalDisposableNetwork = typeof LOCAL_DISPOSABLE_NETWORK;

/**
 * Explicit network-guard switches. A guard is a policy, not a default:
 * callers must name which one they enforce.
 */
export const NETWORK_GUARD_MODES = [
  "preprod-only",
  "undeployed-only",
] as const;
export type NetworkGuardMode = (typeof NETWORK_GUARD_MODES)[number];

/** Compile-time narrowing: the network id each guard mode allows. */
export type NetworkForGuard<M extends NetworkGuardMode> =
  M extends "preprod-only"
    ? SupportedMidnightNetwork
    : M extends "undeployed-only"
      ? LocalDisposableNetwork
      : never;

/** Networks each runtime guard accepts (runtime twin of `NetworkForGuard`). */
export const NETWORK_GUARD_ALLOWED: Readonly<
  Record<NetworkGuardMode, ReadonlySet<string>>
> = {
  "preprod-only": new Set<string>([SUPPORTED_MIDNIGHT_NETWORK]),
  "undeployed-only": new Set<string>([LOCAL_DISPOSABLE_NETWORK]),
};

/** Compact `Bytes<32>` network label: UTF-8 right-padded with zeros. */
export const NETWORK_LABEL_BYTES = 32;

export function isNetworkGuardMode(value: unknown): value is NetworkGuardMode {
  return (
    typeof value === "string" &&
    (NETWORK_GUARD_MODES as readonly string[]).includes(value)
  );
}

/**
 * Runtime network guard. Throws `WrongNetworkError` unless `network` is
 * allowed by `mode`. Assertion signature also narrows the type so callers
 * get compile-time proof after the call.
 */
export function assertNetworkGuard<M extends NetworkGuardMode>(
  network: string,
  mode: M,
): asserts network is NetworkForGuard<M> {
  if (!isNetworkGuardMode(mode)) {
    throw new WrongNetworkError(`Unknown network guard mode "${String(mode)}".`, {
      mode: String(mode),
    });
  }
  const allowed = NETWORK_GUARD_ALLOWED[mode];
  if (!allowed.has(network)) {
    throw new WrongNetworkError(
      `Unsupported Midnight network "${network}" for guard "${mode}". Allowed: ${[...allowed].join(", ")}.`,
      { network, mode, allowed: [...allowed].join(",") },
    );
  }
}

/**
 * Fail closed on any network other than PREPROD. Throws `WrongNetworkError`
 * rather than coercing. This is the `"preprod-only"` guard.
 */
export function assertSupportedNetwork(
  network: string,
): asserts network is SupportedMidnightNetwork {
  assertNetworkGuard(network, "preprod-only");
}

/**
 * Fail closed unless the network is the disposable `undeployed` local id.
 * This is the `"undeployed-only"` guard (local integration lane).
 */
export function assertLocalDisposableNetwork(
  network: string,
): asserts network is LocalDisposableNetwork {
  assertNetworkGuard(network, "undeployed-only");
}

/**
 * Encode a network label the way the order constructor does
 * (packages/backend/src/public-constructor.mjs and packages/integration/src/order.mjs):
 * UTF-8 bytes right-padded with zeros to 32.
 */
export function encodeNetworkLabel(
  network: SupportedMidnightNetwork | LocalDisposableNetwork,
): Uint8Array {
  if (
    network !== SUPPORTED_MIDNIGHT_NETWORK &&
    network !== LOCAL_DISPOSABLE_NETWORK
  ) {
    throw new WrongNetworkError(
      `Cannot encode network label for "${network}".`,
      { network },
    );
  }
  const label = new Uint8Array(NETWORK_LABEL_BYTES);
  const encoded = new TextEncoder().encode(network);
  if (encoded.length > NETWORK_LABEL_BYTES) {
    throw new WrongNetworkError("Network label exceeds Bytes<32>", {
      network,
    });
  }
  label.set(encoded);
  return label;
}
