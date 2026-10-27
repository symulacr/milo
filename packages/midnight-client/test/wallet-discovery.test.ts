import { describe, expect, test } from "bun:test";
import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import {
  classifyMidnightClientError,
  InsufficientDustError,
  isInsufficientDustError,
  isLockedWalletError,
  isRejectedSignatureError,
  isWrongNetworkError,
  LockedWalletError,
  MIDNIGHT_CLIENT_ERROR_CODES,
  MidnightClientError,
  RejectedSignatureError,
  rethrowAsMidnightClientError,
  WrongNetworkError,
} from "../src/errors";
import {
  assertLocalDisposableNetwork,
  assertNetworkGuard,
  assertSupportedNetwork,
  encodeNetworkLabel,
  LOCAL_DISPOSABLE_NETWORK,
  NETWORK_GUARD_ALLOWED,
  NETWORK_GUARD_MODES,
  SUPPORTED_MIDNIGHT_NETWORK,
} from "../src/network";
import {
  DappWalletConnector,
  REJECTED_CONNECTION,
  UNSUPPORTED_WALLET,
  WRONG_NETWORK_MESSAGE,
  walletChoices,
  watchWallets,
} from "../src/wallet";

/**
 * The round-20 helpers, looked up on the module namespace with fallbacks, so
 * this file loads on a tree that predates them and the assertions below fail on
 * the VALUE rather than on a missing export.
 */
const round20 = (await import("../src/wallet")) as {
  CONNECT_FAILED?: string;
  connectFailureMessage?: (error: unknown) => string;
  connectMessage?: (error: unknown) => string;
  DIFFERENT_ACCOUNT?: string;
  networkName?: (id: string) => string;
  networkOfAddress?: (address: string) => string | null;
  PERMISSION_BLOCKED?: string;
  verifyPreprodConnection?: (api: unknown) => Promise<unknown>;
  WALLET_BAD_REQUEST?: string;
  WALLET_DISCONNECTED?: string;
  WALLET_INTERNAL?: string;
  wrongNetworkMessage?: (id: string) => string;
};
const {
  CONNECT_FAILED = "",
  connectFailureMessage = () => "",
  connectMessage = () => "",
  DIFFERENT_ACCOUNT = "",
  networkName = () => "",
  networkOfAddress = () => null,
  PERMISSION_BLOCKED = "",
  verifyPreprodConnection = async () => {
    throw new Error("not implemented on this tree");
  },
  WALLET_BAD_REQUEST = "",
  WALLET_DISCONNECTED = "",
  WALLET_INTERNAL = "",
  wrongNetworkMessage = () => "",
} = round20;

const wallet = (
  rdns: string,
  apiVersion = "4.0.1",
  connect: () => Promise<ConnectedAPI> = async () => ({}) as ConnectedAPI,
): InitialAPI =>
  ({
    rdns,
    name: rdns,
    icon: "",
    apiVersion,
    connect,
  }) as InitialAPI;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("wallet discovery", () => {
  // Keys are not stable (a wallet may use a fresh key per page load), so every
  // case is keyed by an arbitrary string and identified by rdns.
  const named = (rdns: string, name: string, apiVersion = "4.0.1") =>
    ({ ...wallet(rdns, apiVersion), name }) as InitialAPI;

  test("finds any supported wallet, one row per rdns, by name", () => {
    const registry = {
      "0f3a-uuid": named("io.lace.wallet", "Lace"),
      "1am": named("com.midnight.1am", "1AM"),
      "0b7c-uuid": named("com.third.wallet", "Third"),
      old: wallet("com.old.wallet", "3.1.0"),
    } as never;
    // One row per rdns, sorted by the name the user reads.
    expect(walletChoices(registry).map((c) => c.name)).toEqual([
      "1AM",
      "Lace",
      "Third",
    ]);
    expect(walletChoices(registry)).toHaveLength(3);
    expect(walletChoices(undefined)).toEqual([]);
  });

  test("excludes an unsupported apiVersion and keeps the supported one", () => {
    const registry = {
      old: wallet("io.lace.wallet", "3.1.0"),
      new: wallet("io.lace.wallet", "4.0.1"),
    } as never;
    const [choice] = walletChoices(registry);
    expect(choice?.api.apiVersion).toBe("4.0.1");
    expect(choice?.duplicate).toBe(false);
    expect(walletChoices({ only: wallet("x", "3.1.0") } as never)).toEqual([]);
  });

  test("picks the highest supported version and flags a duplicate rdns", () => {
    const registry = {
      a: wallet("io.lace.wallet", "4.0.0"),
      b: wallet("io.lace.wallet", "4.2.0"),
      c: wallet("io.lace.wallet", "4.1.0"),
    } as never;
    const [choice] = walletChoices(registry);
    expect(choice?.api.apiVersion).toBe("4.2.0");
    expect(choice?.duplicate).toBe(true);
  });

  test("signData is feature-detected before any signature-based auth", () => {
    // auth-client.ts guards on this, so assert the guard's own predicate.
    const can = (api: { signData?: unknown }) =>
      typeof api.signData === "function";
    expect(can({ signData: async () => ({}) })).toBe(true);
    expect(can({})).toBe(false);
  });
});

