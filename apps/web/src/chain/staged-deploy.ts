import type { SigningKey } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type { ContractState } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ChainError } from "./errors.ts";
import {
  INITIAL_VERIFIER_CIRCUITS,
  ORDER_CIRCUITS,
  type OrderCircuitName,
  toHex,
} from "./order.ts";

type VerifierKey = Uint8Array;

export type VerifierKeySet = ReadonlyMap<OrderCircuitName, VerifierKey>;

export const STAGED_DEPLOY_STEPS = {
  deploy: 1,
  verifiers: 2,
  total: 2,
} as const;

export type StagedDeployProgress =
  | {
      readonly stage: "deploy" | "verifiers";
      readonly done: number;
      readonly total: number;
      readonly txId?: string;
    }
  | {
      readonly stage: "confirm";
      readonly done: number;
      readonly total: number;
    };

export type StagedDeployRecord = {
  readonly contractAddress: string;
  readonly signingKey: SigningKey;
  readonly configuration: string;
  readonly deployedTxId: string | null;
  readonly installedCircuits: readonly OrderCircuitName[];
  readonly updatedAt: string;
};

export type StagedDeployLedger = {
  readonly deploy: (input: {
    readonly circuits: readonly OrderCircuitName[];
    readonly keys: VerifierKeySet;
    readonly signingKey: SigningKey;
  }) => Promise<{ readonly address: string; readonly txId: string }>;
  readonly maintenance: (input: {
    readonly address: string;
    readonly counter: bigint;
    readonly circuits: readonly OrderCircuitName[];
    readonly keys: VerifierKeySet;
    readonly signingKey: SigningKey;
    readonly lock: boolean;
  }) => Promise<{ readonly txId: string }>;
  readonly observe: (
    address: string,
  ) => Promise<{ readonly state: ContractState } | null>;
};

export function assertVerifierKeySet(keys: VerifierKeySet): VerifierKeySet {
  for (const circuit of ORDER_CIRCUITS) {
    const key = keys.get(circuit);
    if (!key || key.length === 0)
      throw new ChainError(
        "ZK_ARTIFACT_UNAVAILABLE",
        `The verifier key for "${circuit}" is missing from /zk. Rebuild the app so the contract artifacts are served.`,
      );
  }
  return keys;
}

export function installedCircuitsOf(
  operations: readonly (string | Uint8Array)[],
): OrderCircuitName[] {
  const names = operations.map((name) =>
    typeof name === "string"
      ? name
      : new TextDecoder("utf-8", { fatal: true }).decode(name),
  );
  return ORDER_CIRCUITS.filter((circuit) => names.includes(circuit));
}

export function missingCircuitsOf(
  operations: readonly (string | Uint8Array)[],
): OrderCircuitName[] {
  const installed = new Set(installedCircuitsOf(operations));
  return ORDER_CIRCUITS.filter((circuit) => !installed.has(circuit));
}

export function assertVerifierKeysMatch(
  state: ContractState,
  keys: VerifierKeySet,
  circuits: readonly OrderCircuitName[],
): void {
  for (const circuit of circuits) {
    const operation = state.operation(circuit);
    if (!operation)
      throw new ChainError(
        "CONTRACT_REJECTED",
        `The contract does not expose "${circuit}" after the staged deploy.`,
      );
    const installed = toHex(operation.verifierKey);
    const expected = toHex(keys.get(circuit) as VerifierKey);
    if (installed !== expected)
      throw new ChainError(
        "CONTRACT_REJECTED",
        `The verifier key installed for "${circuit}" does not match the compiled artifact.`,
      );
  }
}

export function assertAllCircuitsInstalled(
  state: ContractState,
  keys: VerifierKeySet,
): void {
  const missing = missingCircuitsOf(state.operations());
  if (missing.length > 0)
    throw new ChainError(
      "CONTRACT_REJECTED",
      `The staged deploy is incomplete: ${missing.length} of ${ORDER_CIRCUITS.length} circuits are still missing (${missing.join(", ")}).`,
    );
  assertVerifierKeysMatch(state, keys, ORDER_CIRCUITS);
}

function isAuthorityLocked(state: ContractState): boolean {
  const authority = state?.maintenanceAuthority;
  return (
    authority?.threshold === 1 &&
    Array.isArray(authority.committee) &&
    authority.committee.length === 0
  );
}

function assertAuthorityLocked(state: ContractState): void {
  if (!isAuthorityLocked(state))
    throw new ChainError(
      "CONTRACT_REJECTED",
      "The contract maintenance authority is not locked.",
    );
}

export function nextMaintenanceCounter(state: ContractState): bigint {
  const authority = state?.maintenanceAuthority;
  const counter = authority?.counter;
  if (typeof counter !== "bigint" || counter < 0n)
    throw new ChainError(
      "CONTRACT_REJECTED",
      "The observed contract state reports no maintenance counter, so the verifier-key update cannot be authorised.",
    );
  return counter;
}

