import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { errorDiagnostics } from "../src/diagnostics.mjs";

test("MID-T01 error diagnostics keep only known names and existing source locations", () => {
  const canary = "PRIVATE_WITNESS_MUST_NOT_ESCAPE";
  const path = fileURLToPath(new URL("../src/local.mjs", import.meta.url));
  const cause = {
    name: "Wallet.InsufficientFunds",
    message: canary,
    witness: canary,
  };
  const error = {
    name: "(FiberFailure) Wallet.Transacting",
    message: canary,
    args: [canary],
    stack: `${canary}\n    at ${canary} (${path}:101:8)\n    at /private/${canary}.js:4:2`,
    [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
      _tag: "Fail",
      error: cause,
    },
  };
  const diagnostic = errorDiagnostics(error);
  assert.deepEqual(diagnostic.errorNames, [
    "Wallet.Transacting",
    "Wallet.InsufficientFunds",
  ]);
  assert.deepEqual(diagnostic.sourceLocations, [
    "packages/integration/src/local.mjs:101:8",
  ]);
  assert(!JSON.stringify(diagnostic).includes(canary));
});

test("MID-T01 runtime custom codes are exact bounded data, not parsed out of private messages", () => {
  assert.deepEqual(
    errorDiagnostics({ code: 1010, data: "Custom error: 134" })
      .runtimeCustomCodes,
    [134],
  );
  for (const data of [
    "Custom error: 134: secret",
    "prefix Custom error: 134",
    "Custom error: 0134",
    "Custom error: 256",
    "Custom error: -1",
    { reason: "Custom error: 134" },
  ]) {
    assert.equal(
      errorDiagnostics({ code: 1010, data }).runtimeCustomCodes,
      undefined,
    );
  }
  assert.equal(
    errorDiagnostics({ code: 1010, message: "Custom error: 134" })
      .runtimeCustomCodes,
    undefined,
  );
  assert.equal(
    errorDiagnostics({ code: -32603, data: "Custom error: 134" })
      .runtimeCustomCodes,
    undefined,
  );
});

test("MID-T01 diagnostics bound cycles and reject arbitrary names and fabricated source paths", () => {
  const secret = "0123456789abcdef".repeat(4);
  const error = {
    name: secret,
    _tag: secret,
    stack: `Error\n    at file://${fileURLToPath(new URL(`../src/${secret}.js`, import.meta.url))}:1:1`,
  };
  error.cause = error;
  assert.deepEqual(errorDiagnostics(error), {
    errorNames: [],
    sourceLocations: [],
  });
  const hostile = {
    get stack() {
      throw new Error(secret);
    },
    get cause() {
      throw new Error(secret);
    },
  };
  assert.deepEqual(errorDiagnostics(hostile), {
    errorNames: [],
    sourceLocations: [],
    unreadableKeys: ["stack", "cause"],
  });
});

test("MID-T01 RPC submission diagnostics retain numeric codes and exact validity enums only", () => {
  const secret = "PRIVATE_RPC_PAYLOAD";
  const rpc = {
    name: "RpcError",
    code: 1010,
    data: "Transaction would exhaust the block limits",
    message: secret,
    txData: secret,
  };
  const error = {
    name: "(FiberFailure) SubmissionError",
    [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
      _tag: "Fail",
      error: { _tag: "SubmissionError", cause: rpc, txData: secret },
    },
  };
  const result = errorDiagnostics(error);
  assert.deepEqual(result.errorNames, ["SubmissionError", "RpcError"]);
  assert.deepEqual(result.rpcCodes, [1010]);
  assert.deepEqual(result.transactionValidity, ["ExhaustsResources"]);
  assert(!JSON.stringify(result).includes(secret));
  for (const data of [secret, `${rpc.data}: ${secret}`, { reason: secret }]) {
    assert.equal(
      errorDiagnostics({ ...rpc, data }).transactionValidity,
      undefined,
    );
  }
  for (const code of ["1010", NaN, Infinity, 2 ** 40]) {
    assert.equal(errorDiagnostics({ ...rpc, code }).rpcCodes, undefined);
  }
  assert.deepEqual(
    errorDiagnostics({ code: -32601, data: secret }).rpcCodes,
    [-32601],
  );
});
