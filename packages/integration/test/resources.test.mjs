import assert from "node:assert/strict";
import test from "node:test";
import {
  compareResources,
  decodeGasCost,
  measureDeploymentResources,
  requireIndividualResources,
} from "../src/resources.mjs";

const gasResult = (gas) => {
  const bytes = Buffer.alloc(9);
  bytes.writeBigUInt64LE(gas, 1);
  return bytes;
};
const limits = {
  transactionBytes: 100,
  extrinsicBytes: 108,
  gas: 1000n,
  sizeWeight: { refTime: 20n, proofSize: 0n },
  maxExtrinsic: { refTime: 1020n, proofSize: 10n },
  maxLength: 108,
};

test("MID-T01 decodes exact SCALE Result::Ok(u64) without precision loss", () => {
  for (const gas of [0n, 1n, 1n << 60n, (1n << 64n) - 1n]) {
    assert.deepEqual(decodeGasCost(gasResult(gas)), { status: "ok", gas });
  }
  for (const bytes of [
    new Uint8Array(),
    Uint8Array.of(2),
    new Uint8Array(8),
    new Uint8Array(10),
  ]) {
    assert.throws(() => decodeGasCost(bytes));
  }
  const secret = "PRIVATE_LEDGER_ERROR";
  const result = decodeGasCost(
    Buffer.concat([Buffer.from([1]), Buffer.from(secret)]),
  );
  assert.deepEqual(result, { status: "ledger-error" });
  assert(!JSON.stringify(result).includes(secret));
});

test("MID-T01 checks full extrinsic length and both declared weight dimensions independently", () => {
  assert.equal(compareResources(limits).withinIndividualLimits, true);
  assert.deepEqual(compareResources({ ...limits, maxLength: 107 }).exceeded, [
    "extrinsic-length",
  ]);
  assert.deepEqual(compareResources({ ...limits, gas: 1001n }).exceeded, [
    "dispatch-ref-time",
  ]);
  assert.deepEqual(
    compareResources({
      ...limits,
      sizeWeight: { refTime: 20n, proofSize: 11n },
    }).exceeded,
    ["dispatch-proof-size"],
  );
  assert.deepEqual(
    compareResources({ ...limits, maxLength: 107, gas: 1001n }).exceeded,
    ["extrinsic-length", "dispatch-ref-time"],
  );
  assert.equal(
    compareResources({ ...limits, gas: (1n << 64n) - 1n })
      .declaredDispatchWeight.refTime,
    ((1n << 64n) - 1n).toString(),
  );
  for (const invalid of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "secret",
    "1e9",
    1n << 64n,
  ]) {
    assert.throws(() => compareResources({ ...limits, gas: invalid }));
  }
  assert.throws(() => compareResources({ ...limits, extrinsicBytes: 100 }));
  assert.throws(() => compareResources({ ...limits, maxLength: 0 }));
});

function fixture() {
  const genesisHash = `0x${"a".repeat(64)}`;
  const blockHash = `0x${"b".repeat(64)}`;
  const codeHash = `0x${"c".repeat(64)}`;
  const id = `01${"d".repeat(64)}`;
  const bytes = Uint8Array.of(10, 20, 30);
  const wrapped = Uint8Array.of(24, 4, 3, 0, 12, ...bytes);
  const events = [];
  const option = (value) => ({ isSome: true, unwrap: () => value });
  const encoded = { toU8a: () => wrapped };
  const sendMnTransaction = (input) => {
    assert.equal(input, "0x0a141e");
    return encoded;
  };
  sendMnTransaction.callIndex = Uint8Array.of(3, 0);
  const at = {
    runtimeVersion: {
      specName: "midnight",
      specVersion: "1000000",
      transactionVersion: "3",
    },
    consts: {
      system: {
        blockWeights: {
          perClass: { normal: { maxExtrinsic: option(limits.maxExtrinsic) } },
        },
        blockLength: { max: { normal: 108 } },
      },
    },
    query: {
      midnight: {
        configurableTransactionSizeWeight: async () => limits.sizeWeight,
      },
    },
    registry: {
      metadata: { toU8a: () => Uint8Array.of(1, 2, 3) },
      createType(type, value) {
        if (type === "Call") {
          assert.deepEqual(value, {
            callIndex: sendMnTransaction.callIndex,
            args: ["0x0a141e"],
          });
          return "synthetic-call";
        }
        if (type === "Extrinsic") {
          assert.equal(value, "synthetic-call");
          return encoded;
        }
        assert.equal(type, "Bytes");
        assert.equal(value, "0x0a141e");
        return { toU8a: () => Uint8Array.of(12, ...bytes) };
      },
    },
  };
  const api = {
    registry: { metadata: { toU8a: () => Uint8Array.of(1, 2, 3) } },
    genesisHash: { toHex: () => genesisHash },
    at: async (block) => {
      assert.equal(block, blockHash);
      return at;
    },
    tx: { midnight: { sendMnTransaction } },
    rpc: {
      chain: {
        getFinalizedHead: async () => ({ toHex: () => blockHash }),
        getHeader: async (block) => {
          assert.equal(block, blockHash);
          return { number: 3 };
        },
      },
      state: {
        getStorageHash: async (key, block) => {
          assert.equal(key, "0x3a636f6465");
          assert.equal(block, blockHash);
          return { toHex: () => codeHash };
        },
        call: async (...args) => {
          events.push(args);
          assert.deepEqual(args, [
            "MidnightRuntimeApi_get_transaction_cost",
            "0x0c0a141e",
            blockHash,
          ]);
          return {
            toU8a: (bare) => {
              assert.equal(bare, true);
              return gasResult(1000n);
            },
          };
        },
      },
    },
  };
  const transaction = {
    serialize: () => bytes,
    identifiers: () => [id],
    toJSON: () => {
      throw new Error("PRIVATE_TRANSACTION");
    },
  };
  return { api, at, transaction, genesisHash, blockHash, codeHash, id, events };
}