describe("network reconciliation", () => {
  test("accepts the casing each wallet reports for preprod", () => {
    for (const id of ["preprod", "PreProd", "PREPROD", " preprod "])
      expect(() => assertSupportedNetwork(id)).not.toThrow();
  });

  test("refuses every other network, including the connector-standard one", () => {
    for (const id of ["mainnet", "Mainnet", "preview", "undeployed", ""])
      expect(() => assertSupportedNetwork(id)).toThrow(/Only PREPROD/);
  });
});

describe("a wallet changed mid-flow", () => {
  // Lace 2.4.3 registers hintUsage but the method throws "Method not implemented."
  // synchronously (lace#2270). An optional call does NOT catch a synchronous throw:
  // `x.m?.(...).catch(...)` still propagates it. A hint is advisory, so a wallet
  // that cannot take one is still connected.
  const HINT_CASES: readonly (readonly [string, unknown])[] = [
    ["absent (Lace 2.4.2)", undefined],
    [
      "throws synchronously (Lace 2.4.3)",
      () => {
        throw new Error("Method not implemented.");
      },
    ],
    ["rejects asynchronously", () => Promise.reject(new Error("nope"))],
    ["resolves", () => Promise.resolve()],
  ];

  for (const [name, hintUsage] of HINT_CASES)
    test(`connects when hintUsage is ${name}`, async () => {
      const connector = new DappWalletConnector();
      const api = {
        getConnectionStatus: async () => ({
          status: "connected",
          networkId: "preprod",
        }),
        getConfiguration: async () => ({ networkId: "preprod" }),
        getUnshieldedAddress: async () => ({
          unshieldedAddress: "mn_addr_preprod1",
        }),
        ...(hintUsage === undefined ? {} : { hintUsage }),
      } as unknown as ConnectedAPI;
      await connector.connect(
        wallet("io.lace.wallet", "4.0.1", async () => api) as never,
      );
      expect(connector.state.status).toBe("connected");
    });

  // The connector exposes no events (v4.0.1 has no on/subscribe), so the only
  // signal is re-reading getConnectionStatus. refresh() is that re-read, and it
  // runs on a timer and on focus.
  const handle = (read: () => string) =>
    wallet(
      "io.lace.wallet",
      "4.0.1",
      async () =>
        ({
          getConnectionStatus: async () => ({
            status: "connected",
            networkId: read(),
          }),
          getConfiguration: async () => ({ networkId: read() }),
          getUnshieldedAddress: async () => ({
            unshieldedAddress: "mn_addr_preprod1",
          }),
        }) as ConnectedAPI,
    ) as never;

  // After connecting on preprod, the network the wallet reports next time.
  const CASES: readonly (readonly [string, string, string | null])[] = [
    ["stays on preprod", "preprod", null],
    // Named, not generic: the user is told which network to leave.
    ["switches to mainnet", "mainnet", wrongNetworkMessage("mainnet")],
    ["switches to preview", "preview", wrongNetworkMessage("preview")],
  ];

  for (const [name, next, message] of CASES)
    test(`a wallet that ${name} refreshes to the right state`, async () => {
      let network = "preprod";
      const connector = new DappWalletConnector();
      await connector.connect(handle(() => network));
      expect(connector.state.status).toBe("connected");
      network = next;
      const state = await connector.refresh();
      if (message) {
        expect(state.status).toBe("error");
        expect(state.status === "error" && state.message).toBe(message);
      } else expect(state).toMatchObject({ status: "connected" });
    });

  test("disconnect clears the connection so refresh does nothing", async () => {
    const connector = new DappWalletConnector();
    await connector.connect(handle(() => "preprod"));
    connector.disconnect(false);
    expect(connector.state.status).toBe("disconnected");
    expect(await connector.refresh()).toEqual({ status: "disconnected" });
  });
});

