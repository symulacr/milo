// Transaction submission to the Midnight node.
//
// Two transports failed before this one, for two different reasons, and both are recorded
// here because the workaround depends on the distinction:
//
//  1. The wallet SDK submits through polkadot-js `tx.send()`, which calls
//     author_submitAndWatchExtrinsic - a SUBSCRIPTION. Preprod's relay closes subscriptions
//     with 1000 Normal Closure, so a registration was built, proven and lost at the last
//     step.
//  2. author_submitExtrinsic over HTTPS works, and carried the registration to chain (block
//     2634013), but the endpoint sits behind an AWS load balancer (server: awselb/2.0) that
//     rejects large request bodies with HTTP 403. A proven deploy transaction is far larger
//     than a registration, so it was refused: 40 bytes returned 200, 100 KB returned 403.
//
// A plain (non-subscription) author_submitExtrinsic request sent over the node's WebSocket
// has neither problem: it is a single request/response, and a WebSocket frame stream is not
// subject to the load balancer's body limit. Verified live: the same 100 KB payload that
// returned HTTP 403 returned a normal JSON-RPC decode error over the socket, so the node
// received it in full.
//
// The call is unsigned on purpose, matching PolkadotNodeClient
// (api.tx.midnight.sendMnTransaction(...).send(...) with no signer): the Midnight
// transaction carries its own signatures and the pallet validates it.
import { resolve } from "node:path";

/** Submit over the node's WebSocket as a plain request. Any payload size. */
export async function submitExtrinsicOverSocket(
  config,
  extrinsicHex,
  { WebSocketImpl, timeoutMs = 120_000 } = {},
) {
  const Ctor = WebSocketImpl ?? (await import("ws")).WebSocket;
  const url = config.node.replace(/^https/, "wss");
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new Ctor(url);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // The socket may already be gone; the outcome is decided either way.
      }
      fn(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new Error("timed out submitting over the node WebSocket"),
        ),
      timeoutMs,
    );
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "author_submitExtrinsic",
          params: [extrinsicHex],
        }),
      ),
    );
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.id !== 1) return;
      if (message.error) {
        const data = message.error.data ? ` (${message.error.data})` : "";
        finish(
          reject,
          new Error(
            `node rejected the submission: ${message.error.code} ${message.error.message}${data}`,
          ),
        );
      } else if (typeof message.result === "string") {
        finish(resolve, message.result);
      } else {
        finish(
          reject,
          new Error(
            `node returned no extrinsic hash: ${JSON.stringify(message)}`,
          ),
        );
      }
    });
    ws.on("error", (error) =>
      finish(reject, new Error(`node WebSocket error: ${error.message}`)),
    );
  });
}

/** HTTPS fallback. Works for small payloads only; the load balancer 403s large ones. */
export async function submitExtrinsicOverHttp(config, extrinsicHex, fetchImpl) {
  const response = await fetchImpl(config.node, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "author_submitExtrinsic",
      params: [extrinsicHex],
    }),
  });
  const body = await response.json().catch(() => null);
  if (!body)
    throw new Error(`node returned a non-JSON reply (HTTP ${response.status})`);
  if (body.error) {
    const data = body.error.data ? ` (${body.error.data})` : "";
    throw new Error(
      `node rejected the submission: ${body.error.code} ${body.error.message}${data}`,
    );
  }
  if (typeof body.result !== "string" || !body.result.startsWith("0x"))
    throw new Error(`node returned no extrinsic hash: ${JSON.stringify(body)}`);
  return body.result;
}

/**
 * Submitter bound to one run. The relay WebSocket is opened lazily and only to read the
 * runtime metadata needed to encode the extrinsic; submission itself is a plain
 * request/response over its own socket, with the HTTPS path kept as a fallback.
 */
export function createHttpSubmitter(config, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const WebSocketImpl = deps.WebSocket;
  let apiPromise = null;

  async function metadataApi() {
    if (apiPromise) return apiPromise;
    const { ApiPromise, WsProvider } = await import("@polkadot/api");
    apiPromise = await ApiPromise.create({
      provider: new WsProvider(config.node.replace(/^https/, "wss")),
      noInitWarn: true,
    });
    return apiPromise;
  }

  return {
    /** @param {{ serialize: () => Uint8Array }} finalized */
    async submit(finalized) {
      if (typeof finalized?.serialize !== "function")
        throw new Error(
          "submit expects a finalized transaction with serialize()",
        );
      const bytes = finalized.serialize();
      const api = await metadataApi();
      const extrinsicHex = api.tx.midnight
        .sendMnTransaction(`0x${Buffer.from(bytes).toString("hex")}`)
        .toHex();
      try {
        return await submitExtrinsicOverSocket(config, extrinsicHex, {
          WebSocketImpl,
        });
      } catch (socketError) {
        try {
          return await submitExtrinsicOverHttp(config, extrinsicHex, fetchImpl);
        } catch (httpError) {
          throw new Error(
            `submission failed on both transports: socket: ${socketError.message}; https: ${httpError.message}`,
          );
        }
      }
    },
    async close() {
      if (!apiPromise) return;
      try {
        await (await apiPromise).disconnect();
      } catch {
        // Closing a socket that already went away is not an error worth surfacing.
      }
      apiPromise = null;
    },
  };
}

/** Kept for callers that want the same metadata source path as the lane's other modules. */
export const HTTP_SUBMIT_MODULE = resolve(
  import.meta.dirname ?? ".",
  "http-submit.mjs",
);
