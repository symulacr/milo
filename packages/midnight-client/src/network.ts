/**
 * Browser Midnight network lock. Only PREPROD is enabled; Mainnet is blocked
 * everywhere this package can reach a wallet or a circuit call.
 *
 * Consistent with packages/backend/src/public-config.ts
 * (`midnightNetwork: z.literal("preprod")`).
 */

export const SUPPORTED_MIDNIGHT_NETWORK = "preprod" as const;
export type SupportedMidnightNetwork = typeof SUPPORTED_MIDNIGHT_NETWORK;

/** Compact `Bytes<32>` network label: UTF-8 right-padded with zeros. */
export const NETWORK_LABEL_BYTES = 32;

/**
 * Fail closed on any network other than PREPROD. Throws rather than coercing.
 */
export function assertSupportedNetwork(
  network: string,
): asserts network is SupportedMidnightNetwork {
  if (network !== SUPPORTED_MIDNIGHT_NETWORK) {
    throw new Error(
      `Unsupported Midnight network "${network}". Only PREPROD is enabled; Mainnet is blocked.`,
    );
  }
}

/**
 * Encode a network label the way the order constructor does
 * (packages/backend/src/public-constructor.mjs and packages/integration/src/order.mjs):
 * UTF-8 bytes right-padded with zeros to 32.
 */
export function encodeNetworkLabel(
  network: SupportedMidnightNetwork,
): Uint8Array {
  assertSupportedNetwork(network);
  const label = new Uint8Array(NETWORK_LABEL_BYTES);
  const encoded = new TextEncoder().encode(network);
  if (encoded.length > NETWORK_LABEL_BYTES) {
    throw new Error("Network label exceeds Bytes<32>");
  }
  label.set(encoded);
  return label;
}
