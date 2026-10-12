// Blockfrost Preprod endpoint configuration and token validation.
//
// The Midnight-hosted Preprod indexer and node RPC were decommissioned from 22:00 UTC on
// 2026-10-09. Blockfrost now serves both, and every request needs a Midnight Preprod
// project token. The token must travel as the `project_id` QUERY PARAMETER, not a header:
// the wallet SDK's indexer client takes a plain URL with no header hook
// (wallet-sdk-indexer-client 1.2.3 ServerConfig is `{ url }` only), and browser WebSockets
// cannot set headers. Blockfrost accepts the same token as a header too, but the SDKs used
// here cannot send one.
//
// Fail closed. A missing, malformed, or wrong-network token is a named error before any
// network I/O, never a 403 discovered deep inside a wallet sync. The endpoint URLs are
// validated the same way the local profile validates its loopback endpoints: an explicit
// protocol, no credentials, no fragment, and exactly one `project_id` parameter.

/** Midnight Preprod project ids start with this; Mainnet ids start with `nightmainnet`. */
const PREPROD_TOKEN_PREFIX = "nightpreprod";
const MAINNET_TOKEN_PREFIX = "nightmainnet";

/**
 * Bare Blockfrost Preprod service bases, WITHOUT the token. These are the defaults the
 * `MIDNIGHT_PREPROD_*` overrides replace; the token is appended per call so a token never
 * lives in a module-level constant.
 */
export const PREPROD_BLOCKFROST_BASES = Object.freeze({
  node: "https://rpc.midnight-preprod.blockfrost.io",
  nodeWS: "wss://rpc.midnight-preprod.blockfrost.io",
  indexer: "https://midnight-preprod.blockfrost.io/api/v0",
  indexerWS: "wss://midnight-preprod.blockfrost.io/api/v0/ws",
});

/** A configuration fault that must stop a run before it touches the network. */
export class BlockfrostConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockfrostConfigError";
  }
}

/**
 * Append the Blockfrost `project_id` query parameter to a URL exactly once. A URL that
 * already carries a `project_id` keeps exactly one (the value is replaced), so calling this
 * twice is idempotent and a doubled parameter can never be produced. Uses URLSearchParams so
 * the token is percent-encoded.
 */
export function withBlockfrostKey(url, token) {
  if (typeof url !== "string" || url.length === 0) {
    throw new BlockfrostConfigError("Blockfrost endpoint URL is required");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new BlockfrostConfigError("Blockfrost project token is required");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockfrostConfigError(`Invalid Blockfrost endpoint URL: ${url}`);
  }
  if (parsed.username || parsed.password) {
    throw new BlockfrostConfigError(
      "Blockfrost endpoint URL must not carry credentials",
    );
  }
  if (parsed.hash) {
    throw new BlockfrostConfigError(
      "Blockfrost endpoint URL must not carry a fragment",
    );
  }
  if (parsed.searchParams.getAll("project_id").length > 1) {
    throw new BlockfrostConfigError(
      "Blockfrost endpoint URL already carries more than one project_id parameter",
    );
  }
  parsed.searchParams.set("project_id", token);
  return parsed.href;
}

/**
 * Read and validate the required Midnight Preprod Blockfrost token. Rejects a Mainnet token
 * by name (the network-mismatch 403) and any token without the `nightpreprod` prefix.
 */
export function blockfrostProjectId(env = {}) {
  const raw = env.MILO_PREPROD_BLOCKFROST_PROJECT_ID;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BlockfrostConfigError(
      "MILO_PREPROD_BLOCKFROST_PROJECT_ID is required (a Blockfrost Midnight Preprod project token)",
    );
  }
  const token = raw.trim();
  if (token.startsWith(MAINNET_TOKEN_PREFIX)) {
    throw new BlockfrostConfigError(
      "MILO_PREPROD_BLOCKFROST_PROJECT_ID is a Midnight Mainnet token (nightmainnet); a Midnight Preprod token (nightpreprod) is required",
    );
  }
  if (!token.startsWith(PREPROD_TOKEN_PREFIX)) {
    throw new BlockfrostConfigError(
      `MILO_PREPROD_BLOCKFROST_PROJECT_ID must start with "${PREPROD_TOKEN_PREFIX}"`,
    );
  }
  if (!/^nightpreprod[0-9A-Za-z]+$/.test(token)) {
    throw new BlockfrostConfigError(
      "MILO_PREPROD_BLOCKFROST_PROJECT_ID is not a well-formed Blockfrost project id",
    );
  }
  return token;
}

/** Validate one endpoint base before the token is appended. */
function assertEndpointBase(key, raw, protocols) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BlockfrostConfigError(`Invalid ${key} endpoint: ${raw}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new BlockfrostConfigError(
      `${key} must be a ${protocols.join(" or ")} URL`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new BlockfrostConfigError(`${key} must not carry credentials`);
  }
  if (parsed.hash) {
    throw new BlockfrostConfigError(`${key} must not carry a fragment`);
  }
  return parsed.href;
}

/**
 * Resolve the four Preprod service endpoints from the environment, with the Blockfrost bases
 * as defaults and the existing endpoint overrides still honoured so an operator can point at
 * a local stub. The lane documents `MIDNIGHT_PREPROD_*` names; the profile uses
 * `MILO_PREPROD_*`; both are accepted, `MIDNIGHT_PREPROD_*` first. Every returned URL carries
 * the token exactly once.
 */
export function blockfrostPreprodEndpoints(env = {}) {
  const token = blockfrostProjectId(env);
  const base = (key, overrideKeys, protocols) => {
    let raw = PREPROD_BLOCKFROST_BASES[key];
    for (const overrideKey of overrideKeys) {
      if (env[overrideKey] !== undefined) {
        raw = env[overrideKey];
        break;
      }
    }
    return withBlockfrostKey(assertEndpointBase(key, raw, protocols), token);
  };
  return Object.freeze({
    indexer: base(
      "indexer",
      ["MIDNIGHT_PREPROD_INDEXER_HTTP", "MILO_PREPROD_INDEXER_HTTP"],
      ["http:", "https:"],
    ),
    indexerWS: base(
      "indexerWS",
      ["MIDNIGHT_PREPROD_INDEXER_WS", "MILO_PREPROD_INDEXER_WS"],
      ["ws:", "wss:"],
    ),
    node: base(
      "node",
      ["MIDNIGHT_PREPROD_NODE", "MILO_PREPROD_NODE"],
      ["http:", "https:"],
    ),
    nodeWS: base(
      "nodeWS",
      ["MIDNIGHT_PREPROD_NODE_WS", "MILO_PREPROD_NODE_WS"],
      ["ws:", "wss:"],
    ),
  });
}

/** The host of an endpoint URL, for a receipt that must not record the token. */
export function blockfrostHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Replace the `project_id` value in a URL with `<redacted>` for logs and receipts. The token
 * in an endpoint URL is a live credential; anything that prints or persists a URL must pass
 * it through here first.
 */
export function redactBlockfrostUrl(url) {
  if (typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("project_id")) {
      parsed.searchParams.set("project_id", "<redacted>");
    }
    return parsed.href;
  } catch {
    return url;
  }
}
