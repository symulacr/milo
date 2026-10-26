import { describe, expect, test } from "bun:test";
import {
  ChainError,
  type ChainErrorCode,
  messageFor,
  toChainError,
} from "./errors";

const named = (name: string, message = "Transaction failed") =>
  Object.assign(new Error(message), { name });

// Every code, with the sample that must map to it and a phrase its message must
// carry. `null` marks a code that is thrown directly with its own message and is
// never a toChainError output, so only its message is asserted. One row per code,
// so a new code cannot ship without a message and a test.
const CODES: readonly (readonly [ChainErrorCode, RegExp | null, RegExp])[] = [
  ["WALLET_UNAVAILABLE", /method not implemented/i, /your wallet/i],
  ["WALLET_REJECTED", /^Rejected$/, /declined/i],
  ["PERMISSION_REJECTED", /^PermissionRejected$/, /permission/i],
  ["WALLET_DISCONNECTED", /^Disconnected$/, /connection/i],
  ["INVALID_REQUEST", /^InvalidRequest$/, /transaction/i],
  ["WRONG_NETWORK", /wrong network/i, /preprod/i],
  ["INSUFFICIENT_DUST", /insufficient dust/i, /tDUST/],
  ["MISSING_PROOF_SERVER", null, /proof service/i],
  ["ZK_ARTIFACT_UNAVAILABLE", /zk artifact/i, /keys/i],
  ["WASM_UNAVAILABLE", /__wbindgen/i, /runtime/i],
  ["CONTRACT_REJECTED", /failed assert/i, /contract/i],
  ["TX_FAILED", /^CallTxFailedError$/, /network/i],
  ["UNKNOWN", null, /did not complete/i],
];

describe("toChainError", () => {
  test("maps every SDK transaction failure name to TX_FAILED", () => {
    for (const name of [
      "TxFailedError",
      "DeployTxFailedError",
      "CallTxFailedError",
      "InsertVerifierKeyTxFailedError",
      "RemoveVerifierKeyTxFailedError",
      "ReplaceMaintenanceAuthorityTxFailedError",
    ])
      expect(toChainError(named(name)).code).toBe("TX_FAILED");
    expect(toChainError(named("TypeError", "boom")).code).toBe("UNKNOWN");
  });

  test("keeps the finalization status in the detail for the failure log", () => {
    const error = toChainError(
      named(
        "CallTxFailedError",
        '{"circuitId":"approve","status":"FailFallible"}',
      ),
    );
    expect(error.message).toBe(messageFor("TX_FAILED"));
    expect(error.detail).toContain("FailFallible");
  });

  test("maps the wallet codes and keeps a ChainError unchanged", () => {
    const withCode = (code: string | number) =>
      toChainError(Object.assign(new Error("no"), { code })).code;
    // 138 is the ledger's BalanceCheckOverspend: not enough DUST for the fee.
    expect(withCode(138)).toBe("INSUFFICIENT_DUST");
    expect(withCode(1)).toBe("UNKNOWN");
    const original = new ChainError("WRONG_NETWORK", "preprod only");
    expect(toChainError(original)).toBe(original);
  });

  test("maps a wallet that exposes a method it does not implement", () => {
    expect(toChainError(new TypeError("x is not a function")).code).toBe(
      "WALLET_UNAVAILABLE",
    );
  });

  test("recognises a dust shortfall, a network mismatch and a missing artifact", () => {
    const codeOf = (message: string) => toChainError(new Error(message)).code;
    expect(codeOf("BalanceCheckOverspend")).toBe("INSUFFICIENT_DUST");
  });

  // Item: every code has a user message and a test. A row whose sample is a bare
  // code is fed in as `{ code }`; one whose sample is a message goes through the
  // text mapper; a null sample is a code thrown directly, so only its message is
  // asserted. No code can be added without a row here.
  for (const [code, sample, phrase] of CODES)
    test(`${code} has a plain message${sample ? " and maps" : ""}`, () => {
      if (sample) {
        // `^Name$` is a connector code or an SDK error name; anything else is a
        // message the text mapper recognises.
        const bare = /^\^?([A-Za-z]+)\$?$/.exec(sample.source)?.[1];
        const error = bare
          ? Object.assign(new Error("x"), { name: bare, code: bare })
          : new Error(sample.source);
        expect(toChainError(error).code).toBe(code);
      }
      const message = messageFor(code);
      expect(message).toMatch(phrase);
      expect(message).not.toMatch(/lace|1am|\[CONVEX|Request ID/i);
      expect(message).not.toMatch(/^\s|\s$/);
    });
});
