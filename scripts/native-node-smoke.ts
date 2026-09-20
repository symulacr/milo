import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  installNativeSignalCleanup,
  ownNativeProcess,
  stopNativeProcess,
} from "./native-processes";
import { verifyNativeServices } from "./native-services-health";

const options = process.argv.slice(2);
assert(
  options.every((option) =>
    [
      "--with-services",
      "--transactions",
      "--staged-bootstrap",
      "--maintenance-audit",
      "--maintenance-controls",
      "--recovery-audit",
    ].includes(option),
  ),
  "Unsupported native diagnostic option",
);
assert(
  !options.includes("--transactions") || options.includes("--with-services"),
  "--transactions requires --with-services",
);
assert(
  !options.includes("--staged-bootstrap") || options.includes("--transactions"),
  "--staged-bootstrap requires --transactions",
);
const removeSignalHandlers = installNativeSignalCleanup();
assert(
  !options.includes("--recovery-audit") ||
    (options.includes("--staged-bootstrap") &&
      !options.includes("--maintenance-audit")),
  "--recovery-audit requires a separate --staged-bootstrap run",
);
assert(
  !options.includes("--maintenance-controls") ||
    options.includes("--maintenance-audit"),
  "--maintenance-controls requires --maintenance-audit",
);
assert(
  !options.includes("--maintenance-audit") ||
    options.includes("--staged-bootstrap"),
  "--maintenance-audit requires --staged-bootstrap",
);
await import("./setup-native-node");

