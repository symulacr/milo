// Transaction submission over the node's HTTP JSON-RPC.
//
// The wallet SDK submits through polkadot-js `tx.send()` on the relay WebSocket. On Preprod
// that socket is closed with 1000 Normal Closure during submitAndWatchExtrinsic, so a
// registration is built, proven and then lost at the last step: two attempts produced
//   SubmissionError: Transaction submission failed
//     cause: disconnected from wss://rpc.preprod.midnight.network/: 1000:: Normal Closure
// and the chain confirmed nothing landed (the NIGHT UTXO stayed unspent).
//
// The node also exposes author_submitExtrinsic over plain HTTPS. Verified live: an
// extrinsic built as api.tx.midnight.sendMnTransaction(hex) is parsed and routed into the
// Midnight runtime there, answering a deliberately invalid payload with
// {"code":1010,"message":"Invalid Transaction"} rather than a method-not-found. So the relay
// is needed for metadata only, and submission itself goes over HTTPS.
//
// The call is unsigned by design: this matches what PolkadotNodeClient does
// (api.tx.midnight.sendMnTransaction(...).send(...) with no signer), because the Midnight
// transaction carries its own signatures and the pallet validates it.
import { resolve } from "node:path";

/** Build the hex extrinsic and POST it. Kept transport-only so it can be unit tested. */
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
 * runtime metadata needed to encode the extrinsic; every submission is an HTTPS POST.
 */
export function createHttpSubmitter(config, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
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
      return submitExtrinsicOverHttp(config, extrinsicHex, fetchImpl);
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
