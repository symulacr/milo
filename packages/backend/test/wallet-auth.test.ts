import { describe, expect, test } from "bun:test";
import * as runtime from "@midnight-ntwrk/onchain-runtime-v3";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "../src/encoding";
import {
  addressFromVerifyingKey,
  buildWalletSignInMessage,
  consumeWalletNonce,
  createWalletNonce,
  decodeBech32m,
  isNonceUsable,
  isPreprodUnshieldedAddress,
  issueWalletNonce,
  memoryWalletNonceStore,
  parseWalletSignInMessage,
  unshieldedAddressHex,
  verifySchnorrDigest,
  verifyWalletSignature,
  WALLET_MESSAGE_DOMAIN,
  WALLET_NETWORK,
  WALLET_NONCE_TTL_MS,
  walletBoundToAddress,
  walletMessageDomain,
  walletNonceIdentifier,
} from "../src/wallet-auth";

const NOW = 1_800_000_000_000;

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) {
      if ((top >> index) & 1) checksum ^= GENERATOR[index] ?? 0;
    }
  }
  return checksum;
}

function encodeBech32m(prefix: string, bytes: Uint8Array): string {
  const high: number[] = [];
  const low: number[] = [];
  for (const character of prefix) {
    const code = character.charCodeAt(0);
    high.push(code >> 5);
    low.push(code & 31);
  }
  const words: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((accumulator >> bits) & 31);
    }
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31);
  const values = [...high, 0, ...low, ...words, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(values) ^ 0x2bc830a3;
  const checksumWords: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    checksumWords.push((checksum >> (5 * (5 - index))) & 31);
  }
  return `${prefix}1${[...words, ...checksumWords]
    .map((word) => CHARSET[word])
    .join("")}`;
}

const encoder = new TextEncoder();

function signWithRuntime(
  signingKey: string,
  message: string,
): { verifyingKey: string; signature: string } {
  // The connector signs the domain-separated form (midnight_signed_message:<size>:),
  // which is the only form verifyWalletSignature accepts.
  const prefixed = `midnight_signed_message:${encoder.encode(message).length}:${message}`;
  return {
    verifyingKey: runtime.signatureVerifyingKey(signingKey),
    signature: runtime.signData(signingKey, encoder.encode(prefixed)),
  };
}

function preprodAddress(verifyingKey: string): string {
  const hex = addressFromVerifyingKey(verifyingKey);
  if (!hex) throw new Error("verifying key is not 32 bytes");
  return encodeBech32m("mn_addr_preprod", hexToBytes(hex));
}

function deterministicRandom(seed: number) {
  let value = seed;
  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      value = (value * 1103515245 + 12345) & 0x7fffffff;
      bytes[index] = value & 0xff;
    }
    return bytes;
  };
}

describe("Schnorr BIP-340 verification", () => {
  test("accepts a signature produced by the Midnight runtime over its SHA-256 digest", () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const message = encoder.encode("milo wallet sign-in");
    const signature = runtime.signData(signingKey, message);
    expect(
      verifySchnorrDigest(
        hexToBytes(verifyingKey),
        sha256(message),
        hexToBytes(signature),
      ),
    ).toBe(true);
  });

  test("rejects a digest signed for a different message", () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const signature = runtime.signData(signingKey, encoder.encode("first"));
    expect(
      verifySchnorrDigest(
        hexToBytes(verifyingKey),
        sha256(encoder.encode("second")),
        hexToBytes(signature),
      ),
    ).toBe(false);
  });

  test("rejects a tampered signature, a wrong-length key, and a wrong-length digest", () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const message = encoder.encode("tamper");
    const signature = runtime.signData(signingKey, message);
    const tampered = `${signature.slice(0, -2)}00`;
    expect(
      verifySchnorrDigest(
        hexToBytes(verifyingKey),
        sha256(message),
        hexToBytes(tampered),
      ),
    ).toBe(false);
    expect(
      verifySchnorrDigest(
        hexToBytes(verifyingKey).subarray(0, 31),
        sha256(message),
        hexToBytes(signature),
      ),
    ).toBe(false);
    expect(
      verifySchnorrDigest(
        hexToBytes(verifyingKey),
        sha256(message).subarray(0, 31),
        hexToBytes(signature),
      ),
    ).toBe(false);
  });

  test("rejects a signature whose r scalar is not the commitment x coordinate", () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const message = encoder.encode("scalar");
    const signature = runtime.signData(signingKey, message);
    const flipped = `${signature.slice(0, 32)}${signature.slice(32, 62)}00`;
    expect(
      verifySchnorrDigest(
        hexToBytes(verifyingKey),
        sha256(message),
        hexToBytes(flipped),
      ),
    ).toBe(false);
  });
});

