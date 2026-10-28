import { beforeEach, describe, expect, test } from "bun:test";
import { installMemoryStorage } from "./test-storage";

// A backup file is user-supplied input. These tests drive the real
// restoreBackup with hostile files and assert nothing reaches the key ring.

installMemoryStorage();

const {
  backupBlob,
  keyFor,
  openNote,
  readKeys,
  restoreBackup,
  sealBackup,
  sealNote,
} = await import("./keys");

const PASSWORD = "correct horse battery";

const GOOD_KEY = {
  quoteId: "q1",
  actor: "buyer" as const,
  secret: "aa".repeat(32),
  nonce: "bb".repeat(32),
};

beforeEach(() => localStorage.clear());

describe("order key backup", () => {
  test("a real backup round-trips into the key ring", async () => {
    localStorage.setItem(
      "milo:order-keys:user-1",
      JSON.stringify({ q1: GOOD_KEY }),
    );
    const text = await (await backupBlob("user-1", PASSWORD)).text();
    localStorage.clear();
    expect(await restoreBackup("user-1", text, PASSWORD)).toEqual({
      restored: 1,
      kept: 0,
    });
    expect(readKeys("user-1").q1).toEqual(GOOD_KEY);
  });

  // G-08: a backup is a snapshot from an earlier moment. Restoring an old file
  // used to replace a newer key with the stale one, and the key is the only
  // thing that can sign for that order — so the order became unsignable while
  // the file looked fine. Filling gaps is the whole job.
  test("an older backup does not overwrite a newer key", async () => {
    const newer = { ...GOOD_KEY, secret: "cc".repeat(32) };
    localStorage.setItem("milo:order-keys:user-1:q1", JSON.stringify(newer));
    const text = await sealBackup({ q1: GOOD_KEY }, PASSWORD);
    expect(await restoreBackup("user-1", text, PASSWORD)).toEqual({
      restored: 0,
      kept: 1,
    });
    expect(readKeys("user-1").q1.secret).toBe("cc".repeat(32));
  });

  test("a backup fills the gaps it can and keeps what is newer", async () => {
    const newer = { ...GOOD_KEY, secret: "cc".repeat(32) };
    localStorage.setItem("milo:order-keys:user-1:q1", JSON.stringify(newer));
    const text = await sealBackup(
      { q1: GOOD_KEY, q2: { ...GOOD_KEY, quoteId: "q2" } },
      PASSWORD,
    );
    expect(await restoreBackup("user-1", text, PASSWORD)).toEqual({
      restored: 1,
      kept: 1,
    });
    expect(readKeys("user-1").q1.secret).toBe("cc".repeat(32));
    expect(readKeys("user-1").q2?.quoteId).toBe("q2");
  });

  test("the wrong password is reported, not swallowed", async () => {
    const text = await sealBackup({ q1: GOOD_KEY }, PASSWORD);
    await expect(
      restoreBackup("user-1", text, "wrong password"),
    ).rejects.toThrow("The password is not correct.");
    expect(readKeys("user-1")).toEqual({});
  });

  // Every refused file: a malformed envelope, or a correctly sealed payload
  // carrying something the app never issues.
  const REFUSED: readonly (readonly [string, unknown, boolean])[] = [
    ["not JSON", "not json", false],
    [
      "the wrong envelope",
      JSON.stringify({ format: "something-else", iv: "00", data: "00" }),
      false,
    ],
    [
      "an actor the app never issues",
      { evil: { ...GOOD_KEY, actor: "root" } },
      true,
    ],
    ["a non-hex secret", { evil: { ...GOOD_KEY, secret: "zz" } }, true],
    [
      "a missing nonce",
      { evil: { quoteId: "evil", actor: "buyer", secret: "aa" } },
      true,
    ],
    ["a non-object entry", { evil: "just a string" }, true],
  ];

  for (const [label, payload, sealed] of REFUSED)
    test(`a file with ${label} is refused`, async () => {
      const text = sealed
        ? await sealBackup(payload, PASSWORD)
        : (payload as string);
      await expect(restoreBackup("user-1", text, PASSWORD)).rejects.toThrow(
        "This file is not a Milo key backup.",
      );
      expect(readKeys("user-1")).toEqual({});
    });

  test("a tampered key ring is ignored rather than trusted", () => {
    localStorage.setItem(
      "milo:order-keys:user-1",
      JSON.stringify({ q1: { ...GOOD_KEY, actor: "root" } }),
    );
    expect(readKeys("user-1")).toEqual({});
    expect(keyFor("user-1", "q1")).toBeNull();
  });
});

