/**
 * RECONSTRUCTED (P8-W1-C) — executable observation ingest CLI.
 *
 *   bun scripts/ingest-observation.ts --deployment obs.json
 *   bun scripts/ingest-observation.ts --chain chain.json --order-id order_1
 *   bun scripts/ingest-observation.ts --deployment obs.json --dry-run
 *
 * - deployment → `observationIngest:recordDeployment`
 * - chain      → `orders:recordObservation` via the handoff payload builder
 *
 * Executes via `spawn(process.execPath, [convexCli, "run", fn, json])` — a real
 * argv, not a shell string. `--dry-run` prints the plan and exits 0 so CI can
 * assert routing without a Convex deployment.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_ENTRYPOINTS,
  validDeploymentObservation,
  type ObservedDeployment,
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

/**
 * Validate a deployment document before any invocation. Contradictory shapes
 * are rejected here so a bad file never reaches Convex.
 */
export function planDeploymentIngest(document: unknown): IngestPlan {
  if (!isPlainObject(document)) {
    fail("deployment ingest document must be a plain object");
  }
  const record = document as unknown as ObservedDeployment;
  if (!validDeploymentObservation(record)) {
    fail("contradictory deployment observation: record is malformed");
  }
  return { kind: "deployment", fn: DEPLOYMENT_FN, args: record };
}

/**
 * Chain handoff payload builder. Refuses to invent an order id: the caller
 * must pass `--order-id` and the document must agree.
 */
export function buildRecordObservationPayload(
  document: unknown,
  orderId: string,
): Record<string, unknown> {
  if (!isPlainObject(document)) {
    fail("chain ingest document must be a plain object");
  }
  if (typeof orderId !== "string" || orderId.length === 0) {
    fail("chain ingest requires a non-empty order id");
  }
  const order = document.orderId;
  if (order !== undefined && order !== orderId) {
    fail("chain ingest document orderId does not match --order-id");
  }
  const phase = document.phase;
  const revision = document.revision;
  if (typeof phase !== "string" || phase.length === 0) {
    fail("chain ingest document requires a phase");
  }
  if (typeof revision !== "number" || !Number.isSafeInteger(revision)) {
    fail("chain ingest document requires an integer revision");
  }
  return {
    orderId,
    address: document.address,
    nonce: document.nonce,
    artifactFingerprint: document.artifactFingerprint,
    phase,
    revision,
    deliveryManifest: document.deliveryManifest ?? null,
  };
}

export function planChainIngest(document: unknown, orderId: string): IngestPlan {
  const args = buildRecordObservationPayload(document, orderId);
  return { kind: "chain", fn: CHAIN_FN, args, orderId };
}

/**
 * Real spawn argv: convex CLI path + `run` + function + JSON-encoded args.
 * JSON encoding keeps special characters intact; this is never a shell string.
 */
export function ingestArgv(
  plan: IngestPlan,
  convexCli: string,
): string[] {
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
      const child = spawn(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"] });
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

function parseArgs(argv: string[]): {
  deploymentPath?: string;
  chainPath?: string;
  orderId?: string;
  dryRun: boolean;
} {
  const out: {
    deploymentPath?: string;
    chainPath?: string;
    orderId?: string;
    dryRun: boolean;
  } = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--deployment") out.deploymentPath = argv[++i];
    else if (arg === "--chain") out.chainPath = argv[++i];
    else if (arg === "--order-id") out.orderId = argv[++i];
    else if (arg === "--dry-run") out.dryRun = true;
    else fail(`unknown argument: ${arg}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.deploymentPath && args.chainPath) {
    fail("pass either --deployment or --chain, not both");
  }
  if (!args.deploymentPath && !args.chainPath) {
    fail("pass --deployment <file> or --chain <file> --order-id <id>");
  }
  let plan: IngestPlan;
  if (args.deploymentPath) {
    const document = JSON.parse(readFileSync(args.deploymentPath, "utf8"));
    plan = planDeploymentIngest(document);
  } else {
    const document = JSON.parse(readFileSync(args.chainPath as string, "utf8"));
    plan = planChainIngest(document, args.orderId ?? "");
  }
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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

export const REQUIRED_ENTRYPOINT_NAMES = REQUIRED_ENTRYPOINTS;
