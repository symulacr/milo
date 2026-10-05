import { describe, expect, test } from "bun:test";
import {
  classifyMidnightClientError,
  InsufficientDustError,
  isInsufficientDustError,
  isLockedWalletError,
  isMidnightClientError,
  isRejectedSignatureError,
  isWrongNetworkError,
  LockedWalletError,
  MIDNIGHT_CLIENT_ERROR_CODES,
  MidnightClientError,
  RejectedSignatureError,
  rethrowAsMidnightClientError,
  WrongNetworkError,
} from "../src/errors.ts";

const HASH = "a".repeat(64);

describe("error taxonomy", () => {
  test("the code list is exactly the four the boundary must distinguish", () => {
    expect([...MIDNIGHT_CLIENT_ERROR_CODES]).toEqual([
      "REJECTED_SIGNATURE",
      "LOCKED_WALLET",
      "WRONG_NETWORK",
      "INSUFFICIENT_DUST",
    ]);
  });

  test("each subclass carries its own code, name, and default message", () => {
    const cases = [
      [
        new RejectedSignatureError(),
        "REJECTED_SIGNATURE",
        "RejectedSignatureError",
      ],
      [new LockedWalletError(), "LOCKED_WALLET", "LockedWalletError"],
      [new WrongNetworkError(), "WRONG_NETWORK", "WrongNetworkError"],
      [
        new InsufficientDustError(),
        "INSUFFICIENT_DUST",
        "InsufficientDustError",
      ],
    ] as const;
    for (const [error, code, name] of cases) {
      expect(error.code).toBe(code);
      expect(error.name).toBe(name);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error).toBeInstanceOf(MidnightClientError);
      expect(error).toBeInstanceOf(Error);
      expect(isMidnightClientError(error)).toBe(true);
    }
  });

  test("detail and message are caller-supplied and preserved", () => {
    const error = new WrongNetworkError("mainnet is blocked", {
      network: "mainnet",
      mode: "preprod-only",
      allowed: "preprod",
      retryable: false,
      note: undefined,
    });
    expect(error.message).toBe("mainnet is blocked");
    expect(error.detail).toEqual({
      network: "mainnet",
      mode: "preprod-only",
      allowed: "preprod",
      retryable: false,
      note: undefined,
    });
  });

  test("the base class carries an arbitrary code from the taxonomy", () => {
    const error = new MidnightClientError("LOCKED_WALLET", "base", { a: 1 });
    expect(error.name).toBe("MidnightClientError");
    expect(error.code).toBe("LOCKED_WALLET");
    expect(error.detail).toEqual({ a: 1 });
    // The code survives; the per-code classifier does not match the base
    // class, because it keys off the subclass or its error name. Only
    // classifyMidnightClientError reads `code` directly.
    expect(isLockedWalletError(error)).toBe(false);
    expect(classifyMidnightClientError(error)).toBe("LOCKED_WALLET");
  });

  test("isMidnightClientError refuses foreign objects that merely look alike", () => {
    for (const value of [
      null,
      undefined,
      "LockedWalletError",
      { code: "LOCKED_WALLET", name: "LockedWalletError" },
      new Error("plain"),
      new TypeError("plain"),
    ]) {
      expect(isMidnightClientError(value)).toBe(false);
    }
  });

  test("a subclass survives the prototype chain and instanceof round trip", () => {
    // setPrototypeOf in the constructor is what keeps this true after transpile.
    const error = new RejectedSignatureError("nope");
    expect(Object.getPrototypeOf(error)).toBe(RejectedSignatureError.prototype);
    expect(error instanceof RejectedSignatureError).toBe(true);
    expect(error instanceof MidnightClientError).toBe(true);
  });
});

function fiberFailure(cause: unknown): object {
  return { [Symbol.for("effect/Runtime/FiberFailure/Cause")]: cause };
}

