import assert from "node:assert/strict";
import test from "node:test";
import {
  matchCounterLog,
  requireCounterDispatch,
} from "../src/dispatch-rejection.mjs";

test("MID-T01 only exact pinned pallet/invalid/counter bytes count as a dispatch counter rejection", () => {
  const error = (hex) => ({
    isModule: true,
    asModule: { error: { toHex: () => hex } },
  });
  const metadata = { section: "midnight", name: "Transaction" };
  assert.equal(
    requireCounterDispatch(error("0x03000800"), metadata).conclusion,
    "ReplayCounterMismatch",
  );
  for (const hex of ["0x03000700", "0x03000801", "0x03010800", "0x0300080000"])
    assert.throws(() => requireCounterDispatch(error(hex), metadata));
  assert.throws(() =>
    requireCounterDispatch(error("0x03000800"), {
      ...metadata,
      section: "other",
    }),
  );
  assert.throws(() =>
    requireCounterDispatch(error("0x03000800"), { ...metadata, name: "Other" }),
  );
  assert.throws(() => requireCounterDispatch({ isModule: false }, metadata));
});

test("MID-T01 partial counter cause binds every tagged ID, exact address and indexed segment result without generic text matching", () => {
  const id = `00${"ab".repeat(32)}`;
  const address = "cd".repeat(32);
  const bytes = [
    ...Buffer.concat([
      Buffer.from("midnight:transcation-id[v1]:"),
      Buffer.from(id, "hex"),
    ]),
  ].join(", ");
  const line = `2026-09-10 Non guaranteed part of the transaction failed tx_hash = [Ok([${bytes}])], segments = {0: Ok(()), 1: Err(ReplayCounterMismatch(ContractAddress(${address}))), 2: Ok(())}`;
  const expected = {
    identifiers: [id],
    address,
    segments: new Map([
      [0, "SegmentSuccess"],
      [1, "SegmentFail"],
      [2, "SegmentSuccess"],
    ]),
  };
  assert.equal(matchCounterLog(line, expected), true);
  assert.equal(matchCounterLog("ReplayCounterMismatch", expected), false);
  assert.equal(
    matchCounterLog(line, {
      ...expected,
      identifiers: [`00${"de".repeat(32)}`],
    }),
    false,
  );
  assert.throws(() =>
    matchCounterLog(
      line.replace("ReplayCounterMismatch", "VerifierKeyAlreadyPresent"),
      expected,
    ),
  );
  assert.throws(() =>
    matchCounterLog(line, { ...expected, address: "ef".repeat(32) }),
  );
  assert.throws(() =>
    matchCounterLog(line, {
      ...expected,
      segments: new Map([
        [0, "SegmentFail"],
        [1, "SegmentSuccess"],
        [2, "SegmentSuccess"],
      ]),
    }),
  );
});
