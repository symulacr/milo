import { WrongNetworkError } from "./errors.ts";

export const SUPPORTED_MIDNIGHT_NETWORK = "preprod" as const;
export type SupportedMidnightNetwork = typeof SUPPORTED_MIDNIGHT_NETWORK;

export const LOCAL_DISPOSABLE_NETWORK = "undeployed" as const;
export type LocalDisposableNetwork = typeof LOCAL_DISPOSABLE_NETWORK;

export const NETWORK_GUARD_MODES = ["preprod-only", "undeployed-only"] as const;
export type NetworkGuardMode = (typeof NETWORK_GUARD_MODES)[number];

export type NetworkForGuard<M extends NetworkGuardMode> =
  M extends "preprod-only"
    ? SupportedMidnightNetwork
    : M extends "undeployed-only"
      ? LocalDisposableNetwork
      : never;

export const NETWORK_GUARD_ALLOWED: Readonly<
  Record<NetworkGuardMode, ReadonlySet<string>>
> = {
  "preprod-only": new Set([SUPPORTED_MIDNIGHT_NETWORK]),
  "undeployed-only": new Set([LOCAL_DISPOSABLE_NETWORK]),
};

export const NETWORK_LABEL_BYTES = 32;

const ENCODER = new TextEncoder();

export function isNetworkGuardMode(value: unknown): value is NetworkGuardMode {
  return (
    typeof value === "string" &&
    (NETWORK_GUARD_MODES as readonly string[]).includes(value)
  );
}

export function assertNetworkGuard<M extends NetworkGuardMode>(
  network: string,
  mode: M,
): asserts network is NetworkForGuard<M> {
  if (!isNetworkGuardMode(mode))
    throw new WrongNetworkError(
      `Unknown network guard mode "${String(mode)}".`,
      { mode: String(mode) },
    );
  const allowed = NETWORK_GUARD_ALLOWED[mode];
  if (!allowed.has(network))
    throw new WrongNetworkError(
      `Unsupported Midnight network "${network}" for guard "${mode}". Allowed: ${[...allowed].join(", ")}.`,
      { network, mode, allowed: [...allowed].join(",") },
    );
}

export function assertSupportedNetwork(
  network: string,
): asserts network is SupportedMidnightNetwork {
  assertNetworkGuard(network, "preprod-only");
}

export function assertLocalDisposableNetwork(
  network: string,
): asserts network is LocalDisposableNetwork {
  assertNetworkGuard(network, "undeployed-only");
}

export function encodeNetworkLabel(
  network: SupportedMidnightNetwork | LocalDisposableNetwork,
): Uint8Array {
  if (
    network !== SUPPORTED_MIDNIGHT_NETWORK &&
    network !== LOCAL_DISPOSABLE_NETWORK
  )
    throw new WrongNetworkError(
      `Cannot encode network label for "${network}".`,
      { network },
    );
  const label = new Uint8Array(NETWORK_LABEL_BYTES);
  const encoded = ENCODER.encode(network);
  if (encoded.length > NETWORK_LABEL_BYTES)
    throw new WrongNetworkError("Network label exceeds Bytes<32>", { network });
  label.set(encoded);
  return label;
}