type StagedDeployInput = {
  readonly ledger: StagedDeployLedger;
  readonly keys: VerifierKeySet;
  readonly signingKey: SigningKey;
  readonly configuration: string;
  readonly resume: StagedDeployRecord | null;
  readonly record: (record: StagedDeployRecord) => void;
  readonly onProgress?: (progress: StagedDeployProgress) => void;
  readonly observeAttempts?: number;
  readonly observeRetryMs?: number;
  readonly wait?: (ms: number) => Promise<void>;
};

type StagedDeployResult = {
  readonly contractAddress: string;
  readonly txId: string;
  readonly installedCircuits: readonly OrderCircuitName[];
};

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runStagedDeploy(
  input: StagedDeployInput,
): Promise<StagedDeployResult> {
  const keys = assertVerifierKeySet(input.keys);
  const attempts = input.observeAttempts ?? 30;
  const retryMs = input.observeRetryMs ?? 2_000;
  const wait = input.wait ?? defaultWait;
  const emit = input.onProgress ?? (() => {});
  const total = ORDER_CIRCUITS.length;

  const observeState = async (address: string): Promise<ContractState> => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const observed = await input.ledger.observe(address);
      if (observed) return observed.state;
      if (attempt < attempts) await wait(retryMs);
    }
    throw new ChainError(
      "TX_FAILED",
      `No contract state was observed at ${address} after ${attempts} attempts. The deploy may still be landing; retry to resume.`,
    );
  };

  let address: string;
  let deployedTxId: string | null;
  let installed: readonly OrderCircuitName[];
  let state: ContractState;

  if (input.resume) {
    address = input.resume.contractAddress;
    deployedTxId = input.resume.deployedTxId;
    emit({
      stage: "deploy",
      done: 1,
      total: STAGED_DEPLOY_STEPS.total,
      ...(deployedTxId ? { txId: deployedTxId } : {}),
    });
    state = await observeState(address);
    installed = installedCircuitsOf(state.operations());
    // Re-record what the chain actually reports, so a resumed run does not leave
    // the persisted progress showing the pre-resume state forever.
    input.record({
      contractAddress: address,
      signingKey: input.signingKey,
      configuration: input.configuration,
      deployedTxId,
      installedCircuits: [...installed],
      updatedAt: new Date().toISOString(),
    });
  } else {
    emit({ stage: "deploy", done: 0, total: STAGED_DEPLOY_STEPS.total });
    const deployed = await input.ledger.deploy({
      circuits: INITIAL_VERIFIER_CIRCUITS,
      keys,
      signingKey: input.signingKey,
    });
    address = deployed.address;
    deployedTxId = deployed.txId;
    input.record({
      contractAddress: address,
      signingKey: input.signingKey,
      configuration: input.configuration,
      deployedTxId,
      installedCircuits: [...INITIAL_VERIFIER_CIRCUITS],
      updatedAt: new Date().toISOString(),
    });
    emit({
      stage: "deploy",
      done: 1,
      total: STAGED_DEPLOY_STEPS.total,
      txId: deployed.txId,
    });
    state = await observeState(address);
    installed = installedCircuitsOf(state.operations());
    assertVerifierKeysMatch(state, keys, INITIAL_VERIFIER_CIRCUITS);
  }

  let lastTxId = deployedTxId ?? "";
  const pending = ORDER_CIRCUITS.filter(
    (circuit) => !installed.includes(circuit),
  );
  const lockAuthority = !isAuthorityLocked(state);

  if (pending.length > 0 || lockAuthority) {
    const counter = nextMaintenanceCounter(state);
    emit({ stage: "verifiers", done: installed.length, total });
    const update = await input.ledger.maintenance({
      address,
      counter,
      circuits: pending,
      keys,
      signingKey: input.signingKey,
      lock: lockAuthority,
    });
    lastTxId = update.txId;
    emit({
      stage: "verifiers",
      done: total,
      total,
      txId: update.txId,
    });

    for (let attempt = 1; ; attempt += 1) {
      state = await observeState(address);
      const seen = installedCircuitsOf(state.operations());
      const stillMissing = pending.filter((circuit) => !seen.includes(circuit));
      const stillUnlocked = lockAuthority && !isAuthorityLocked(state);
      if (stillMissing.length === 0 && !stillUnlocked) break;
      if (attempt >= attempts)
        throw new ChainError(
          "TX_FAILED",
          stillMissing.length > 0
            ? `The verifier-key update was submitted but the indexer still reports ${stillMissing.length} circuits missing (${stillMissing.join(", ")}). Retry to resume.`
            : "The authority lock was submitted but the indexer still reports an active maintenance committee. Retry to resume.",
        );
      await wait(retryMs);
    }
    // Only now does the chain agree, so only now may the record claim completion.
    // Writing the target list before this point made readDeployStatus report
    // "complete" for an update that never landed, which skipped the resume.
    input.record({
      contractAddress: address,
      signingKey: input.signingKey,
      configuration: input.configuration,
      deployedTxId,
      installedCircuits: [...ORDER_CIRCUITS],
      updatedAt: new Date().toISOString(),
    });
  }

  emit({ stage: "confirm", done: total, total });
  assertAllCircuitsInstalled(state, keys);
  assertAuthorityLocked(state);

  return {
    contractAddress: address,
    txId: lastTxId,
    installedCircuits: ORDER_CIRCUITS,
  };
}