describe("isInsufficientDustError", () => {
  test("matches the typed error directly", () => {
    expect(isInsufficientDustError(new InsufficientDustError())).toBe(true);
  });

  test("matches Wallet.InsufficientFunds only for the dust token", () => {
    expect(
      isInsufficientDustError({
        _tag: "Wallet.InsufficientFunds",
        tokenType: "dust",
      }),
    ).toBe(true);
    for (const tokenType of ["nights", "NIGHT", undefined, null, 1]) {
      expect(
        isInsufficientDustError({
          _tag: "Wallet.InsufficientFunds",
          tokenType,
        }),
      ).toBe(false);
    }
    expect(isInsufficientDustError({ _tag: "Wallet.InsufficientFunds" })).toBe(
      false,
    );
  });

  test("walks an Effect Fail, Die, Transacting cause, and parallel pair", () => {
    const dust = { _tag: "Wallet.InsufficientFunds", tokenType: "dust" };
    expect(isInsufficientDustError({ _tag: "Fail", error: dust })).toBe(true);
    expect(isInsufficientDustError({ _tag: "Die", defect: dust })).toBe(true);
    expect(
      isInsufficientDustError({ _tag: "Wallet.Transacting", cause: dust }),
    ).toBe(true);
    expect(
      isInsufficientDustError({ _tag: "Sequential", left: dust, right: {} }),
    ).toBe(true);
    expect(
      isInsufficientDustError({ _tag: "Parallel", left: {}, right: dust }),
    ).toBe(true);
    expect(isInsufficientDustError(fiberFailure(dust))).toBe(true);
    expect(isInsufficientDustError({ cause: dust })).toBe(true);
  });

  test("a hostile getter does not crash the walk", () => {
    const hostile = {
      _tag: "Wallet.InsufficientFunds",
      get tokenType(): string {
        throw new Error("hostile getter");
      },
    };
    expect(isInsufficientDustError(hostile)).toBe(false);
    expect(isInsufficientDustError(fiberFailure(hostile))).toBe(false);
  });

  test("a self-referencing cause terminates", () => {
    const loop: Record<string, unknown> = { _tag: "Fail" };
    loop.error = loop;
    expect(isInsufficientDustError(loop)).toBe(false);
  });

  test("non-objects and unrelated errors do not match", () => {
    for (const value of [
      null,
      undefined,
      "dust",
      0,
      { _tag: "Something.Else" },
      new Error("insufficient funds"),
    ]) {
      expect(isInsufficientDustError(value)).toBe(false);
    }
  });

  test("the walk is bounded and gives up rather than hanging on a deep chain", () => {
    let node: Record<string, unknown> = { _tag: "Fail" };
    const head = node;
    for (let i = 0; i < 200; i++) {
      const next: Record<string, unknown> = { _tag: "Fail" };
      node.error = next;
      node = next;
    }
    node.error = { _tag: "Wallet.InsufficientFunds", tokenType: "dust" };
    expect(isInsufficientDustError(head)).toBe(false);
  });
});

describe("isRejectedSignatureError", () => {
  test("matches the typed error and the Wallet.Sign tag", () => {
    expect(isRejectedSignatureError(new RejectedSignatureError())).toBe(true);
    expect(isRejectedSignatureError({ _tag: "Wallet.Sign" })).toBe(true);
    expect(
      isRejectedSignatureError(fiberFailure({ _tag: "Wallet.Sign" })),
    ).toBe(true);
  });

  test("matches a serialized shape that only carries the error name", () => {
    expect(
      isRejectedSignatureError({
        name: "RejectedSignatureError",
        message: "x",
      }),
    ).toBe(true);
    expect(
      isRejectedSignatureError({
        _tag: "Fail",
        error: { name: "RejectedSignatureError" },
      }),
    ).toBe(true);
  });

  test("a same-named sibling from another library is not silently trusted by name alone", () => {
    expect(
      isRejectedSignatureError({
        name: "LockedWalletError",
        message: "Wallet.Sign declined",
      }),
    ).toBe(false);
  });

  test("unrelated values do not match", () => {
    for (const value of [
      null,
      "Wallet.Sign",
      1,
      { name: "TypeError" },
      new Error("x"),
    ]) {
      expect(isRejectedSignatureError(value)).toBe(false);
    }
  });
});

