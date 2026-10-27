import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type {
  OrderCircuitName,
  OrderConfiguration,
  OrderContractState,
  OrderPrivateState,
  WatchOrderOptions,
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
export type {
  StagedDeployProgress,
  StagedDeployRecord,
} from "./staged-deploy.ts";

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
  // The ORDER is the fix, not a style choice. order.ts imports the generated
  // contract, which imports compact-runtime, whose top level calls
  // `ocrt.maxField()` — and that needs `__wbg_set_wasm` to have run. So the init is
  // awaited FIRST; a Promise.all here starts the import concurrently and throws
  // `Cannot read properties of undefined (reading 'maxField')` in the browser.
  await initPureCircuitsWasm();
  const commitments = await import("./order.ts");
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

/** Whether this browser has a deploy record for the order. The only consumer asks
 * one question — "is there anything to resume?" — so the partial/complete split is
 * not carried here. Computing it needed ORDER_CIRCUITS from order.ts, which was one
 * of the static edges that made the entry evaluate the wasm runtime eagerly. */
type DeployStatus =
  | { readonly state: "none" }
  | {
      readonly state: "recorded";
      readonly contractAddress: string;
      readonly installedCircuits: readonly OrderCircuitName[];
      readonly updatedAt: string;
    };

function recordStatus(record: StagedDeployRecord | null): DeployStatus {
  if (!record) return { state: "none" };
  return {
    state: "recorded",
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
  // A join compares all fourteen local verifier keys against the deployed
  // contract, so a single re-keyed circuit refuses every circuit on the order.
  // The call does not need it: `submitCallTx` reads the private state and the
  // public state itself. Keep the join for the errors it narrows, but let a key
  // mismatch fall through to the call, which fails only if that circuit is used.
  await chain
    .joinOrderContract({
      session,
      contractAddress: input.contractAddress,
      privateState: input.privateState,
    })
    .catch(() => undefined);
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
