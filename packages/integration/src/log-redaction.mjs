// The Blockfrost project token must travel inside the endpoint URL: the wallet SDK's indexer
// client takes a plain `{ url }` with no header hook, and browser WebSockets cannot set
// headers (see blockfrost.mjs). So any writer that prints a request URL prints the token with
// it, and the Midnight SDK does exactly that - on a WebSocket disconnect its RPC logger writes
// the full `wss://...?project_id=<token>` URL to stderr.
//
// Redacting at each call site cannot hold, because the leaking writer is not ours. This
// installs one redaction at the process boundary instead: every write to stdout and stderr
// has the token replaced. Diagnostics survive in full; only the secret is removed.

export const REDACTED = "<redacted>";

/** Replace every occurrence of `token` in `text` with `<redacted>`. */
export function redactText(text, token) {
  if (!token) return text;
  return text.includes(token) ? text.split(token).join(REDACTED) : text;
}

function redactChunk(chunk, token) {
  if (typeof chunk === "string") return redactText(chunk, token);
  if (Buffer.isBuffer(chunk)) {
    return chunk.includes(token)
      ? Buffer.from(redactText(chunk.toString("utf8"), token), "utf8")
      : chunk;
  }
  if (ArrayBuffer.isView(chunk)) {
    const text = Buffer.from(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    ).toString("utf8");
    return Buffer.from(redactText(text, token), "utf8");
  }
  return chunk;
}

/**
 * Patch each stream so no write can carry the token, and return how many were patched.
 * An absent token is a no-op (returns 0); an already-patched stream is skipped, so
 * repeated calls are safe.
 */
export function installLogRedaction(
  token,
  streams = [process.stdout, process.stderr],
) {
  if (!token) return 0;
  let patched = 0;
  for (const stream of streams) {
    const write = stream?.write;
    if (typeof write !== "function" || write.miloRedacted) continue;
    const patchedWrite = function (chunk, ...rest) {
      return write.call(this, redactChunk(chunk, token), ...rest);
    };
    // Marks the wrapper so a second install cannot wrap the wrapper.
    patchedWrite.miloRedacted = true;
    stream.write = patchedWrite;
    patched += 1;
  }
  return patched;
}