describe("late wallet injection", () => {
  test("reports a wallet that appears after the first read", async () => {
    let registry: Record<string, InitialAPI> | undefined;
    const seen: number[] = [];
    const stop = watchWallets(
      () => registry as never,
      (found) => seen.push(found.length),
      { intervalMs: 1, timeoutMs: 200 },
    );
    expect(seen).toEqual([0]);
    registry = { a: wallet("io.lace.wallet") };
    await wait(20);
    expect(seen.at(-1)).toBe(1);
    stop();
  });

  test("stops on the first find and after the timeout", async () => {
    let reads = 0;
    const stop = watchWallets(
      () => {
        reads += 1;
        return { a: wallet("io.lace.wallet") } as never;
      },
      () => {},
      { intervalMs: 0, timeoutMs: 50 },
    );
    expect(reads).toBe(1);
    stop();
    let empty = 0;
    const stopEmpty = watchWallets(
      () => {
        empty += 1;
        return undefined;
      },
      () => {},
      { intervalMs: 1, timeoutMs: 0 },
    );
    await wait(10);
    expect(empty).toBe(1);
    stopEmpty();
  });
});

describe("typed errors", () => {
  test("every code has exactly one subclass that carries it", () => {
    const made = {
      REJECTED_SIGNATURE: new RejectedSignatureError(),
      LOCKED_WALLET: new LockedWalletError(),
      WRONG_NETWORK: new WrongNetworkError(),
      INSUFFICIENT_DUST: new InsufficientDustError(),
    };
    expect(Object.keys(made).sort()).toEqual(
      [...MIDNIGHT_CLIENT_ERROR_CODES].sort(),
    );
    for (const [code, error] of Object.entries(made)) {
      expect(error.code).toBe(code as never);
      expect(error).toBeInstanceOf(MidnightClientError);
      expect(error).toBeInstanceOf(Error);
      // The name survives the subclass, which a bare Error would not.
      expect(error.name).toBe(error.constructor.name);
    }
  });

  test("keeps a custom message and detail, and defaults both", () => {
    expect(new LockedWalletError("custom", { a: 1 }).detail).toEqual({ a: 1 });
    expect(new LockedWalletError().message).toMatch(/locked/i);
    expect(new WrongNetworkError().detail).toEqual({});
  });

  test("a subclass keeps its prototype so instanceof survives a transpile", () => {
    const error = new RejectedSignatureError();
    expect(Object.getPrototypeOf(error)).toBe(RejectedSignatureError.prototype);
  });
});

