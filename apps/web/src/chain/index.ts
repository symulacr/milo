import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  ORDER_CIRCUITS,
  type OrderCircuitName,
  type OrderConfiguration,
  type OrderContractState,
  type OrderPrivateState,
  type WatchOrderOptions,
} from "./order.ts";
import { deployRecordStore } from "./private-state.ts";
import type {
  StagedDeployProgress,
  StagedDeployRecord,
} from "./staged-deploy.ts";
import { initChainWasm, initPureCircuitsWasm } from "./wasm-assets.ts";

export { ChainError, type ChainErrorCode } from "./errors.ts";
export type {
  OrderCircuitName,
  OrderConfiguration,
  OrderContractState,
  OrderPhase,
  OrderPrivateState,
  OrderTerms,
} from "./order.ts";
export { ORDER_CIRCUITS, ORDER_PHASES } from "./order.ts";
export type {
  StagedDeployProgress,
  StagedDeployRecord,
} from "./staged-deploy.ts";
export { STAGED_DEPLOY_STEPS } from "./staged-deploy.ts";

type ChainRuntime = typeof import("./runtime");

let runtime: Promise<ChainRuntime> | undefined;

function loadChainRuntime(): Promise<ChainRuntime> {
  runtime ??= initChainWasm().then(() => import("./runtime"));
  // A rejected load must not stay cached, or every later step fails with the
  // first transient error until the page is reloaded. A success stays cached.
  runtime.catch(() => {
    runtime = undefined;
  });
  return runtime;
}

/** Start the chain's expensive work without committing to a transaction: the wasm
 * instantiation and the runtime import. Call it when the user has shown intent (the
 * order page has mounted with a deployable order, or the quote form is being
 * filled) and never on the landing page. Idempotent and safe to ignore: every later
 * call joins the same promises, and a rejection is not cached. */
export function warmOrderChain(): Promise<void> {
  return loadChainRuntime().then(
    () => undefined,
    () => undefined,
  );
}

export async function orderCommitments() {
  // hashTerms and hashCapability are pure circuits: they run on the 1.4 MB onchain
  // runtime and never touch the ledger. Importing the runtime here would make the
  // quote form pay for the 10 MB ledger wasm plus the contracts SDK before it can
  // show a price. Measured: 310 ms for the generated contract alone against
  // 1.4-5.5 s for the runtime.
  const [commitments] = await Promise.all([
    import("./order.ts"),
    initPureCircuitsWasm(),
  ]);
  return {
    capability: commitments.capabilityCommitment,
    terms: commitments.termsCommitment,
  };
}

export type DeployOrderInput = {
  readonly connected: ConnectedAPI;
  readonly configuration: OrderConfiguration;
  readonly privateState: OrderPrivateState;
  readonly zkBaseUrl?: string;
  readonly privateStateScope: string;
  readonly onProgress?: (progress: StagedDeployProgress) => void;
  readonly resume?: boolean;
} & WatchOrderOptions;

export type DeployOrderResult = import("./order.ts").DeployOrderResult;

type DeployStatus =
  | { readonly state: "none" }
  | {
      readonly state: "partial" | "complete";
      readonly contractAddress: string;
      readonly installedCircuits: readonly OrderCircuitName[];
      readonly updatedAt: string;
    };

const COMPLETE = ORDER_CIRCUITS.length;

function recordStatus(record: StagedDeployRecord | null): DeployStatus {
  if (!record) return { state: "none" };
  return {
    state: record.installedCircuits.length >= COMPLETE ? "complete" : "partial",
    contractAddress: record.contractAddress,
    installedCircuits: record.installedCircuits,
    updatedAt: record.updatedAt,
  };
}

export function readDeployStatus(privateStateScope: string): DeployStatus {
  return recordStatus(
    deployRecordStore<StagedDeployRecord>(privateStateScope).read(),
  );
}

export async function deployOrder(
  input: DeployOrderInput,
): Promise<DeployOrderResult> {
  const chain = await loadChainRuntime();
  const store = deployRecordStore<StagedDeployRecord>(input.privateStateScope);
  const session = await chain.openChainSession({
    connected: input.connected,
    zkBaseUrl: input.zkBaseUrl,
    privateStateScope: input.privateStateScope,
  });
  const prior = input.resume ? store.read() : null;
  return chain.deployOrderContract({
    session,
    configuration: input.configuration,
    privateState: input.privateState,
    onProgress: input.onProgress,
    resume: prior,
    record: (record) => store.write(record),
    attempts: input.attempts,
    retryMs: input.retryMs,
    wait: input.wait,
  });
}

export type CallOrderInput = {
  readonly connected: ConnectedAPI;
  readonly contractAddress: string;
  readonly circuit: OrderCircuitName;
  readonly expectedRevision: bigint;
  readonly privateState: OrderPrivateState;
  readonly commitment?: Uint8Array;
  readonly expectedDelivery?: Uint8Array;
  readonly evidence?: Uint8Array;
  readonly approveOrder?: boolean;
  readonly zkBaseUrl?: string;
  readonly privateStateScope: string;
};

export type CallOrderResult = {
  readonly circuit: OrderCircuitName;
  readonly txId: string;
  readonly blockHeight: number;
};

export async function callOrder(
  input: CallOrderInput,
): Promise<CallOrderResult> {
  const chain = await loadChainRuntime();
  const session = await chain.openChainSession({
    connected: input.connected,
    zkBaseUrl: input.zkBaseUrl,
    privateStateScope: input.privateStateScope,
  });
  await chain.joinOrderContract({
    session,
    contractAddress: input.contractAddress,
    privateState: input.privateState,
  });
  return chain.callOrderCircuit({
    session,
    contractAddress: input.contractAddress,
    circuit: input.circuit,
    expectedRevision: input.expectedRevision,
    commitment: input.commitment,
    expectedDelivery: input.expectedDelivery,
    evidence: input.evidence,
    approveOrder: input.approveOrder,
  });
}

export type WatchOrderInput = WatchOrderOptions & {
  readonly connected: ConnectedAPI;
  readonly address: string;
  readonly onState: (state: OrderContractState) => void;
};

export function watchOrderContract(input: WatchOrderInput): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  void loadChainRuntime()
    .then((chain) => chain.watchOrderContract(input))
    .then(
      (stop) => {
        if (stopped) stop();
        else unsubscribe = stop;
      },
      () => {},
    );
  return () => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = undefined;
  };
}
