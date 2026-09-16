import assert from "node:assert/strict";

const transactionId = (value) => {
  assert.equal(
    typeof value,
    "string",
    "Expected a public transaction identifier",
  );
  assert.match(
    value,
    /^[0-9a-f]{66}$/,
    "Malformed public transaction identifier",
  );
  return value;
};

export function captureSubmissions(wallet, emit, currentStage) {
  const original = wallet.submitTransaction;
  const submit = original.bind(wallet);
  const wrapped = async (tx) => {
    const stage = currentStage();
    const identifiers = tx.identifiers().map(transactionId);
    assert(
      identifiers.length > 0 && identifiers.length <= 256,
      "Expected bounded public identifiers",
    );
    const transactionBytes = tx.serialize().byteLength;
    assert(Number.isSafeInteger(transactionBytes) && transactionBytes > 0);
    // Persist identifiers before sending: a rejected response does not prove rejection.
    emit("submission-attempt", { stage, identifiers, transactionBytes });
    const txId = transactionId(await submit(tx));
    assert(
      identifiers.includes(txId),
      "Submitted identifier differs from transaction",
    );
    emit("submission-returned", { stage, identifiers, txId });
    return txId;
  };
  wallet.submitTransaction = wrapped;
  return () => {
    if (wallet.submitTransaction === wrapped)
      wallet.submitTransaction = original;
  };
}
