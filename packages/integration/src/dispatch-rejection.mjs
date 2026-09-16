import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const idPrefix = Buffer.from("midnight:transcation-id[v1]:");
export function matchCounterLog(line, { identifiers, address, segments }) {
  if (
    !line.includes("Non guaranteed part of the transaction failed tx_hash = ")
  )
    return false;
  assert(line.length < 16_384);
  const match = line.match(
    /Non guaranteed part of the transaction failed tx_hash = (\[.*\]), segments = (\{.*\})\s*$/,
  );
  if (!match) return false;
  const encoded = [...match[1].matchAll(/Ok\(\[([0-9, ]+)\]\)/g)];
  if (match[1] !== `[${encoded.map((part) => part[0]).join(", ")}]`)
    return false;
  const found = encoded.map((part) => {
    const bytes = part[1].split(", ").map(Number);
    assert(
      bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255),
    );
    assert.equal(bytes.length, idPrefix.length + 33);
    const data = Buffer.from(bytes);
    assert(data.subarray(0, idPrefix.length).equals(idPrefix));
    return data.subarray(idPrefix.length).toString("hex");
  });
  if (JSON.stringify(found.sort()) !== JSON.stringify([...identifiers].sort()))
    return false;
  assert.match(address, /^[0-9a-f]{64}$/);
  assert.equal(
    [...segments.values()].filter((value) => value === "SegmentFail").length,
    1,
  );
  const expected = [...segments]
    .sort(([a], [b]) => a - b)
    .map(([segment, status]) => {
      assert(Number.isInteger(segment) && segment >= 0 && segment <= 65535);
      assert(["SegmentSuccess", "SegmentFail"].includes(status));
      return `${segment}: ${status === "SegmentSuccess" ? "Ok(())" : `Err(ReplayCounterMismatch(ContractAddress(${address})))`}`;
    })
    .join(", ");
  assert.equal(
    match[2],
    `{${expected}}`,
    "Native counter cause differs from the exact indexed segment outcome",
  );
  return true;
}

async function inspectCounterLog(path, data, address) {
  assert.equal(typeof path, "string");
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let size = 0;
  let matches = 0;
  try {
    for await (const line of lines) {
      size += Buffer.byteLength(line);
      assert(
        size < 16_777_216,
        "Native diagnostic log exceeds inspection budget",
      );
      if (
        matchCounterLog(line, {
          identifiers: data.identifiers,
          address,
          segments: data.segmentStatusMap,
        })
      )
        matches++;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  assert(matches > 0, "No exact transaction-bound native counter cause");
  return matches;
}

export function requireCounterDispatch(error, metadata) {
  assert.equal(error.isModule, true);
  assert.equal(metadata.section, "midnight");
  assert.equal(metadata.name, "Transaction");
  // node-1.0.0: pallet Transaction(3), Invalid(0), ReplayCounterMismatch(8), padding.
  assert.equal(error.asModule.error.toHex(), "0x03000800");
  return {
    rejectionBoundary: "finalized-dispatch",
    dispatchErrorHex: "0x03000800",
    conclusion: "ReplayCounterMismatch",
  };
}

export async function observeCounterDispatch(env, data, nodeLogPath) {
  assert(["FailEntirely", "FailFallible"].includes(data.status));
  assert.match(data.blockHash, /^[0-9a-f]{64}$/);
  const { ApiPromise, HttpProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({
    provider: new HttpProvider(env.node),
    noInitWarn: true,
    throwOnConnect: true,
  });
  try {
    assert.equal(
      (await api.rpc.chain.getBlockHash(0)).toHex(),
      env.genesisHash,
    );
    const blockHash = `0x${data.blockHash}`;
    const finalizedHead = await api.rpc.chain.getFinalizedHead();
    assert(
      (await api.rpc.chain.getHeader(finalizedHead)).number.toNumber() >=
        data.blockHeight,
    );
    assert.equal(
      (await api.rpc.chain.getBlockHash(data.blockHeight)).toHex(),
      blockHash,
    );
    const at = await api.at(blockHash);
    const runtime = await api.rpc.state.getRuntimeVersion(blockHash);
    assert.equal(runtime.specName.toString(), "midnight");
    assert.equal(runtime.specVersion.toString(), "1000000");
    const signedBlock = await api.rpc.chain.getBlock(blockHash);
    assert.equal(signedBlock.block.header.number.toNumber(), data.blockHeight);
    const bytes = data.tx.serialize();
    assert.equal(data.tx.transactionHash(), data.txHash);
    const matches = signedBlock.block.extrinsics
      .map((extrinsic, index) => ({ extrinsic, index }))
      .filter(
        ({ extrinsic }) =>
          extrinsic.method.section === "midnight" &&
          extrinsic.method.method === "sendMnTransaction" &&
          Buffer.from(extrinsic.method.args[0].toU8a(true)).equals(
            Buffer.from(bytes),
          ),
      );
    assert.equal(
      matches.length,
      1,
      "Counter failure must bind to exactly one actual extrinsic",
    );
    const events = await at.query.system.events();
    if (data.status === "FailFallible") {
      const partial = events.filter(
        ({ phase, event }) =>
          phase.isApplyExtrinsic &&
          phase.asApplyExtrinsic.toNumber() === matches[0].index &&
          event.section === "midnight" &&
          event.method === "TxPartialSuccess",
      );
      assert.equal(partial.length, 1);
      const actions = [...data.tx.intents.entries()].flatMap(
        ([segment, intent]) =>
          intent.actions.map((action) => ({
            segment: Number(segment),
            action,
          })),
      );
      assert.equal(actions.length, 1);
      const { segment, action } = actions[0];
      assert.equal(data.segmentStatusMap.get(segment), "SegmentFail");
      const matchedLogRecords = await inspectCounterLog(
        nodeLogPath,
        data,
        action.address,
      );
      return {
        rejectionBoundary: "finalized-partial-success-and-native-log",
        conclusion: "ReplayCounterMismatch",
        blockHash: data.blockHash,
        blockHeight: data.blockHeight,
        extrinsicIndex: matches[0].index,
        failedSegment: segment,
        matchedLogRecords,
      };
    }
    const failures = events.filter(
      ({ phase, event }) =>
        phase.isApplyExtrinsic &&
        phase.asApplyExtrinsic.toNumber() === matches[0].index &&
        event.section === "system" &&
        event.method === "ExtrinsicFailed",
    );
    assert.equal(failures.length, 1);
    const error = failures[0].event.data[0];
    assert(error.isModule);
    return {
      ...requireCounterDispatch(
        error,
        at.registry.findMetaError(error.asModule),
      ),
      blockHash: data.blockHash,
      blockHeight: data.blockHeight,
      extrinsicIndex: matches[0].index,
    };
  } finally {
    await api.disconnect();
  }
}
