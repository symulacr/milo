import assert from "node:assert/strict";
import test from "node:test";
import { localConfig, publicReceipt } from "../src/config.mjs";

const config = () => ({
  MILO_LOCAL_ALLOW_TRANSACTIONS: "disposable-owned-local",
  MILO_LOCAL_NETWORK_ID: "undeployed",
  MILO_LOCAL_GENESIS_HASH: `0x${"a".repeat(64)}`,
  MILO_LOCAL_NODE_HTTP: "http://127.0.0.1:9944/",
  MILO_LOCAL_NODE_WS: "ws://127.0.0.1:9944/",
  MILO_LOCAL_INDEXER_HTTP: "http://127.0.0.1:8088/api/v3/graphql",
  MILO_LOCAL_INDEXER_WS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
  MILO_LOCAL_PROOF_HTTP: "http://127.0.0.1:6300/",
});
test("MID-T01 harness configuration requires explicit owned loopback endpoints", () => {
  assert.equal(localConfig(config()).networkId, "undeployed");
  for (const key of Object.keys(config())) {
    const env = config();
    delete env[key];
    assert.throws(() => localConfig(env), key);
  }
  for (const value of [
    "http://preview.example/",
    "http://localhost/",
    "http://user:secret@127.0.0.1/",
    "http://127.0.0.1/?token=x",
    "https://127.0.0.1/",
  ]) {
    assert.throws(() =>
      localConfig({ ...config(), MILO_LOCAL_PROOF_HTTP: value }),
    );
  }
  assert.throws(() =>
    localConfig({ ...config(), MILO_LOCAL_NETWORK_ID: "preview" }),
  );
  for (const value of ["0", "Infinity", "1800001", "NaN"]) {
    assert.throws(() =>
      localConfig({ ...config(), MILO_LOCAL_TIMEOUT_MS: value }),
    );
  }
});
test("MID-T02 receipt projection excludes transaction/private fields and rejects partial success", () => {
  const receipt = publicReceipt({
    status: "SucceedEntirely",
    txId: "tx",
    txHash: "hash",
    blockHash: "block",
    blockHeight: 1,
    private: { secret: "must-not-escape" },
    tx: { witness: "must-not-escape" },
  });
  assert.deepEqual(Object.keys(receipt).sort(), [
    "blockHash",
    "blockHeight",
    "status",
    "txHash",
    "txId",
  ]);
  assert(!JSON.stringify(receipt).includes("must-not-escape"));
  for (const status of ["FailEntirely", "FailFallible", undefined])
    assert.throws(() => publicReceipt({ status }));
});

test("a bare transaction id from submitTxAsync is a submission, not a failure", () => {
  // `submitTxAsync` is typed `Promise<string>` and returns an UNSHIELDED transaction id with
  // no `0x` prefix. The projection used to require the `0x` prefix that only the
  // extrinsic-hash submitter produces, so every staged deploy fell through to the status
  // check, read `undefined`, and reported a submitted transaction as a failure. That is what
  // made `--deploy` fail on Preprod with "Transaction did not succeed entirely" while the
  // transaction was in fact submitted.
  const txId =
    "00f7b0fc10059bc52d4fd5db53b9fb80f0c5f77388f48cf9e65190b7ff04123e99";
  const receipt = publicReceipt(txId);
  assert.equal(receipt.status, "Submitted");
  assert.equal(receipt.txId, txId);
  assert.equal(receipt.txHash, null);
  assert.equal(receipt.blockHash, null);
  assert.equal(receipt.blockHeight, null);

  // The `0x`-prefixed extrinsic hash keeps working.
  assert.equal(publicReceipt("0xabc").status, "Submitted");

  // An empty string is not a submission, and a non-string non-receipt still fails closed.
  assert.throws(() => publicReceipt(""));
  assert.throws(() => publicReceipt(null));
  assert.throws(() => publicReceipt(undefined));
});

test("MID-T01 staged bootstrap is explicit opt-in and unknown modes fail closed", () => {
  assert.equal(localConfig(config()).bootstrapMode, "full");
  assert.equal(
    localConfig({ ...config(), MILO_LOCAL_BOOTSTRAP_MODE: "staged" })
      .bootstrapMode,
    "staged",
  );
  for (const mode of ["", "true", "partial", "production"]) {
    assert.throws(() =>
      localConfig({ ...config(), MILO_LOCAL_BOOTSTRAP_MODE: mode }),
    );
  }
});

test("MID-T01 retained-key maintenance audit requires a separate explicit staged opt-in", () => {
  assert.equal(localConfig(config()).maintenanceAudit, false);
  assert.equal(
    localConfig({
      ...config(),
      MILO_LOCAL_BOOTSTRAP_MODE: "staged",
      MILO_LOCAL_MAINTENANCE_AUDIT: "retained-key",
    }).maintenanceAudit,
    true,
  );
  assert.throws(() =>
    localConfig({ ...config(), MILO_LOCAL_MAINTENANCE_AUDIT: "retained-key" }),
  );
  assert.throws(() =>
    localConfig({
      ...config(),
      MILO_LOCAL_BOOTSTRAP_MODE: "staged",
      MILO_LOCAL_MAINTENANCE_AUDIT: "true",
    }),
  );
});

test("MID-T01 controls and process recovery are explicit, incompatible diagnostic opt-ins", () => {
  const staged = { ...config(), MILO_LOCAL_BOOTSTRAP_MODE: "staged" };
  const controls = localConfig({
    ...staged,
    MILO_LOCAL_MAINTENANCE_AUDIT: "controls",
  });
  assert.equal(controls.maintenanceAudit, true);
  assert.equal(controls.maintenanceControls, true);
  assert.equal(controls.recoveryAudit, false);
  assert.equal(
    localConfig({ ...staged, MILO_LOCAL_RECOVERY_AUDIT: "process-restart" })
      .recoveryAudit,
    true,
  );
  assert.throws(() =>
    localConfig({ ...config(), MILO_LOCAL_RECOVERY_AUDIT: "process-restart" }),
  );
  for (const audit of ["retained-key", "controls"])
    assert.throws(() =>
      localConfig({
        ...staged,
        MILO_LOCAL_MAINTENANCE_AUDIT: audit,
        MILO_LOCAL_RECOVERY_AUDIT: "process-restart",
      }),
    );
  assert.throws(() =>
    localConfig({ ...staged, MILO_LOCAL_RECOVERY_AUDIT: "true" }),
  );
});