describe("isLockedWalletError", () => {
  test("matches the typed error, the connection error name, and the message text", () => {
    expect(isLockedWalletError(new LockedWalletError())).toBe(true);
    expect(isLockedWalletError({ name: "LockedWalletError" })).toBe(true);
    expect(isLockedWalletError({ name: "ConnectionError" })).toBe(true);
    for (const message of [
      "Wallet is not connected",
      "wallet is not connected",
      "The WALLET IS NOT CONNECTED right now",
      "Wallet is locked or not connected.",
      "network guard rejected it while wallet is not connected",
    ]) {
      expect(isLockedWalletError({ message })).toBe(true);
    }
  });

  test("a locked-wallet shape nested in a cause still matches", () => {
    expect(
      isLockedWalletError({ _tag: "Fail", error: { name: "ConnectionError" } }),
    ).toBe(true);
    expect(
      isLockedWalletError(fiberFailure({ message: "wallet is not connected" })),
    ).toBe(true);
  });

  test("the message match is the two documented phrasings only", () => {
    for (const value of [
      null,
      "locked",
      { message: "the vault is locked" },
      { message: "wallet is locked" },
      { message: 42 },
      new RejectedSignatureError("nope"),
    ]) {
      expect(isLockedWalletError(value)).toBe(false);
    }
  });
});

describe("isWrongNetworkError", () => {
  test("matches the typed error, the name, and the guard wording", () => {
    expect(isWrongNetworkError(new WrongNetworkError())).toBe(true);
    expect(isWrongNetworkError({ name: "WrongNetworkError" })).toBe(true);
    for (const message of [
      'Unsupported Midnight network "mainnet"',
      "unknown network guard mode",
      "Only PREPROD is allowed here",
      "only preprod",
    ]) {
      expect(isWrongNetworkError({ message })).toBe(true);
    }
    expect(
      isWrongNetworkError(fiberFailure({ name: "WrongNetworkError" })),
    ).toBe(true);
  });

  test("an unrelated message does not match", () => {
    for (const value of [
      null,
      "preprod",
      { message: "connected to the right network" },
      { message: null },
      new LockedWalletError(),
    ]) {
      expect(isWrongNetworkError(value)).toBe(false);
    }
  });
});

describe("classifyMidnightClientError", () => {
  test("an exact subclass keeps its own code", () => {
    expect(classifyMidnightClientError(new RejectedSignatureError())).toBe(
      "REJECTED_SIGNATURE",
    );
    expect(classifyMidnightClientError(new LockedWalletError())).toBe(
      "LOCKED_WALLET",
    );
    expect(classifyMidnightClientError(new WrongNetworkError())).toBe(
      "WRONG_NETWORK",
    );
    expect(classifyMidnightClientError(new InsufficientDustError())).toBe(
      "INSUFFICIENT_DUST",
    );
  });

  test("folds foreign shapes into the taxonomy", () => {
    expect(classifyMidnightClientError({ _tag: "Wallet.Sign" })).toBe(
      "REJECTED_SIGNATURE",
    );
    expect(
      classifyMidnightClientError({
        _tag: "Wallet.InsufficientFunds",
        tokenType: "dust",
      }),
    ).toBe("INSUFFICIENT_DUST");
    expect(
      classifyMidnightClientError({ message: "unsupported midnight network" }),
    ).toBe("WRONG_NETWORK");
    expect(classifyMidnightClientError({ name: "ConnectionError" })).toBe(
      "LOCKED_WALLET",
    );
  });

  test("an exact subclass wins over a foreign shape that would classify differently", () => {
    const error = new LockedWalletError(
      "unsupported midnight network for preprod",
    );
    expect(classifyMidnightClientError(error)).toBe("LOCKED_WALLET");
  });

  test("network outranks dust, and dust outranks signature, on one ambiguous value", () => {
    const both = {
      message: "unsupported midnight network",
      _tag: "Wallet.InsufficientFunds",
      tokenType: "dust",
    };
    expect(classifyMidnightClientError(both)).toBe("WRONG_NETWORK");
  });

  test("returns null for a failure that matches no code", () => {
    for (const value of [
      null,
      undefined,
      "boom",
      new Error("something else entirely"),
      { _tag: "Wallet.Other" },
      42,
    ]) {
      expect(classifyMidnightClientError(value)).toBeNull();
    }
  });
});

