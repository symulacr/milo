import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const u64Max = (1n << 64n) - 1n;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const unsigned = (value) => {
  if (typeof value === "number") assert(Number.isSafeInteger(value));
  const text = String(value);
  assert(/^(0|[1-9][0-9]{0,19})$/.test(text), "Invalid resource integer");
  const result = BigInt(text);
  assert(result <= u64Max, "Resource integer exceeds u64");
  return result;
};
const weight = (value) => ({
  refTime: unsigned(value.refTime),
  proofSize: unsigned(value.proofSize),
});
const publicWeight = (value) => ({
  refTime: value.refTime.toString(),
  proofSize: value.proofSize.toString(),
});

export function decodeGasCost(bytes) {
  assert(bytes instanceof Uint8Array && bytes.length > 0);
  // Only Result::Ok(u64) is decoded. Ledger errors may contain private data.
  if (bytes[0] === 1) return { status: "ledger-error" };
  assert(bytes[0] === 0 && bytes.length === 9, "Invalid gas-cost response");
  return {
    status: "ok",
    gas: Buffer.from(bytes).readBigUInt64LE(1),
  };
}

export function compareResources({
  transactionBytes,
  extrinsicBytes,
  gas,
  sizeWeight,
  maxExtrinsic,
  maxLength,
}) {
  assert(Number.isSafeInteger(transactionBytes) && transactionBytes > 0);
  assert(
    Number.isSafeInteger(extrinsicBytes) && extrinsicBytes > transactionBytes,
  );
  const limit = unsigned(maxLength);
  assert(limit > 0n);
  const overhead = weight(sizeWeight);
  const maximum = weight(maxExtrinsic);
  const sum = unsigned(gas) + overhead.refTime;
  const dispatch = {
    refTime: sum > u64Max ? u64Max : sum,
    proofSize: overhead.proofSize,
  };
  const exceeded = [];
  if (BigInt(extrinsicBytes) > limit) exceeded.push("extrinsic-length");
  if (dispatch.refTime > maximum.refTime) exceeded.push("dispatch-ref-time");
  if (dispatch.proofSize > maximum.proofSize)
    exceeded.push("dispatch-proof-size");
  return {
    transactionBytes,
    extrinsicBytes,
    gasRefTime: unsigned(gas).toString(),
    configurableSizeWeight: publicWeight(overhead),
    declaredDispatchWeight: publicWeight(dispatch),
    normalMaxExtrinsicWeight: publicWeight(maximum),
    normalMaxLength: limit.toString(),
    exceeded,
    withinIndividualLimits: exceeded.length === 0,
  };
}

export async function measureDeploymentResources({
  api,
  transaction,
  genesisHash,
}) {
  assert.equal(api.genesisHash.toHex(), genesisHash, "Probe genesis mismatch");
  const bytes = transaction.serialize();
  assert(bytes instanceof Uint8Array && bytes.length > 0);
  const identifiers = transaction.identifiers();
  assert(
    Array.isArray(identifiers) &&
      identifiers.length > 0 &&
      identifiers.length <= 256,
  );
  assert(
    identifiers.every(
      (id) => typeof id === "string" && /^[0-9a-f]{66}$/.test(id),
    ),
  );
  const blockHash = (await api.rpc.chain.getFinalizedHead()).toHex();
  assert(/^0x[0-9a-f]{64}$/.test(blockHash));
  const at = await api.at(blockHash);
  const runtime = at.runtimeVersion;
  assert.equal(runtime.specName.toString(), "midnight");
  assert.equal(runtime.specVersion.toString(), "1000000");
  assert.equal(runtime.transactionVersion.toString(), "3");
  const codeHash = await api.rpc.state.getStorageHash(
    "0x3a636f6465",
    blockHash,
  );
  const runtimeCodeHash = codeHash.toHex();
  assert(/^0x[0-9a-f]{64}$/.test(runtimeCodeHash));
  assert.notEqual(
    runtimeCodeHash,
    `0x${"0".repeat(64)}`,
    "Missing runtime code hash",
  );
  const header = await api.rpc.chain.getHeader(blockHash);
  const blockHeight = unsigned(header.number).toString();
  const max = at.consts.system.blockWeights.perClass.normal.maxExtrinsic;
  assert(max.isSome, "Missing normal per-extrinsic weight limit");
  const maxLength = at.consts.system.blockLength.max.normal;
  const sizeWeight =
    await at.query.midnight.configurableTransactionSizeWeight();

  // Match the pinned wallet's unsigned wrapper using the measured block's registry.
  const metadata = at.registry.metadata.toU8a();
  assert.deepEqual(
    metadata,
    api.registry.metadata.toU8a(),
    "Probe metadata drift",
  );
  const call = at.registry.createType("Call", {
    callIndex: api.tx.midnight.sendMnTransaction.callIndex,
    args: [hex(bytes)],
  });
  const extrinsic = at.registry.createType("Extrinsic", call);
  const extrinsicBytes = extrinsic.toU8a().length;
  const sdkExtrinsic = api.tx.midnight.sendMnTransaction(hex(bytes));
  assert.deepEqual(
    extrinsic.toU8a(),
    sdkExtrinsic.toU8a(),
    "Extrinsic encoding drift",
  );
  // Bytes interprets Uint8Array as already SCALE encoded; hex is raw input.
  const input = at.registry.createType("Bytes", hex(bytes)).toU8a();
  const result = await api.rpc.state.call(
    "MidnightRuntimeApi_get_transaction_cost",
    hex(input),
    blockHash,
  );
  const cost = decodeGasCost(result.toU8a(true));
  const context = {
    scope: "individual-resource-preflight-not-admission",
    genesisHash,
    blockHash,
    blockHeight,
    runtime: {
      specName: "midnight",
      specVersion: "1000000",
      transactionVersion: "3",
      codeHash: runtimeCodeHash,
      metadataSha256: hash(metadata),
    },
    identifierCount: identifiers.length,
    identifierListSha256: hash(JSON.stringify(identifiers)),
    transactionSha256: hash(bytes),
    extrinsicSha256: hash(extrinsic.toU8a()),
    costStatus: cost.status,
  };
  if (cost.status !== "ok") {
    return {
      ...context,
      transactionBytes: bytes.length,
      extrinsicBytes,
      withinIndividualLimits: false,
      resourceConclusion: "unknown-cost",
    };
  }
  return {
    ...context,
    ...compareResources({
      transactionBytes: bytes.length,
      extrinsicBytes,
      gas: cost.gas,
      sizeWeight,
      maxExtrinsic: max.unwrap(),
      maxLength,
    }),
  };
}

export function requireIndividualResources(result) {
  assert.equal(
    result.withinIndividualLimits,
    true,
    "Deployment resource preflight blocked submission",
  );
}

export async function deploymentPreflight(env, transaction, emit) {
  const { ApiPromise, HttpProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({
    provider: new HttpProvider(env.node),
    noInitWarn: true,
    throwOnConnect: true,
  });
  try {
    const result = await measureDeploymentResources({
      api,
      transaction,
      genesisHash: env.genesisHash,
    });
    emit("deployment-resource-preflight", result);
    requireIndividualResources(result);
  } finally {
    await api.disconnect();
  }
}
