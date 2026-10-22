/** The one lowercase 64-hex (32-byte) digest/address guard for this package. */
export const HEX64 = /^[a-f0-9]{64}$/;

/** One loopback guard: an endpoint must be an explicit local address. */
export function isLoopbackHostname(hostname) {
  return ["127.0.0.1", "[::1]"].includes(hostname);
}

export function localConfig(env) {
  if (env.MILO_LOCAL_ALLOW_TRANSACTIONS !== "disposable-owned-local") {
    throw new Error("Explicit disposable local-network authorization required");
  }
  const endpoint = (key, protocol) => {
    const url = new URL(env[key]);
    if (
      url.protocol !== protocol ||
      !isLoopbackHostname(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(`Invalid loopback endpoint: ${key}`);
    return url.href;
  };
  if (env.MILO_LOCAL_NETWORK_ID !== "undeployed") {
    throw new Error("Only the disposable undeployed network is supported");
  }
  if (!/^0x[0-9a-f]{64}$/.test(env.MILO_LOCAL_GENESIS_HASH ?? "")) {
    throw new Error("An independently observed local genesis hash is required");
  }
  const timeoutMs = Number(env.MILO_LOCAL_TIMEOUT_MS ?? 900_000);
  const bootstrapMode = env.MILO_LOCAL_BOOTSTRAP_MODE ?? "full";
  if (!["full", "staged"].includes(bootstrapMode)) {
    throw new Error("Unsupported local bootstrap mode");
  }
  const maintenanceAudit = env.MILO_LOCAL_MAINTENANCE_AUDIT ?? "off";
  const recoveryAudit = env.MILO_LOCAL_RECOVERY_AUDIT ?? "off";
  if (
    !["off", "process-restart"].includes(recoveryAudit) ||
    (recoveryAudit !== "off" &&
      (bootstrapMode !== "staged" || maintenanceAudit !== "off"))
  ) {
    throw new Error("Recovery audit requires a separate staged bootstrap run");
  }
  if (
    !["off", "retained-key", "controls"].includes(maintenanceAudit) ||
    (maintenanceAudit !== "off" && bootstrapMode !== "staged")
  ) {
    throw new Error(
      "Maintenance audit requires explicit staged bootstrap mode",
    );
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10_000 ||
    timeoutMs > 1_800_000
  ) {
    throw new Error(
      "Local timeout must be between 10000 and 1800000 milliseconds",
    );
  }
  return {
    networkId: "undeployed",
    // Load-bearing despite having no in-repo consumer: removing these two
    // fields makes the real local lane fail deterministically in wallet sync
    // with a mn_addr_undefined HRP (V5 wave 4 regression, bisected and
    // reverted). Do not delete them without a real-lane run proving the lane
    // still passes.
    walletNetworkId: "undeployed",
    faucet: undefined,
    node: endpoint("MILO_LOCAL_NODE_HTTP", "http:"),
    nodeWS: endpoint("MILO_LOCAL_NODE_WS", "ws:"),
    indexer: endpoint("MILO_LOCAL_INDEXER_HTTP", "http:"),
    indexerWS: endpoint("MILO_LOCAL_INDEXER_WS", "ws:"),
    proofServer: endpoint("MILO_LOCAL_PROOF_HTTP", "http:"),
    genesisHash: env.MILO_LOCAL_GENESIS_HASH,
    timeoutMs,
    bootstrapMode,
    maintenanceAudit: maintenanceAudit !== "off",
    maintenanceControls: maintenanceAudit === "controls",
    recoveryAudit: recoveryAudit === "process-restart",
  };
}

export function publicReceipt(data) {
  // The non-blocking submitters return a bare transaction id rather than the SDK's finality
  // receipt: `submitTxAsync` is typed `Promise<string>`, and our socket/HTTP submitter returns
  // the node's extrinsic hash. A string therefore means "the node accepted the transaction;
  // finality is not yet observed". It is NOT a claim of success: for those paths the real
  // confirmation comes from observed ledger state (inspectContractState, queryContractState),
  // and the receipt records that separately.
  //
  // This used to require the `0x` prefix, which only the extrinsic-hash submitter produces.
  // `submitTxAsync` returns an unprefixed transaction id, so every staged deploy fell through
  // to the status check below, read `undefined`, and reported a submitted transaction as a
  // failure. Accept any non-empty string: the shape is the submitter's choice, not ours.
  if (typeof data === "string" && data.length > 0)
    return {
      txId: data,
      txHash: null,
      blockHash: null,
      blockHeight: null,
      status: "Submitted",
    };
  if (!data || data.status !== "SucceedEntirely")
    // Carry the status and the identifiers into the message. Throwing a bare "did not
    // succeed entirely" discards the only fields that say WHICH transaction the node
    // refused, which turns every rejection into an unexplained failure that has to be
    // re-run to investigate. FinalizedTxData carries no reason field: the status is the
    // whole diagnosis (`FailEntirely` is a rejected transaction, `FailFallible` is a
    // failed fallible segment), so name it.
    throw new Error(
      `Transaction did not succeed entirely: status=${data?.status}` +
        (data?.txId ? ` txId=${data.txId}` : "") +
        (Array.isArray(data?.identifiers) && data.identifiers.length > 0
          ? ` identifiers=${data.identifiers.join(",")}`
          : "") +
        (data ? "" : ` payload=${typeof data}`),
    );
  return {
    txId: data.txId,
    txHash: data.txHash,
    blockHash: data.blockHash,
    blockHeight: data.blockHeight,
    status: data.status,
  };
}