describe("classifying a wallet failure", () => {
  test("reads a typed error's own code without walking anything", () => {
    expect(classifyMidnightClientError(new WrongNetworkError())).toBe(
      "WRONG_NETWORK",
    );
  });

  // Every shape an effect fiber can wrap the real failure in. A wallet reports
  // through whichever one its runtime produced, so all of them must classify.
  const FIBERS: readonly (readonly [string, unknown])[] = [
    ["Fail", { _tag: "Fail", error: { _tag: "Wallet.Sign" } }],
    ["Die", { _tag: "Die", defect: { _tag: "Wallet.Sign" } }],
    [
      "Sequential",
      { _tag: "Sequential", left: { _tag: "Wallet.Sign" }, right: {} },
    ],
    [
      "Parallel",
      { _tag: "Parallel", left: {}, right: { _tag: "Wallet.Sign" } },
    ],
    [
      "Transacting",
      { _tag: "Wallet.Transacting", cause: { _tag: "Wallet.Sign" } },
    ],
    ["nested cause", { cause: { _tag: "Wallet.Sign" } }],
    [
      "fiber cause",
      {
        [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
          _tag: "Wallet.Sign",
        },
      },
    ],
  ];

  for (const [name, error] of FIBERS)
    test(`classifies a ${name} wrapper as a rejected signature`, () => {
      expect(classifyMidnightClientError(error)).toBe("REJECTED_SIGNATURE");
    });

  test("classifies by name, message and token, in a fixed precedence", () => {
    const cases: readonly (readonly [unknown, string | null])[] = [
      [{ name: "LockedWalletError" }, "LOCKED_WALLET"],
      [{ name: "ConnectionError" }, "LOCKED_WALLET"],
      [{ message: "Wallet is not connected" }, "LOCKED_WALLET"],
      [{ message: "wallet is locked or not connected" }, "LOCKED_WALLET"],
      [{ name: "WrongNetworkError" }, "WRONG_NETWORK"],
      [{ message: "unsupported midnight network" }, "WRONG_NETWORK"],
      [{ message: "network guard refused" }, "WRONG_NETWORK"],
      [{ message: "only preprod is enabled" }, "WRONG_NETWORK"],
      [
        { _tag: "Wallet.InsufficientFunds", tokenType: "dust" },
        "INSUFFICIENT_DUST",
      ],
      // A different token is not a DUST shortfall.
      [{ _tag: "Wallet.InsufficientFunds", tokenType: "night" }, null],
      [{ message: "something else entirely" }, null],
      [null, null],
      [undefined, null],
      ["a string", null],
      [42, null],
    ];
    for (const [error, code] of cases)
      expect([error, classifyMidnightClientError(error)]).toEqual([
        error,
        code,
      ]);
  });

  test("wrong network wins over a dust shortfall when both are present", () => {
    expect(
      classifyMidnightClientError({
        _tag: "Parallel",
        left: { _tag: "Wallet.InsufficientFunds", tokenType: "dust" },
        right: { name: "WrongNetworkError" },
      }),
    ).toBe("WRONG_NETWORK");
  });

  test("survives a hostile getter instead of throwing while classifying", () => {
    const hostile = {
      get _tag(): string {
        throw new Error("nope");
      },
      get message(): string {
        throw new Error("nope");
      },
    };
    expect(classifyMidnightClientError(hostile)).toBeNull();
  });

  test("stops walking a cyclic graph and a very deep one", () => {
    const cyclic: Record<string, unknown> = { _tag: "Fail" };
    cyclic.error = cyclic;
    expect(classifyMidnightClientError(cyclic)).toBeNull();
    let deep: Record<string, unknown> = { _tag: "Wallet.Sign" };
    for (let level = 0; level < 40; level += 1) deep = { cause: deep };
    // Beyond the 16-node budget the signal is not reached, and that is bounded.
    expect(classifyMidnightClientError(deep)).toBeNull();
  });

  test("the four predicates agree with the classifier", () => {
    const predicates = {
      REJECTED_SIGNATURE: [isRejectedSignatureError, { _tag: "Wallet.Sign" }],
      LOCKED_WALLET: [isLockedWalletError, { name: "LockedWalletError" }],
      WRONG_NETWORK: [isWrongNetworkError, { name: "WrongNetworkError" }],
      INSUFFICIENT_DUST: [
        isInsufficientDustError,
        { _tag: "Wallet.InsufficientFunds", tokenType: "dust" },
      ],
    } as const;
    for (const [code, [predicate, signal]] of Object.entries(predicates)) {
      expect([code, predicate(signal)]).toEqual([code, true]);
      expect([code, classifyMidnightClientError(signal)]).toEqual([code, code]);
      expect([code, predicate({})]).toEqual([code, false]);
    }
  });

  test("rethrows a classified error as its subclass, keeping the cause", () => {
    try {
      const failure = Object.assign(new Error("user closed the popup"), {
        name: "SignError",
        _tag: "Wallet.Sign",
      });
      rethrowAsMidnightClientError(failure, "fallback");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RejectedSignatureError);
      expect((error as MidnightClientError).detail).toEqual({
        causeName: "SignError",
        causeTag: "Wallet.Sign",
      });
      // The wallet's own words reach the user, not a generic sentence.
      expect((error as Error).message).toBe("user closed the popup");
    }
  });

  test("rethrows the original when nothing classifies it", () => {
    const original = new Error("unrelated");
    expect(() => rethrowAsMidnightClientError(original, "fallback")).toThrow(
      original,
    );
  });

  test("uses the fallback message for a classified non-Error", () => {
    try {
      rethrowAsMidnightClientError({ _tag: "Wallet.Sign" }, "fallback text");
    } catch (error) {
      expect((error as Error).message).toBe("fallback text");
    }
  });
});