test("MID-T01 binds read-only cost, limits and encoding to one finalized block", async () => {
  const f = fixture();
  const result = await measureDeploymentResources(f);
  assert.equal(result.scope, "individual-resource-preflight-not-admission");
  assert.equal(result.withinIndividualLimits, true);
  assert.equal(result.blockHash, f.blockHash);
  assert.equal(result.runtime.codeHash, f.codeHash);
  assert.equal(result.identifierCount, 1);
  assert.match(result.identifierListSha256, /^[0-9a-f]{64}$/);
  assert(!JSON.stringify(result).includes(f.id));
  assert.equal(result.transactionBytes, 3);
  assert.equal(result.extrinsicBytes, 8);
  assert.match(result.transactionSha256, /^[0-9a-f]{64}$/);
  assert.equal(f.events.length, 1);
  assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("MID-T01 fails closed on wrong genesis/runtime, missing limits and malformed identifiers", async () => {
  const mutations = [
    (f) => {
      f.genesisHash = `0x${"0".repeat(64)}`;
    },
    (f) => {
      f.at.runtimeVersion.specVersion = "1000001";
    },
    (f) => {
      f.at.runtimeVersion.transactionVersion = "4";
    },
    (f) => {
      f.api.registry.metadata.toU8a = () => Uint8Array.of(4, 5, 6);
    },
    (f) => {
      f.at.query.midnight.configurableTransactionSizeWeight = async () => {
        f.api.registry.metadata.toU8a = () => Uint8Array.of(4, 5, 6);
        return limits.sizeWeight;
      };
    },
    (f) => {
      f.api.rpc.state.getStorageHash = async () => ({
        toHex: () => `0x${"0".repeat(64)}`,
      });
    },
    (f) => {
      f.at.consts.system.blockWeights.perClass.normal.maxExtrinsic.isSome = false;
    },
    (f) => {
      f.transaction.identifiers = () => [];
    },
    (f) => {
      f.transaction.identifiers = () => ["PRIVATE"];
    },
    (f) => {
      f.transaction.identifiers = () => [{ toString: () => f.id }];
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    await assert.rejects(measureDeploymentResources(f));
    assert.equal(f.events.length, 0);
  }
});

test("MID-T01 reports an unknown resource conclusion on a private ledger-cost error", async () => {
  const f = fixture();
  f.api.rpc.state.call = async () => ({
    toU8a: () =>
      Buffer.concat([Buffer.from([1]), Buffer.from("PRIVATE_ERROR")]),
  });
  const result = await measureDeploymentResources(f);
  assert.equal(result.costStatus, "ledger-error");
  assert.equal(result.resourceConclusion, "unknown-cost");
  assert.equal(result.withinIndividualLimits, false);
  assert.throws(() => requireIndividualResources(result));
  assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("MID-T01 resource guard prevents send for oversized, missing and unknown measurements", async () => {
  let sent = 0;
  const send = (result) => {
    requireIndividualResources(result);
    sent++;
  };
  for (const result of [
    compareResources({ ...limits, gas: 1001n }),
    compareResources({ ...limits, maxLength: 107 }),
    { withinIndividualLimits: false, resourceConclusion: "unknown-cost" },
    {},
    { withinIndividualLimits: "true" },
  ]) {
    assert.throws(() => send(result));
  }
  assert.equal(sent, 0);
  send(compareResources(limits));
  assert.equal(sent, 1);
  const f = fixture();
  f.api.rpc.state.call = async () => {
    throw new Error("PRIVATE_RPC_FAILURE");
  };
  await assert.rejects(async () => send(await measureDeploymentResources(f)));
  assert.equal(sent, 1);
});
