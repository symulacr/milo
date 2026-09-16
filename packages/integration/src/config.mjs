export function localConfig(env) {
  if (env.MILO_LOCAL_ALLOW_TRANSACTIONS !== "disposable-owned-local") {
    throw new Error("Explicit disposable local-network authorization required");
  }
  const endpoint = (key, protocol) => {
    const url = new URL(env[key]);
    if (
      url.protocol !== protocol ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
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
  if (data.status !== "SucceedEntirely")
    throw new Error("Transaction did not succeed entirely");
  return {
    txId: data.txId,
    txHash: data.txHash,
    blockHash: data.blockHash,
    blockHeight: data.blockHeight,
    status: data.status,
  };
}