describe("preprod unshielded address decoding", () => {
  const address =
    "mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7";

  test("accepts a real PREPROD address and exposes 32 bytes", () => {
    expect(isPreprodUnshieldedAddress(address)).toBe(true);
    expect(unshieldedAddressHex(address)).toBe(
      "27ac0e45e3c45a0d57cc8f87ef672ef653bfd022661019ac2a38d87a244217b9",
    );
    expect(decodeBech32m(address)?.prefix).toBe("mn_addr_preprod");
  });

  test("rejects other networks, bad checksums, and malformed input", () => {
    const mainnet = encodeBech32m("mn_addr", new Uint8Array(32).fill(1));
    expect(isPreprodUnshieldedAddress(mainnet)).toBe(false);
    const corrupted = `${address.slice(0, -1)}q`;
    expect(isPreprodUnshieldedAddress(corrupted)).toBe(false);
    expect(isPreprodUnshieldedAddress("")).toBe(false);
    expect(isPreprodUnshieldedAddress("mn_addr_preprod1")).toBe(false);
    const wrongLength = encodeBech32m(
      "mn_addr_preprod",
      new Uint8Array(31).fill(2),
    );
    expect(isPreprodUnshieldedAddress(wrongLength)).toBe(false);
  });

  test("rejects uppercase input so one address cannot have two spellings", () => {
    expect(isPreprodUnshieldedAddress(address.toUpperCase())).toBe(false);
  });
});

describe("verifying key to address binding", () => {
  test("derives the address as SHA-256 of the 32-byte verifying key", () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    expect(addressFromVerifyingKey(verifyingKey)).toBe(
      bytesToHex(sha256(hexToBytes(verifyingKey))),
    );
    expect(addressFromVerifyingKey("not-hex")).toBeNull();
    expect(addressFromVerifyingKey("00".repeat(31))).toBeNull();
  });

  test("binds the signature key to the claimed address", () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const own = preprodAddress(verifyingKey);
    const other = preprodAddress(
      runtime.signatureVerifyingKey(runtime.sampleSigningKey()),
    );
    expect(walletBoundToAddress(verifyingKey, own)).toBe(true);
    expect(walletBoundToAddress(verifyingKey, other)).toBe(false);
    expect(walletBoundToAddress("nope", own)).toBe(false);
  });
});