describe("rethrowAsMidnightClientError", () => {
  test("re-throws each classified code as its own subclass, keeping the message", () => {
    const cases = [
      [{ _tag: "Wallet.Sign" }, RejectedSignatureError, "REJECTED_SIGNATURE"],
      [{ name: "ConnectionError" }, LockedWalletError, "LOCKED_WALLET"],
      [
        { message: "unsupported midnight network" },
        WrongNetworkError,
        "WRONG_NETWORK",
      ],
      [
        { _tag: "Wallet.InsufficientFunds", tokenType: "dust" },
        InsufficientDustError,
        "INSUFFICIENT_DUST",
      ],
    ] as const;
    for (const [value, ctor, code] of cases) {
      let caught: unknown;
      try {
        rethrowAsMidnightClientError(value, "fallback");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ctor);
      expect((caught as MidnightClientError).code).toBe(code);
    }
  });

  test("an existing Error keeps its message; the fallback is only for non-Errors", () => {
    expect(() =>
      rethrowAsMidnightClientError(
        Object.assign(new Error("original message"), { _tag: "Wallet.Sign" }),
        "fallback message",
      ),
    ).toThrow("original message");
    expect(() =>
      rethrowAsMidnightClientError({ _tag: "Wallet.Sign" }, "fallback message"),
    ).toThrow("fallback message");
    expect(() =>
      rethrowAsMidnightClientError(
        { _tag: "Wallet.Sign", message: "" },
        "fallback message",
      ),
    ).toThrow("fallback message");
  });

  test("the detail records the cause name and the first tag in the graph", () => {
    let caught: MidnightClientError | undefined;
    try {
      rethrowAsMidnightClientError(
        { _tag: "Fail", error: { _tag: "Wallet.Sign" } },
        "fallback",
      );
    } catch (error) {
      caught = error as MidnightClientError;
    }
    expect(caught?.detail).toEqual({
      causeName: undefined,
      causeTag: "Fail",
    });
  });

  test("an unclassified Error is re-thrown unchanged, not wrapped", () => {
    const original = new Error("unknown provider failure");
    let caught: unknown;
    try {
      rethrowAsMidnightClientError(original, "fallback");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
  });

  test("an unclassified non-Error is re-thrown unchanged too", () => {
    for (const value of [null, undefined, "boom", 42, { random: true }]) {
      let caught: unknown;
      let threw = false;
      try {
        rethrowAsMidnightClientError(value, "fallback");
      } catch (error) {
        threw = true;
        caught = error;
      }
      expect(threw).toBe(true);
      expect(caught).toBe(value);
    }
  });

  test("a hostile getter in the graph does not crash the re-throw", () => {
    const hostile = {
      _tag: "Fail",
      get error(): unknown {
        throw new Error("hostile");
      },
    };
    expect(() => rethrowAsMidnightClientError(hostile, "fallback")).toThrow();
  });
});

describe("boundary round trip", () => {
  test("classify then re-throw preserves the code for every taxonomy entry", () => {
    for (const code of MIDNIGHT_CLIENT_ERROR_CODES) {
      const original = new MidnightClientError(code, `message for ${code}`, {
        fingerprint: HASH,
      });
      let caught: MidnightClientError | undefined;
      try {
        rethrowAsMidnightClientError(original, "fallback");
      } catch (error) {
        caught = error as MidnightClientError;
      }
      expect(caught?.code).toBe(code);
      expect(caught?.message).toBe(`message for ${code}`);
      expect(classifyMidnightClientError(caught)).toBe(code);
    }
  });

  test("re-throwing replaces the detail with the cause name and first tag", () => {
    const original = new MidnightClientError("LOCKED_WALLET", "m", {
      fingerprint: HASH,
    });
    let caught: MidnightClientError | undefined;
    try {
      rethrowAsMidnightClientError(original, "fallback");
    } catch (error) {
      caught = error as MidnightClientError;
    }
    expect(caught?.detail).toEqual({
      causeName: "MidnightClientError",
      causeTag: undefined,
    });
  });
});