await mkdir(".hoplite/artifacts/native-node", { recursive: true });
const directory = await mkdtemp(".hoplite/artifacts/native-node/run-");
await cp(".tools/native-midnight/node/res", `${directory}/res`, {
  recursive: true,
});
const presetPath = `${directory}/res/cfg/dev.toml`;
const preset = await Bun.file(presetPath).text();
const argumentBlock = /^args\s*=\s*\[[\s\S]*?\]/gm;
assert.equal([...preset.matchAll(argumentBlock)].length, 1);
// Upstream's container preset exposes RPC and uses a public development peer key.
await Bun.write(presetPath, preset.replace(argumentBlock, "args = []"));
const reservation = createServer();
await new Promise<void>((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const address = reservation.address();
assert(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const node = ownNativeProcess(
  Bun.spawn(
    [
      resolve(".tools/native-midnight/node/midnight-node"),
      "--dev",
      "--base-path",
      resolve(`${directory}/data`),
      "--rpc-port",
      String(port),
      "--rpc-cors",
      "http://localhost",
      "--listen-addr",
      "/ip4/127.0.0.1/tcp/0",
      "--no-telemetry",
      "--no-prometheus",
      "--no-mdns",
    ],
    {
      cwd: resolve(directory),
      env: {
        PATH: process.env.PATH,
        HOME: resolve(directory),
        CFG_PRESET: "dev",
        SHOW_SECRETS: "false",
      },
      stdout: Bun.file(resolve(`${directory}/node.stdout.log`)),
      stderr: Bun.file(resolve(`${directory}/node.stderr.log`)),
    },
  ),
);

try {
  const deadline = Date.now() + 120_000;
  let hash: unknown;
  while (Date.now() < deadline && node.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "chain_getBlockHash",
          params: [1],
        }),
        signal: AbortSignal.timeout(2000),
      });
      const body = await response.json();
      hash = body.result;
      if (typeof hash === "string" && /^0x[0-9a-f]{64}$/.test(hash)) break;
    } catch {
      /* Startup may not yet expose RPC. */
    }
    await Bun.sleep(1000);
  }
  assert.equal(
    typeof hash,
    "string",
    `No block 1; inspect private logs under ${directory}`,
  );
  assert.match(hash as string, /^0x[0-9a-f]{64}$/);
  assert.equal(
    node.exitCode,
    null,
    "The launched node exited during observation",
  );
  const services = process.argv.includes("--with-services")
    ? await verifyNativeServices(
        directory,
        port,
        hash as string,
        process.argv.includes("--transactions")
          ? async (endpoints) => {
              const genesisResponse = await fetch(`http://127.0.0.1:${port}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "chain_getBlockHash",
                  params: [0],
                }),
                signal: AbortSignal.timeout(5000),
              });
              assert(genesisResponse.ok);
              const genesis = (await genesisResponse.json()).result;
              assert.match(genesis, /^0x[0-9a-f]{64}$/);
              const { integrationNode } = await import(
                "./setup-integration-runtime"
              );
              const driver = ownNativeProcess(
                Bun.spawn(
                  [integrationNode, "packages/integration/src/local.mjs"],
                  {
                    env: {
                      PATH: process.env.PATH,
                      HOME: resolve(directory),
                      MILO_LOCAL_ALLOW_TRANSACTIONS: "disposable-owned-local",
                      MILO_LOCAL_NETWORK_ID: "undeployed",
                      MILO_LOCAL_GENESIS_HASH: genesis,
                      MILO_LOCAL_RECOVERY_AUDIT: options.includes(
                        "--recovery-audit",
                      )
                        ? "process-restart"
                        : "off",
                      MILO_LOCAL_NODE_HTTP: `http://127.0.0.1:${port}`,
                      MILO_LOCAL_NODE_WS: endpoints.MILO_NODE_URL,
                      MILO_LOCAL_INDEXER_HTTP: endpoints.MILO_INDEXER_HTTP_URL,
                      MILO_LOCAL_INDEXER_WS: endpoints.MILO_INDEXER_WS_URL,
                      MILO_LOCAL_PROOF_HTTP: endpoints.MILO_PROOF_URL,
                      MILO_LOCAL_TIMEOUT_MS: "600000",
                      MILO_LOCAL_MAINTENANCE_AUDIT: options.includes(
                        "--maintenance-controls",
                      )
                        ? "controls"
                        : options.includes("--maintenance-audit")
                          ? "retained-key"
                          : "off",
                      MILO_LOCAL_BOOTSTRAP_MODE: options.includes(
                        "--staged-bootstrap",
                      )
                        ? "staged"
                        : "full",
                    },
                    stdout: Bun.file(
                      resolve(`${directory}/transactions.jsonl`),
                    ),
                    stderr: Bun.file(
                      resolve(`${directory}/transactions.stderr.log`),
                    ),
                  },
                ),
              );
              assert.equal(
                await driver.exited,
                0,
                `Transaction diagnostic failed; private evidence under ${directory}`,
              );
            }
          : undefined,
      )
    : undefined;
  await Bun.write(
    `${directory}/receipt.json`,
    `${JSON.stringify(
      {
        scope:
          "isolated native node block-1 observation; transaction diagnostics recorded in transactions.jsonl when requested; no order admission or R1 claim",
        node: "1.0.0",
        archiveSha256:
          "a3cb2e00ad074cbdac2f9f7c01400f449ec05f54941d415be868ccaae1e737bf",
        blockOneHash: hash,
        rpcLoopback: true,
        services,
        transactionDiagnostic: options.includes("--transactions")
          ? {
              bootstrapMode: options.includes("--staged-bootstrap")
                ? "staged"
                : "full",
              driverExitCode: 0,
              maintenanceAudit: options.includes("--maintenance-audit"),
              evidence: "transactions.jsonl",
              immutableOrderAdmission: false,
              r1Complete: false,
            }
          : null,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    services
      ? options.includes("--transactions")
        ? "Native services and requested transaction diagnostic completed; inspect scoped receipts, no admission or R1 claim."
        : "Native node/indexer block identity and prover queue readiness verified; no transaction or R1 claim."
      : "Native node produced block 1. No indexer, proof, submission or R1 claim.",
  );
} finally {
  await stopNativeProcess(node);
  removeSignalHandlers();
  await rm(`${directory}/data`, { recursive: true, force: true });
  console.log(
    `Stopped isolated node; diagnostic logs retained privately in ${directory}.`,
  );
}
