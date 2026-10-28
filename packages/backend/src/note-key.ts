/**
 * The public half of a per-order operator secret.
 *
 * X25519's public key is `scalar-mult(secret, base point)`. WebCrypto exposes
 * that as `deriveBits({ public: basePoint }, secret)`, so no curve arithmetic is
 * hand-rolled here. Measured in Chromium, Firefox and WebKit (2026-10-28): all
 * three agree with `exportKey("raw", publicKey)`, which is why this route is used
 * instead of a JWK with an empty `x` (that fails with `DataError` in all three).
 *
 * Node's WebCrypto has X25519 too, so the server derives the same value the
 * browser would — one implementation, one answer.
 */
const BASE_POINT = (() => {
  const point = new Uint8Array(32);
  point[0] = 9;
  return point;
})();

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const jwkOf = (secret: Uint8Array) => ({
  kty: "OKP",
  crv: "X25519",
  d: b64u(secret),
  x: b64u(new Uint8Array(32)),
  ext: true,
  key_ops: ["deriveBits"],
});

/** The 32-byte public key for a 32-byte secret, or null if the input is not one. */
export async function operatorPublicKey(
  secret: Uint8Array,
): Promise<Uint8Array | null> {
  if (secret.length !== 32) return null;
  try {
    const base = await crypto.subtle.importKey(
      "raw",
      BASE_POINT as BufferSource,
      { name: "X25519" },
      false,
      [],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "X25519", public: base } as never,
      await crypto.subtle.importKey(
        "jwk",
        jwkOf(secret) as never,
        { name: "X25519" },
        false,
        ["deriveBits"],
      ),
      256,
    );
    return new Uint8Array(bits);
  } catch {
    // An environment without X25519 (an old Node) must not break quote creation;
    // the field stays absent and the operator simply cannot read a sealed note.
    return null;
  }
}