describe("network guard", () => {
  test("allows exactly the network each mode names", () => {
    expect([...NETWORK_GUARD_ALLOWED["preprod-only"]]).toEqual([
      SUPPORTED_MIDNIGHT_NETWORK,
    ]);
    expect([...NETWORK_GUARD_ALLOWED["undeployed-only"]]).toEqual([
      LOCAL_DISPOSABLE_NETWORK,
    ]);
    const every = NETWORK_GUARD_MODES.flatMap((mode) => [
      ...NETWORK_GUARD_ALLOWED[mode],
    ]);
    for (const mode of NETWORK_GUARD_MODES) {
      const allowed = [...NETWORK_GUARD_ALLOWED[mode]];
      for (const network of allowed)
        expect(() => assertNetworkGuard(network, mode)).not.toThrow();
      for (const other of every.filter((name) => !allowed.includes(name)))
        expect(() => assertNetworkGuard(other, mode)).toThrow(
          WrongNetworkError,
        );
    }
  });

  test("refuses an unknown mode rather than allowing everything", () => {
    expect(() => assertNetworkGuard("preprod", "anything" as never)).toThrow(
      /Unknown network guard mode/,
    );
  });

  test("the local guard accepts only the disposable network", () => {
    expect(() =>
      assertLocalDisposableNetwork(LOCAL_DISPOSABLE_NETWORK),
    ).not.toThrow();
    expect(() => assertLocalDisposableNetwork("preprod")).toThrow(
      WrongNetworkError,
    );
  });

  test("encodes a 32-byte label with the name at the front and zeros after", () => {
    for (const network of [
      SUPPORTED_MIDNIGHT_NETWORK,
      LOCAL_DISPOSABLE_NETWORK,
    ]) {
      const label = encodeNetworkLabel(network);
      expect(label).toHaveLength(32);
      const name = new TextDecoder().decode(label).replace(/\0+$/, "");
      expect(name).toBe(network);
      expect(label.subarray(network.length).every((byte) => byte === 0)).toBe(
        true,
      );
    }
  });

  test("refuses to encode a network it does not support", () => {
    expect(() => encodeNetworkLabel("mainnet" as never)).toThrow(
      /Cannot encode network label/,
    );
  });
});