describe("U-03 a store that refuses the key is reported, not thrown", () => {
  // A full quota or Safari private mode makes `setItem` throw. `saveKey` used to
  // let that escape, which turned a successful server claim into an exception in
  // the middle of the claim flow: the order was claimed and the key that signs
  // for it was never written.
  const withThrowingStore = (run: () => void) => {
    const real = localStorage.setItem.bind(localStorage);
    (localStorage as unknown as Record<string, unknown>).setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    try {
      run();
    } finally {
      (localStorage as unknown as Record<string, unknown>).setItem = real;
    }
  };

  test("saveKey reports false instead of throwing", async () => {
    const { saveKey } = await import("./keys");
    let result: boolean | undefined;
    withThrowingStore(() => {
      result = saveKey("subject-u03", GOOD_KEY);
    });
    expect(result).toBe(false);
  });

  test("a successful write still reports true", async () => {
    const { saveKey } = await import("./keys");
    expect(saveKey("subject-u03b", GOOD_KEY)).toBe(true);
  });
});

describe("R40 a dispute note is sealed to the operator's per-order key", () => {
  // X25519 needs a real keypair: a private JWK requires BOTH `d` and a correct
  // `x`, and a zero `x` is a DataError in Chromium and WebKit. These tests
  // generate a pair and treat its raw private bytes as the "operator secret",
  // which is what the server does — it derives `x` and publishes it.
  const NOTE = "  The third file duplicates the first.  ";
  const QUOTE = "quote_r40";

  const sha256 = async (text: string) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    ]
      // hex bytes, not a zero-padded label
      .map((b) => b.toString(16).padStart(2, "0")) // taste-skill-ignore
      .join("");

  /** A real pair, plus the raw private bytes the server would store. */
  const pair = async () => {
    const keys = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", keys.privateKey)) as {
      d?: string;
    };
    const b64u = (s: string) =>
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
    return {
      secret: b64u(jwk.d ?? ""),
      publicKey: new Uint8Array(
        await crypto.subtle.exportKey("raw", keys.publicKey),
      ),
    };
  };

  test("the operator opens what the buyer sealed", async () => {
    const operator = await pair();
    const box = await sealNote(NOTE, operator.publicKey, QUOTE);
    expect(
      await openNote(box, operator.secret, operator.publicKey, QUOTE),
    ).toBe(NOTE);
  });

  test("a different key cannot open it", async () => {
    const operator = await pair();
    const stranger = await pair();
    const box = await sealNote(NOTE, operator.publicKey, QUOTE);
    await expect(
      openNote(box, stranger.secret, stranger.publicKey, QUOTE),
    ).rejects.toBeDefined();
  });

  test("the decrypted text hashes to the on-chain digest", async () => {
    const operator = await pair();
    const box = await sealNote(NOTE, operator.publicKey, QUOTE);
    // What the chain stores is sha256(note.trim()) — flows.ts evidenceOf.
    const onChain = await sha256(NOTE.trim());
    const opened = await openNote(
      box,
      operator.secret,
      operator.publicKey,
      QUOTE,
    );
    expect(await sha256(opened.trim())).toBe(onChain);
  });

  test("a tampered ciphertext is rejected", async () => {
    const operator = await pair();
    const box = await sealNote(NOTE, operator.publicKey, QUOTE);
    const raw = Uint8Array.from(atob(box.sealed), (c) => c.charCodeAt(0));
    raw[0] ^= 1;
    await expect(
      openNote(
        { ...box, sealed: btoa(String.fromCharCode(...raw)) },
        operator.secret,
        operator.publicKey,
        QUOTE,
      ),
    ).rejects.toBeDefined();
  });

  test("a note sealed for one order does not open for another", async () => {
    const operator = await pair();
    const box = await sealNote(NOTE, operator.publicKey, QUOTE);
    await expect(
      openNote(box, operator.secret, operator.publicKey, "quote_other"),
    ).rejects.toBeDefined();
  });

  test("the ciphertext does not contain the plaintext", async () => {
    const operator = await pair();
    const box = await sealNote(NOTE, operator.publicKey, QUOTE);
    expect(atob(box.sealed)).not.toContain("duplicates");
    expect(box.epk).not.toContain("duplicates");
  });
});