describe("wallet sign-in message", () => {
  const request = {
    address:
      "mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7",
    nonce: "ab".repeat(32),
    issuedAt: NOW,
    expiresAt: NOW + WALLET_NONCE_TTL_MS,
  };

  test("round-trips through build and parse", () => {
    const parsed = parseWalletSignInMessage(buildWalletSignInMessage(request));
    expect(parsed).toEqual(request);
  });

  test("carries the domain, network, and expiry the server checks", () => {
    const message = buildWalletSignInMessage(request);
    expect(message).toContain(`domain: ${walletMessageDomain()}`);
    expect(message).toContain(`network: ${WALLET_NETWORK}`);
    expect(message).toContain(
      `expires-at: ${new Date(request.expiresAt).toISOString()}`,
    );
  });

  // R23 J-02: the `domain:` line used to be the literal "milo", so the signed
  // text carried no deployment and a signature made for one Milo deployment was
  // textually valid at any other. The client signs whatever the server returns
  // (`auth-client.ts:115-130`), so this is fixed server-side with no release.
  describe("the signed domain binds the deployment (R23 J-02)", () => {
    const withSite = async (
      value: string | undefined,
      run: () => Promise<void>,
    ) => {
      const previous = process.env.SITE_URL;
      if (value === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = value;
      try {
        await run();
      } finally {
        if (previous === undefined) delete process.env.SITE_URL;
        else process.env.SITE_URL = previous;
      }
    };

    test("the signed domain is the deployment host, not a constant", async () => {
      await withSite("https://milo-nine-delta.vercel.app", async () => {
        expect(walletMessageDomain()).toBe("milo-nine-delta.vercel.app");
        const message = buildWalletSignInMessage(request);
        expect(message).toContain("domain: milo-nine-delta.vercel.app");
        // And it round-trips against the same value it was built with.
        expect(parseWalletSignInMessage(message)).toEqual(request);
      });
    });

    test("a message built for another deployment no longer parses", async () => {
      // Deployment A builds a message; deployment B must reject it. The build
      // and the parse happen under different SITE_URL values, so the two must
      // not be nested.
      const previous = process.env.SITE_URL;
      let forA = "";
      try {
        process.env.SITE_URL = "https://a.example";
        forA = buildWalletSignInMessage(request);
        process.env.SITE_URL = "https://b.example";
        expect(parseWalletSignInMessage(forA)).toBeNull();
        // Control: under A it parses, so the rejection above is the domain.
        process.env.SITE_URL = "https://a.example";
        expect(parseWalletSignInMessage(forA)).toEqual(request);
      } finally {
        if (previous === undefined) delete process.env.SITE_URL;
        else process.env.SITE_URL = previous;
      }
    });

    test("an unset origin falls back to the old literal, not to a crash", async () => {
      await withSite(undefined, async () => {
        expect(walletMessageDomain()).toBe(WALLET_MESSAGE_DOMAIN);
        expect(
          parseWalletSignInMessage(buildWalletSignInMessage(request)),
        ).toEqual(request);
      });
    });

    test("a malformed origin falls back rather than throwing", async () => {
      await withSite("not a url", async () => {
        expect(walletMessageDomain()).toBe(WALLET_MESSAGE_DOMAIN);
      });
    });
  });

  test("rejects a wrong header, wrong domain, wrong network, and unknown fields", () => {
    const good = buildWalletSignInMessage(request);
    expect(
      parseWalletSignInMessage(good.replace("milo.wallet.sign-in", "other")),
    ).toBeNull();
    expect(
      parseWalletSignInMessage(good.replace("domain: milo", "domain: evil")),
    ).toBeNull();
    expect(
      parseWalletSignInMessage(
        good.replace("network: preprod", "network: mainnet"),
      ),
    ).toBeNull();
    expect(parseWalletSignInMessage(`${good}\nextra: value`)).toBeNull();
    expect(
      parseWalletSignInMessage(good.replace("nonce: ", "nonce:  ")),
    ).toBeNull();
  });

  test("rejects a non-PREPROD address, a short nonce, and an inverted window", () => {
    const good = buildWalletSignInMessage(request);
    expect(
      parseWalletSignInMessage(
        good.replace(
          request.address,
          "mn_addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
        ),
      ),
    ).toBeNull();
    expect(
      parseWalletSignInMessage(good.replace(request.nonce, "ab")),
    ).toBeNull();
    expect(
      parseWalletSignInMessage(
        good.replace(
          `expires-at: ${new Date(request.expiresAt).toISOString()}`,
          `expires-at: ${new Date(request.issuedAt).toISOString()}`,
        ),
      ),
    ).toBeNull();
  });

  test("rejects duplicate fields so a later line cannot override an earlier one", () => {
    const good = buildWalletSignInMessage(request);
    const duplicated = good.replace(
      `nonce: ${request.nonce}`,
      `nonce: ${request.nonce}\nnonce: ${"cd".repeat(32)}`,
    );
    expect(parseWalletSignInMessage(duplicated)).toBeNull();
  });
});

describe("wallet signature verification", () => {
  const signingKey = runtime.sampleSigningKey();
  const verifyingKey = runtime.signatureVerifyingKey(signingKey);
  const message = buildWalletSignInMessage({
    address: preprodAddress(verifyingKey),
    nonce: "ef".repeat(32),
    issuedAt: NOW,
    expiresAt: NOW + WALLET_NONCE_TTL_MS,
  });

  // C-06: only the domain-separated form is accepted. A signature over the bare
  // text is what another protocol would produce for the same message, so accepting
  // it would let that signature sign in here.
  test("rejects a signature over the bare text, accepting only the prefixed form", () => {
    const raw = runtime.signData(signingKey, encoder.encode(message));
    expect(
      verifyWalletSignature({ message, verifyingKey, signature: raw }),
    ).toBe(false);
  });

  test("accepts a signature over the wallet's prefixed payload", () => {
    const prefixed = `midnight_signed_message:${encoder.encode(message).length}:${message}`;
    const signature = runtime.signData(signingKey, encoder.encode(prefixed));
    expect(verifyWalletSignature({ message, verifyingKey, signature })).toBe(
      true,
    );
  });

  test("rejects an unknown scheme, a bad key, and a bad signature length", () => {
    const prefixed = `midnight_signed_message:${encoder.encode(message).length}:${message}`;
    const signature = runtime.signData(signingKey, encoder.encode(prefixed));
    expect(
      verifyWalletSignature({
        message,
        verifyingKey,
        signature,
        scheme: "ecdsa_secp256k1_sha256",
      }),
    ).toBe(false);
    expect(
      verifyWalletSignature({
        message,
        verifyingKey,
        signature,
        scheme: "schnorr_bip340",
      }),
    ).toBe(true);
    expect(
      verifyWalletSignature({ message, verifyingKey: "zz", signature }),
    ).toBe(false);
    expect(
      verifyWalletSignature({ message, verifyingKey, signature: "00" }),
    ).toBe(false);
  });

  test("rejects a signature over a different message", () => {
    const signature = runtime.signData(signingKey, encoder.encode("other"));
    expect(verifyWalletSignature({ message, verifyingKey, signature })).toBe(
      false,
    );
  });

  test("rejects a signature from a different key", () => {
    const otherKey = runtime.sampleSigningKey();
    const signature = runtime.signData(otherKey, encoder.encode(message));
    expect(verifyWalletSignature({ message, verifyingKey, signature })).toBe(
      false,
    );
  });
});

describe("wallet nonces", () => {
  test("issues a 32-byte nonce with a five minute expiry", async () => {
    const store = memoryWalletNonceStore();
    const issued = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(7),
    );
    expect(issued.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.expiresAt).toBe(NOW + WALLET_NONCE_TTL_MS);
    expect(issued.message).toContain(`nonce: ${issued.nonce}`);
  });

  test("each issue replaces the previous nonce for the same address", async () => {
    const store = memoryWalletNonceStore();
    const first = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(1),
    );
    const second = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(2),
    );
    expect(first.nonce).not.toBe(second.nonce);
    expect(await consumeWalletNonce(store, "addr", second.nonce, NOW)).toBe(
      true,
    );
    expect(await consumeWalletNonce(store, "addr", first.nonce, NOW)).toBe(
      false,
    );
  });

  test("a nonce is single use", async () => {
    const store = memoryWalletNonceStore();
    const issued = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(3),
    );
    expect(await consumeWalletNonce(store, "addr", issued.nonce, NOW)).toBe(
      true,
    );
    expect(await consumeWalletNonce(store, "addr", issued.nonce, NOW)).toBe(
      false,
    );
  });

  // AUDIT15 A-05: the compare now happens before the destructive `take`, so an
  // expired record is refused without being consumed. It is still unusable at
  // any clock past its own `expiresAt`, which is the property that matters; the
  // old test also pinned the side effect, and that side effect was the bug.
  test("an expired nonce is refused and stays refused", async () => {
    const store = memoryWalletNonceStore();
    const issued = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(4),
    );
    const later = NOW + WALLET_NONCE_TTL_MS + 1;
    expect(await consumeWalletNonce(store, "addr", issued.nonce, later)).toBe(
      false,
    );
    // Still refused on a retry at the same late clock: the record was not
    // consumed, but its own expiry keeps it dead.
    expect(await consumeWalletNonce(store, "addr", issued.nonce, later)).toBe(
      false,
    );
  });

  test("a nonce issued for one address cannot be spent by another", async () => {
    const store = memoryWalletNonceStore();
    const issued = await issueWalletNonce(
      store,
      "addr-a",
      NOW,
      deterministicRandom(5),
    );
    expect(await consumeWalletNonce(store, "addr-b", issued.nonce, NOW)).toBe(
      false,
    );
    expect(await consumeWalletNonce(store, "addr-a", issued.nonce, NOW)).toBe(
      true,
    );
  });

  // AUDIT15 A-05: a wrong guess used to delete the real nonce (`take` ran
  // before the compare), so anyone could lock a known address out of its own
  // sign-in. The assertion is inverted: the wrong guess is still refused, and
  // the legitimate nonce must now SURVIVE it.
  test("a missing nonce and a wrong nonce are both refused, and a wrong guess no longer burns the nonce", async () => {
    const store = memoryWalletNonceStore();
    expect(await consumeWalletNonce(store, "addr", "00".repeat(32), NOW)).toBe(
      false,
    );
    const issued = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(6),
    );
    expect(await consumeWalletNonce(store, "addr", "11".repeat(32), NOW)).toBe(
      false,
    );
    // The real nonce still works after the wrong guess.
    expect(await consumeWalletNonce(store, "addr", issued.nonce, NOW)).toBe(
      true,
    );
    // And it is single-use: the same value cannot be replayed.
    expect(await consumeWalletNonce(store, "addr", issued.nonce, NOW)).toBe(
      false,
    );
    const fresh = await issueWalletNonce(
      store,
      "addr",
      NOW,
      deterministicRandom(8),
    );
    expect(await consumeWalletNonce(store, "addr", fresh.nonce, NOW)).toBe(
      true,
    );
  });

  test("expiry comparison is strict and rejects non-finite values", () => {
    expect(isNonceUsable(NOW + 1, NOW)).toBe(true);
    expect(isNonceUsable(NOW, NOW)).toBe(false);
    expect(isNonceUsable(NOW - 1, NOW)).toBe(false);
    expect(isNonceUsable(Number.POSITIVE_INFINITY, NOW)).toBe(false);
    expect(isNonceUsable(Number.NaN, NOW)).toBe(false);
  });

  test("nonce identifiers are namespaced per address", () => {
    expect(walletNonceIdentifier("addr")).toBe("milo-wallet-nonce:addr");
    expect(walletNonceIdentifier("addr")).not.toBe(
      walletNonceIdentifier("other"),
    );
  });

  test("createWalletNonce uses the whole requested byte length", () => {
    const nonce = createWalletNonce((length) =>
      new Uint8Array(length).fill(0xab),
    );
    expect(nonce).toBe("ab".repeat(32));
  });
});

