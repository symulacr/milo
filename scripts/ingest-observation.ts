import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ObservedDeployment,
  REQUIRED_ENTRYPOINTS,
  validDeploymentObservation,
} from "../packages/backend/src/admission-policy";

export const DEPLOYMENT_FN = "observationIngest:recordDeployment";
export const CHAIN_FN = "orders:recordObservation";

export type IngestPlan =
  | {
      kind: "deployment";
      fn: typeof DEPLOYMENT_FN;
      args: ObservedDeployment;
      orderId?: undefined;
    }
  | {
      kind: "chain";
      fn: typeof CHAIN_FN;
      args: Record<string, unknown>;
      orderId: string;
    };

function fail(message: string): never {
  throw new Error(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function requireObject(value: unknown, label: string) {
  if (!isPlainObject(value))
    fail(`${label} ingest document must be a plain object`);
  return value;
}

export function planDeploymentIngest(document: unknown): IngestPlan {
  const record = requireObject(
    document,
    "deployment",
  ) as unknown as ObservedDeployment;
  if (!validDeploymentObservation(record))
    fail("contradictory deployment observation: record is malformed");
  return { kind: "deployment", fn: DEPLOYMENT_FN, args: record };
}

export function buildRecordObservationPayload(
  document: unknown,
  orderId: string,
): Record<string, unknown> {
  const source = requireObject(document, "chain");
  if (typeof orderId !== "string" || orderId.length === 0)
    fail("chain ingest requires a non-empty order id");
  const order = source.orderId;
  if (order !== undefined && order !== orderId)
    fail("chain ingest document orderId does not match --order-id");
  const phase = source.phase;
  const revision = source.revision;
  if (typeof phase !== "string" || phase.length === 0)
    fail("chain ingest document requires a phase");
  if (typeof revision !== "number" || !Number.isSafeInteger(revision))
    fail("chain ingest document requires an integer revision");
  return {
    orderId,
    address: source.address,
    nonce: source.nonce,
    artifactFingerprint: source.artifactFingerprint,
    phase,
    revision,
    deliveryManifest: source.deliveryManifest ?? null,
  };
}

export function planChainIngest(
  document: unknown,
  orderId: string,
): IngestPlan {
  const args = buildRecordObservationPayload(document, orderId);
  return { kind: "chain", fn: CHAIN_FN, args, orderId };
}

export function ingestArgv(plan: IngestPlan, convexCli: string): string[] {
  return [convexCli, "run", plan.fn, JSON.stringify(plan.args)];
}

export type IngestRunner = (argv: string[]) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export async function executeIngest(
  plan: IngestPlan,
  runner: IngestRunner,
  convexCli: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runner(ingestArgv(plan, convexCli));
}

function defaultConvexCli(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return join(root, "node_modules", "convex", "bin", "main.js");
}

export function defaultRunner(): IngestRunner {
  return (argv) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, argv, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
}

type Args = {
  deploymentPath?: string;
  chainPath?: string;
  orderId?: string;
  dryRun: boolean;
};

type ValueFlag = "deploymentPath" | "chainPath" | "orderId";

const VALUE_FLAGS: Record<string, ValueFlag> = {
  "--deployment": "deploymentPath",
  "--chain": "chainPath",
  "--order-id": "orderId",
};

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg in VALUE_FLAGS) out[VALUE_FLAGS[arg]] = argv[++i];
    else fail(`unknown argument: ${arg}`);
  }
  return out;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.deploymentPath && args.chainPath)
    fail("pass either --deployment or --chain, not both");
  if (!args.deploymentPath && !args.chainPath)
    fail("pass --deployment <file> or --chain <file> --order-id <id>");
  const plan = args.deploymentPath
    ? planDeploymentIngest(readJson(args.deploymentPath))
    : planChainIngest(readJson(args.chainPath ?? ""), args.orderId ?? "");
  if (args.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ kind: plan.kind, fn: plan.fn, orderId: plan.orderId ?? null })}\n`,
    );
    process.exit(0);
  }
  const result = await executeIngest(plan, defaultRunner(), defaultConvexCli());
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}

export const REQUIRED_ENTRYPOINT_NAMES = REQUIRED_ENTRYPOINTS;
