import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  installNativeSignalCleanup,
  ownNativeProcess,
  stopNativeProcess,
} from "./native-processes";
import {
  poll,
  unusedPort,
  verifyNativeServices,
} from "./native-services-health";

const options = process.argv.slice(2);
const FLAGS = [
  "--with-services",
  "--transactions",
  "--staged-bootstrap",
  "--maintenance-audit",
  "--maintenance-controls",
  "--recovery-audit",
  "--circuit-sweep",
];
const has = (flag: string) => options.includes(flag);
const requires = (flag: string, ...deps: string[]) =>
  !has(flag) || deps.every(has);

assert(
  options.every((option) => FLAGS.includes(option)),
  "Unsupported native diagnostic option",
);
assert(
  requires("--transactions", "--with-services"),
  "--transactions requires --with-services",
);
assert(
  requires("--staged-bootstrap", "--transactions"),
  "--staged-bootstrap requires --transactions",
);
const removeSignalHandlers = installNativeSignalCleanup();
assert(
  !has("--recovery-audit") ||
    (has("--staged-bootstrap") && !has("--maintenance-audit")),
  "--recovery-audit requires a separate --staged-bootstrap run",
);
assert(
  requires("--maintenance-controls", "--maintenance-audit"),
  "--maintenance-controls requires --maintenance-audit",
);
assert(
  requires("--maintenance-audit", "--staged-bootstrap"),
  "--maintenance-audit requires --staged-bootstrap",
);
assert(
  !has("--circuit-sweep") ||
    (has("--transactions") &&
      !has("--staged-bootstrap") &&
      !has("--maintenance-audit") &&
      !has("--maintenance-controls") &&
      !has("--recovery-audit")),
  "--circuit-sweep runs its own scenarios and needs only --transactions",
);
await import("./setup-native-node");

const rpc = async (
  port: number,
  method: string,
  params: unknown[],
  timeout: number,
) => {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  assert(response.ok);
  return (await response.json()).result;
};

await mkdir(".hoplite/artifacts/native-node", { recursive: true });
const directory = await mkdtemp(".hoplite/artifacts/native-node/run-");
await cp(".tools/native-midnight/node/res", `${directory}/res`, {
  recursive: true,
});
const presetPath = `${directory}/res/cfg/dev.toml`;
const preset = await Bun.file(presetPath).text();
const argumentBlock = /^args\s*=\s*\[[\s\S]*?\]/gm;
assert.equal([...preset.matchAll(argumentBlock)].length, 1);
await Bun.write(presetPath, preset.replace(argumentBlock, "args = []"));
const port = await unusedPort();
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
  const hash = await poll(
    120_000,
    async () => {
      const result = await rpc(port, "chain_getBlockHash", [1], 2000);
      return typeof result === "string" && /^0x[0-9a-f]{64}$/.test(result)
        ? result
        : null;
    },
    () => node.exitCode === null,
    true,
  );
  assert(
    typeof hash === "string",
    `No block 1; inspect private logs under ${directory}`,
  );
  assert.equal(
    node.exitCode,
    null,
    "The launched node exited during observation",
  );
  const services = has("--with-services")
    ? await verifyNativeServices(
        directory,
        port,
        hash,
        has("--transactions")
          ? async (endpoints) => {
              const genesis = await rpc(port, "chain_getBlockHash", [0], 5000);
              assert.match(genesis, /^0x[0-9a-f]{64}$/);
              const { integrationNode } = await import(
                "./setup-integration-runtime"
              );
              const driver = ownNativeProcess(
                Bun.spawn(
                  [
                    integrationNode,
                    has("--circuit-sweep")
                      ? "packages/integration/src/local-circuit-sweep.mjs"
                      : "packages/integration/src/local.mjs",
                  ],
                  {
                    env: {
                      PATH: process.env.PATH,
                      HOME: resolve(directory),
                      MILO_LOCAL_ALLOW_TRANSACTIONS: "disposable-owned-local",
                      MILO_LOCAL_NETWORK_ID: "undeployed",
                      MILO_LOCAL_GENESIS_HASH: genesis,
                      MILO_SWEEP_RUN_DIR: resolve(`${directory}/sweep`),
                      MILO_SWEEP_TRAIL: resolve(
                        `${directory}/sweep-trail.jsonl`,
                      ),
                      ...(process.env.MILO_SWEEP_ONLY
                        ? { MILO_SWEEP_ONLY: process.env.MILO_SWEEP_ONLY }
                        : {}),
                      MILO_LOCAL_RECOVERY_AUDIT: has("--recovery-audit")
                        ? "process-restart"
                        : "off",
                      MILO_LOCAL_NODE_HTTP: `http://127.0.0.1:${port}`,
                      MILO_LOCAL_NODE_WS: endpoints.MILO_NODE_URL,
                      MILO_LOCAL_INDEXER_HTTP: endpoints.MILO_INDEXER_HTTP_URL,
                      MILO_LOCAL_INDEXER_WS: endpoints.MILO_INDEXER_WS_URL,
                      MILO_LOCAL_PROOF_HTTP: endpoints.MILO_PROOF_URL,
                      MILO_LOCAL_TIMEOUT_MS: has("--circuit-sweep")
                        ? "1800000"
                        : "600000",
                      MILO_LOCAL_MAINTENANCE_AUDIT: has(
                        "--maintenance-controls",
                      )
                        ? "controls"
                        : has("--maintenance-audit")
                          ? "retained-key"
                          : "off",
                      MILO_LOCAL_BOOTSTRAP_MODE: has("--staged-bootstrap")
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
        transactionDiagnostic: has("--transactions")
          ? {
              bootstrapMode: has("--staged-bootstrap") ? "staged" : "full",
              driverExitCode: 0,
              maintenanceAudit: has("--maintenance-audit"),
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
      ? has("--transactions")
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