describe("end-to-end wallet sign-in check", () => {
  test("a correctly signed message for the bound address passes every gate", async () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const address = preprodAddress(verifyingKey);
    const store = memoryWalletNonceStore();
    const issued = await issueWalletNonce(
      store,
      address,
      NOW,
      deterministicRandom(9),
    );
    const { signature } = signWithRuntime(signingKey, issued.message);
    const parsed = parseWalletSignInMessage(issued.message);
    expect(parsed).not.toBeNull();
    expect(walletBoundToAddress(verifyingKey, parsed?.address ?? "")).toBe(
      true,
    );
    expect(
      verifyWalletSignature({
        message: issued.message,
        verifyingKey,
        signature,
      }),
    ).toBe(true);
    expect(
      await consumeWalletNonce(
        store,
        parsed?.address ?? "",
        parsed?.nonce ?? "",
        NOW,
      ),
    ).toBe(true);
  });

  test("a signature replayed after a fresh nonce is issued fails the nonce gate", async () => {
    const signingKey = runtime.sampleSigningKey();
    const verifyingKey = runtime.signatureVerifyingKey(signingKey);
    const address = preprodAddress(verifyingKey);
    const store = memoryWalletNonceStore();
    const first = await issueWalletNonce(
      store,
      address,
      NOW,
      deterministicRandom(10),
    );
    const { signature } = signWithRuntime(signingKey, first.message);
    await issueWalletNonce(store, address, NOW, deterministicRandom(11));
    const parsed = parseWalletSignInMessage(first.message);
    expect(
      verifyWalletSignature({
        message: first.message,
        verifyingKey,
        signature,
      }),
    ).toBe(true);
    expect(
      await consumeWalletNonce(
        store,
        parsed?.address ?? "",
        parsed?.nonce ?? "",
        NOW,
      ),
    ).toBe(false);
  });
});

describe("sign-in message sign helper", () => {
  test("signWithRuntime produces a verifiable pair for the built message", () => {
    const signingKey = runtime.sampleSigningKey();
    const message = buildWalletSignInMessage({
      address: preprodAddress(runtime.signatureVerifyingKey(signingKey)),
      nonce: "12".repeat(32),
      issuedAt: NOW,
      expiresAt: NOW + WALLET_NONCE_TTL_MS,
    });
    const signed = signWithRuntime(signingKey, message);
    expect(
      verifyWalletSignature({
        message,
        verifyingKey: signed.verifyingKey,
        signature: signed.signature,
      }),
    ).toBe(true);
  });
});