describe("connect failures are classified by cause", () => {
  // The connector's own error shape: `type` then `code`. APIError is not a
  // class (docs: "Do not use instanceof checks"), so this is the only test that
  // works.
  const api = (code: string) => ({
    type: "DAppConnectorAPIError",
    code,
    reason: `wallet reported ${code}`,
  });

  // Every code the connector can throw, and the sentence the user reads.
  const CODES: readonly (readonly [string, string, RegExp])[] = [
    ["Rejected", REJECTED_CONNECTION, /declined/i],
    ["PermissionRejected", PERMISSION_BLOCKED, /blocking milo.*settings/i],
    ["Disconnected", WALLET_DISCONNECTED, /disconnected.*reconnect/i],
    ["InternalError", WALLET_INTERNAL, /update the extension/i],
    ["InvalidRequest", WALLET_BAD_REQUEST, /reload the page/i],
  ];

  for (const [code, sentence, shape] of CODES)
    test(`${code} gets its own sentence`, () => {
      expect(connectFailureMessage(api(code))).toBe(sentence);
      expect(sentence).toMatch(shape);
    });

  test("Rejected and PermissionRejected do not share a sentence", () => {
    // Declining one request is retryable; a stored block is not, so telling the
    // user to retry would loop forever.
    expect(connectFailureMessage(api("Rejected"))).not.toBe(
      connectFailureMessage(api("PermissionRejected")),
    );
  });

  test("an unlabelled error does not claim to know the cause", () => {
    for (const error of [
      new Error("boom"),
      null,
      undefined,
      { code: "Rejected" },
    ])
      expect(connectFailureMessage(error)).toBe(CONNECT_FAILED);
    expect(CONNECT_FAILED).not.toMatch(/disconnected|declined|blocking/i);
  });

  test("a wrong network names the network the wallet reported", () => {
    expect(wrongNetworkMessage("mainnet")).toBe(
      "Your wallet is on Mainnet. Switch it to Preprod.",
    );
    expect(wrongNetworkMessage("preview")).toContain("Preview");
    // An id we do not know is passed through rather than hidden.
    expect(wrongNetworkMessage("devnet-9")).toContain("devnet-9");
    expect(networkName("PREPROD")).toBe("Preprod");
  });

  test("a network refusal is routed through the network sentence", () => {
    expect(
      connectMessage(new WrongNetworkError("no", { network: "mainnet" })),
    ).toBe(wrongNetworkMessage("mainnet"));
    // Without a recorded network it falls back to the static sentence.
    expect(connectMessage(new WrongNetworkError("no"))).toBe(
      WRONG_NETWORK_MESSAGE,
    );
  });

  test("the address prefix names its network, as a second signal", () => {
    expect(networkOfAddress("mn_addr_preprod1qqqq")).toBe("preprod");
    expect(networkOfAddress("mn_addr1qqqq")).toBe("mainnet");
    expect(networkOfAddress("mn_addr_preview1qqqq")).toBe("preview");
    expect(networkOfAddress("not-an-address")).toBeNull();
  });

  test("a wallet reporting preprod but returning a mainnet address is refused", async () => {
    // The two signals can disagree; the address is what would be signed with.
    const api = {
      getConnectionStatus: async () => ({
        status: "connected" as const,
        networkId: "preprod",
      }),
      getConfiguration: async () => ({
        networkId: "preprod",
        indexerUri: "",
        indexerWsUri: "",
        substrateNodeUri: "",
      }),
      getUnshieldedAddress: async () => ({
        unshieldedAddress: "mn_addr1qqqqqqqq",
      }),
    };
    await expect(verifyPreprodConnection(api as never)).rejects.toThrow(
      WrongNetworkError,
    );
  });

  test("the different-account sentence is specific and actionable", () => {
    expect(DIFFERENT_ACCOUNT).toBe(
      "A different wallet account is connected. Switch back to the account you used for this order.",
    );
    expect(UNSUPPORTED_WALLET).toMatch(/install the extension/i);
  });
});

describe("the connector reports the classified sentence", () => {
  // The table above proves the classifier; this proves connect() USES it. The
  // wiring was silently missing once, and only an end-to-end call caught it.
  const handle = (connect: () => Promise<unknown>) =>
    ({
      rdns: "test",
      name: "Test",
      icon: "",
      apiVersion: "4.0.1",
      connect,
    }) as never;

  const CASES: readonly (readonly [string, string, string])[] = [
    ["Rejected", "Rejected", REJECTED_CONNECTION],
    ["PermissionRejected", "PermissionRejected", PERMISSION_BLOCKED],
    ["Disconnected", "Disconnected", WALLET_DISCONNECTED],
    ["InternalError", "InternalError", WALLET_INTERNAL],
    ["InvalidRequest", "InvalidRequest", WALLET_BAD_REQUEST],
  ];

  for (const [name, code, sentence] of CASES)
    test(`connect() reports ${name} as its own sentence`, async () => {
      const connector = new DappWalletConnector();
      const state = await connector.connect(
        handle(async () => {
          throw { type: "DAppConnectorAPIError", code, reason: "no" };
        }),
      );
      expect(state.status).toBe("error");
      expect(state.status === "error" ? state.message : "").toBe(sentence);
    });

  test("connect() with no wallet says how to get one", async () => {
    const connector = new DappWalletConnector();
    const state = await connector.connect(undefined);
    expect(state.status === "error" ? state.message : "").toBe(
      UNSUPPORTED_WALLET,
    );
  });
});
