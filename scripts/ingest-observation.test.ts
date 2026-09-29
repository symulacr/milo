/**
 * RECONSTRUCTED (P8-W1-C) — plan/dispatch/execute tests for the ingest CLI.
 * No live Convex: planners and the injected runner only.
 */
import { describe, expect, test } from "bun:test";
import { REQUIRED_ENTRYPOINTS } from "../packages/backend/src/admission-policy";
import {
  buildRecordObservationPayload,
  CHAIN_FN,
  DEPLOYMENT_FN,
  executeIngest,
  type IngestPlan,
  ingestArgv,
  planChainIngest,
  planDeploymentIngest,
} from "./ingest-observation";

const hash = "a".repeat(64);

function deploymentDocument(overrides: Record<string, unknown> = {}) {
  return {
    constructorVersion: 1,
    constructorEncoding: "milo:compact-configuration:v1",
    buyerCommitment: "1".repeat(64),
    merchantCommitment: "2".repeat(64),
    operatorCommitment: "3".repeat(64),
    id: "obs-cli-389537f2-b0da-4a20-a2df-91ee0f7de76a",
    quoteId: "quote-cli-5f759675-88de-4275-8da2-677c95df83e1",
    quoteVersion: 1,
    observationVersion: 2,
    source: "chain-observer",
    network: "preprod",
    nonce: "4".repeat(64),
    address: "9".repeat(64),
    phase: "DEPLOYED",
    revision: 0,
    termsCommitment: hash,
    artifactFingerprint: hash,
    keySetFingerprint: hash,
    rolesFingerprint: hash,
    initialStateFingerprint: hash,
    genesisHash: hash,
    entrypoints: [...REQUIRED_ENTRYPOINTS],
    maintenancePolicy: "locked",
    maintenanceReceiptFingerprint: hash,
    blockHash: hash,
    blockHeight: 2636672,
    stateFingerprint: hash,
    observedAt: Date.now(),
    acceptanceDeadlineSeconds: 151,
    deliveryDeadlineSeconds: 152,
    reviewDeadlineSeconds: 153,
    resolutionDeadlineSeconds: 154,
    ...overrides,
  };
}

const chainDocument = {
  orderId: "order_1",
  address: "1".repeat(64),
  nonce: "4".repeat(64),
  artifactFingerprint: hash,
  phase: "RESERVED",
  revision: 1,
};

describe("scripts/ingest-observation — real Convex ingest path", () => {
  test("deployment plan routes to observationIngest:recordDeployment", () => {
    const plan = planDeploymentIngest(deploymentDocument());
    expect(plan.kind).toBe("deployment");
    expect(plan.fn).toBe(DEPLOYMENT_FN);
    expect(plan.fn).toBe("observationIngest:recordDeployment");
  });

  test("chain plan routes to orders:recordObservation via the handoff builder", () => {
    const plan = planChainIngest(chainDocument, "order_1");
    expect(plan.kind).toBe("chain");
    expect(plan.fn).toBe(CHAIN_FN);
    expect(plan.fn).toBe("orders:recordObservation");
    expect(plan.orderId).toBe("order_1");
  });

  test("ingestArgv is a real spawn argv, not a shell command string", () => {
    const plan = planDeploymentIngest(deploymentDocument());
    const argv = ingestArgv(plan, "/path/to/convex");
    expect(argv).toHaveLength(4);
    expect(argv[0]).toBe("/path/to/convex");
    expect(argv[1]).toBe("run");
    expect(argv[2]).toBe(DEPLOYMENT_FN);
    expect(argv[3]).toBe(JSON.stringify(plan.args));
    expect(argv.every((part) => typeof part === "string")).toBe(true);
  });

  test("executeIngest invokes the runner with the planned argv", async () => {
    const plan = planDeploymentIngest(deploymentDocument());
    const seen: string[][] = [];
    const result = await executeIngest(
      plan,
      async (argv) => {
        seen.push(argv);
        return { exitCode: 0, stdout: '{"kind":"recorded"}', stderr: "" };
      },
      "/path/to/convex",
    );
    expect(result.exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0][2]).toBe(DEPLOYMENT_FN);
  });

  test("rejects a contradictory deployment document before any invocation", () => {
    expect(() =>
      planDeploymentIngest(deploymentDocument({ entrypoints: [] })),
    ).toThrow("contradictory deployment observation");
    expect(() => planDeploymentIngest([])).toThrow(
      "deployment ingest document must be a plain object",
    );
    expect(() => planDeploymentIngest(null)).toThrow(
      "deployment ingest document must be a plain object",
    );
  });

  test("chain plan refuses to invent an order id", () => {
    expect(() => planChainIngest(chainDocument, "")).toThrow(
      "chain ingest requires a non-empty order id",
    );
    expect(() => planChainIngest(chainDocument, "order_other")).toThrow(
      "chain ingest document orderId does not match --order-id",
    );
    expect(() =>
      planChainIngest({ ...chainDocument, orderId: undefined }, "order_1"),
    ).not.toThrow();
  });

  test("planDeploymentIngest rejects arrays and non-objects", () => {
    for (const bad of [[], "str", 1, true]) {
      expect(() => planDeploymentIngest(bad)).toThrow(
        "deployment ingest document must be a plain object",
      );
    }
  });

  test("planChainIngest rejects null and arrays before any builder call", () => {
    expect(() => planChainIngest(null, "order_1")).toThrow(
      "chain ingest document must be a plain object",
    );
    expect(() => planChainIngest([], "order_1")).toThrow(
      "chain ingest document must be a plain object",
    );
  });

  test("planChainIngest rejects a non-string order id", () => {
    expect(() =>
      planChainIngest(chainDocument, 1 as unknown as string),
    ).toThrow("chain ingest requires a non-empty order id");
    expect(() =>
      planChainIngest(chainDocument, undefined as unknown as string),
    ).toThrow("chain ingest requires a non-empty order id");
  });

  test("ingestArgv JSON-encodes the args so special characters survive", () => {
    const plan: IngestPlan = planDeploymentIngest(
      deploymentDocument({ quoteId: 'quote "quoted" \\ path' }),
    );
    const argv = ingestArgv(plan, "convex");
    const encoded = argv[3];
    expect(encoded).toBe(JSON.stringify(plan.args));
    expect(JSON.parse(encoded).quoteId).toBe('quote "quoted" \\ path');
  });

  test("buildRecordObservationPayload keeps the handoff shape", () => {
    const payload = buildRecordObservationPayload(chainDocument, "order_1");
    expect(payload).toMatchObject({
      orderId: "order_1",
      phase: "RESERVED",
      revision: 1,
      deliveryManifest: null,
    });
  });
});
