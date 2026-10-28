import type { ContractState as RuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import { createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  findDeployedContract,
  submitCallTx,
} from "@midnight-ntwrk/midnight-js-contracts";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import type {
  ContractAddress,
  SigningKey,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import {
  type Binding,
  ContractDeploy,
  ContractMaintenanceAuthority,
  ContractOperation,
  ContractOperationVersionedVerifierKey,
  ContractState,
  type FinalizedTransaction,
  Intent,
  MaintenanceUpdate,
  type Proof,
  ReplaceAuthority,
  type SignatureEnabled,
  type SingleUpdate,
  sampleSigningKey,
  signatureVerifyingKey,
  signData,
  Transaction,
  VerifierKeyInsert,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { createProofProvider } from "@midnight-ntwrk/midnight-js-types";
import * as Generated from "../../../../packages/contract/generated/contract/index.js";
import { ChainError, toChainError } from "./errors.ts";
import {
  assertOrderConfiguration,
  assertOrderPrivateState,
  circuitArguments,
  type DeployOrderResult,
  ORDER_CIRCUITS,
  ORDER_PHASES,
  type OrderCircuitName,
  type OrderConfiguration,
  type OrderContractState,
  type OrderPrivateState,
  orderWitnesses,
  toHex,
  type WatchOrderOptions,
} from "./order.ts";
import { browserPrivateStateProvider } from "./private-state.ts";
import {
  assembleChainProviders,
  type ChainProviders,
  encodeHex,
  readWalletConfig,
} from "./providers.ts";
import {
  assertVerifierKeySet,
  runStagedDeploy,
  type StagedDeployLedger,
  type StagedDeployProgress,
  type StagedDeployRecord,
  type VerifierKeySet,
} from "./staged-deploy.ts";

const ORDER_CONTRACT_TAG = "milo";
// The build emits every artifact twice: `/zk/…` (unversioned, must-revalidate)
// and `/zk/<sourceSha256[0:16]>/…` (content-addressed, immutable). Only the
// versioned copy is cached across visits, so the client asks for that one. The
// constant is injected by scripts/build.ts; under `bun test` or the dev server it
// is absent and the unversioned path is used, which is what those serve.
declare const __ZK_VERSION__: string | undefined;

/** The artifact base URL for one build. Exported so the derivation and its
 * fail-safe are testable without depending on module-evaluation order: a test
 * cannot set a global before this module's imports run. */
export function zkBaseUrlFor(version: string | null | undefined): string {
  // A malformed constant must degrade to today's behaviour, not produce a URL
  // that 404s every key. The shape is exactly what build.ts emits.
  return typeof version === "string" && /^[0-9a-f]{16}$/.test(version)
    ? `/zk/${version}`
    : "/zk";
}

const DEFAULT_ZK_BASE_URL = zkBaseUrlFor(
  typeof __ZK_VERSION__ === "string" ? __ZK_VERSION__ : undefined,
);
const ORDER_PRIVATE_STATE_ID = "milo-order";
const INTENT_TTL_MS = 600_000;
/** Bound on one wallet submit, so a hung pop-up cannot strand the caller. */
const SUBMIT_TIMEOUT_MS = 180_000;

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type ChainSession = {
  readonly providers: ChainProviders<OrderPrivateState>;
  readonly compiledContract: CompiledOrderContract;
  readonly networkId: string;
};

type OpenSessionInput = {
  readonly connected: ConnectedAPI;
  readonly zkBaseUrl?: string;
  readonly privateStateScope: string;
  readonly fetchFunc?: typeof fetch;
};

type CompiledOrderContract = CompiledContract.CompiledContract<
  Generated.Contract,
  OrderPrivateState
>;

const compiledOrderContract = (): CompiledOrderContract =>
  CompiledContract.withWitnesses(
    CompiledContract.make<Generated.Contract, OrderPrivateState>(
      ORDER_CONTRACT_TAG,
      Generated.Contract,
    ),
    orderWitnesses() as never,
  ) as CompiledOrderContract;

const deserializeFinalized = (bytes: Uint8Array): FinalizedTransaction =>
  Transaction.deserialize<SignatureEnabled, Proof, Binding>(
    "signature",
    "proof",
    "binding",
    bytes,
  );

// indexerPublicDataProvider defaults webSocketImpl to `ws.WebSocket`, and the
// SDK imports isomorphic-ws as a namespace. isomorphic-ws/browser.js only has a
// default export, so that namespace has no WebSocket member and the default is
// undefined. graphql-ws then falls back to a global, which is fine here but
// leaves the subscription dependent on a global it never asked for. Pass the
// browser's own WebSocket so the subscription path is explicit.
const browserIndexerProvider = (queryUri: string, subscriptionUri: string) =>
  indexerPublicDataProvider(
    queryUri,
    subscriptionUri,
    globalThis.WebSocket as never,
  );

const absoluteZkBaseUrl = (baseUrl: string): string => {
  const origin =
    typeof location === "undefined" ? "http://localhost" : location.origin;
  const resolved = new URL(baseUrl, origin);
  // Verifier keys are installed into the contract, so a cross-origin base would let
  // a third party choose them. Only same-origin artifacts are trusted.
  if (resolved.origin !== new URL(origin).origin)
    throw new ChainError(
      "ZK_ARTIFACT_UNAVAILABLE",
      `The contract artifacts must come from this origin, not ${resolved.origin}.`,
    );
  return resolved.toString();
};

/**
 * The proof server answers `429 JobQueueFull` when its worker pool is saturated,
 * and the docs say to wait and retry. The installed provider
 * (`midnight-js-http-client-proof-provider@4.1.1`) retries `[500, 503]` but not
 * `429`, and it never reads the response body, so a caller cannot tell a busy
 * server from a broken one. This adds the missing case and nothing else: the
 * budget is two retries, the delay reuses `backoffDelay` from this file, and any
 * other failure is rethrown untouched so upstream behaviour is unchanged.
 */
const PROOF_RETRY_LIMIT = 2;

const proofQueueFull = (error: unknown): boolean =>
  /code="429"|JobQueueFull|Job Queue full/i.test(
    error instanceof Error ? `${error.name} ${error.message}` : String(error),
  );

export const withProofRetry = async <T>(
  prove: () => Promise<T>,
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prove();
    } catch (error) {
      if (attempt >= PROOF_RETRY_LIMIT || !proofQueueFull(error)) throw error;
      await new Promise((done) =>
        setTimeout(done, backoffDelay(attempt + 1, 1_000)),
      );
    }
  }
};

export async function openChainSession(
  input: OpenSessionInput,
): Promise<ChainSession> {
  try {
    const privateStateProvider = browserPrivateStateProvider<OrderPrivateState>(
      input.privateStateScope,
    );
    const providers = await assembleChainProviders<OrderPrivateState>({
      connected: input.connected,
      zkBaseUrl: absoluteZkBaseUrl(input.zkBaseUrl ?? DEFAULT_ZK_BASE_URL),
      privateStateProvider,
      createZkConfigProvider: (baseUrl, fetchFunc) =>
        new FetchZkConfigProvider<string>(baseUrl, fetchFunc),
      createHttpProofProvider: (url, zkConfigProvider) => {
        const provider = httpClientProofProvider(url, zkConfigProvider);
        return {
          proveTx: (tx, options) =>
            withProofRetry(() => provider.proveTx(tx, options)),
        };
      },
      createWalletProofProvider: async (api, zkConfigProvider) =>
        createProofProvider(
          await api.getProvingProvider(
            zkConfigProvider.asKeyMaterialProvider(),
          ),
        ),
      createPublicDataProvider: (indexerUri, indexerWsUri) =>
        browserIndexerProvider(indexerUri, indexerWsUri),
      deserializeTransaction: deserializeFinalized,
      setNetworkId,
      fetchFunc: input.fetchFunc,
    });
    return {
      providers,
      compiledContract: compiledOrderContract(),
      // Read once, in assembleChainProviders, rather than asking the wallet again.
      networkId: providers.networkId,
    };
  } catch (error) {
    throw toChainError(error);
  }
}

export type DeployOrderInput = {
  readonly session: ChainSession;
  readonly configuration: OrderConfiguration;
  readonly privateState: OrderPrivateState;
  readonly onProgress?: (progress: StagedDeployProgress) => void;
  readonly resume?: StagedDeployRecord | null;
  readonly record?: (record: StagedDeployRecord) => void;
} & WatchOrderOptions;

const CONTRACT_ADDRESS = /^[0-9a-f]{64}$/;

const CONFIGURATION_BYTES = [
  "network",
  "orderNonce",
  "termsCommitment",
  "buyerCommitment",
  "merchantCommitment",
  "operatorCommitment",
] as const;

const CONFIGURATION_BIGINTS = [
  "acceptanceDeadline",
  "deliveryDeadline",
  "reviewDeadline",
  "resolutionDeadline",
] as const;

function encodeConfiguration(configuration: OrderConfiguration): string {
  const encoded: Record<string, string> = {};
  for (const field of CONFIGURATION_BYTES)
    encoded[field] = encodeHex(configuration[field]);
  for (const field of CONFIGURATION_BIGINTS)
    encoded[field] = configuration[field].toString();
  return JSON.stringify(encoded);
}

const buildInitialState = (input: {
  readonly configuration: OrderConfiguration;
  readonly privateState: OrderPrivateState;
  readonly coinPublicKey: string;
  readonly circuits: readonly OrderCircuitName[];
  readonly keys: VerifierKeySet;
  readonly signingKey: SigningKey;
}): ContractState => {
  const context = createConstructorContext(
    input.privateState as never,
    input.coinPublicKey,
  );
  const result = new Generated.Contract(orderWitnesses() as never).initialState(
    context as never,
    input.configuration as never,
  );
  const original = ContractState.deserialize(
    result.currentContractState.serialize(),
  );
  if (original.balance.size > 0)
    throw new ChainError(
      "CONTRACT_REJECTED",
      "The order constructor produced contract balances, which the staged deploy does not support.",
    );
  const initial = new ContractState();
  initial.data = original.data;
  initial.balance = new Map();
  initial.maintenanceAuthority = new ContractMaintenanceAuthority(
    [signatureVerifyingKey(input.signingKey)],
    1,
    0n,
  );
  for (const circuit of input.circuits) {
    const operation = new ContractOperation();
    operation.verifierKey = input.keys.get(circuit) as Uint8Array;
    initial.setOperation(circuit, operation);
  }
  return initial;
};

const readVerifierKeys = async (
  session: ChainSession,
): Promise<VerifierKeySet> => {
  const pairs = await session.providers.zkConfigProvider.getVerifierKeys([
    ...ORDER_CIRCUITS,
  ]);
  return assertVerifierKeySet(
    new Map(
      pairs.map(([circuit, key]) => [
        circuit as OrderCircuitName,
        new Uint8Array(key),
      ]),
    ),
  );
};

const blockHeightOf = async (
  session: ChainSession,
  address: string,
): Promise<number> => {
  try {
    const finalized =
      await session.providers.publicDataProvider.watchForDeployTxData(
        address as never,
      );
    return typeof finalized?.blockHeight === "number"
      ? finalized.blockHeight
      : 0;
  } catch {
    return 0;
  }
};

const stagedLedger = (
  session: ChainSession,
  configuration: OrderConfiguration,
  privateState: OrderPrivateState,
  keys: VerifierKeySet,
): StagedDeployLedger => {
  const providers = session.providers;
  const submit = async (unprovenTx: unknown): Promise<string> => {
    const proven = await providers.proofProvider.proveTx(unprovenTx as never);
    const balanced = await providers.walletProvider.balanceTx(proven);
    return providers.midnightProvider.submitTx(balanced);
  };
  return {
    async deploy({ circuits, signingKey: key }) {
      const initialState = buildInitialState({
        configuration,
        privateState,
        coinPublicKey: session.providers.keys.coinPublicKey,
        circuits,
        keys,
        signingKey: key,
      });
      const deployment = new ContractDeploy(initialState);
      const address = deployment.address;
      if (!CONTRACT_ADDRESS.test(address))
        throw new ChainError(
          "TX_FAILED",
          `The ledger produced a contract address that is not 64 lowercase hex characters: ${address}.`,
        );
      const txId = await submit(
        Transaction.fromParts(
          session.networkId,
          undefined,
          undefined,
          Intent.new(new Date(Date.now() + INTENT_TTL_MS)).addDeploy(
            deployment,
          ),
        ),
      );
      return { address, txId };
    },
    async maintenance({
      address,
      counter,
      circuits,
      keys: keySet,
      signingKey: key,
      lock,
    }) {
      const updates: SingleUpdate[] = circuits.map(
        (circuit) =>
          new VerifierKeyInsert(
            circuit,
            new ContractOperationVersionedVerifierKey(
              "v3",
              keySet.get(circuit) as Uint8Array,
            ),
          ),
      );
      if (lock)
        updates.push(
          new ReplaceAuthority(
            new ContractMaintenanceAuthority([], 1, counter + 1n),
          ),
        );
      let update = new MaintenanceUpdate(
        address as ContractAddress,
        updates,
        counter,
      );
      update = update.addSignature(0n, signData(key, update.dataToSign));
      const txId = await submit(
        Transaction.fromParts(
          session.networkId,
          undefined,
          undefined,
          Intent.new(new Date(Date.now() + INTENT_TTL_MS)).addMaintenanceUpdate(
            update,
          ),
        ),
      );
      return { txId };
    },
    async observe(address) {
      const state = await providers.publicDataProvider.queryContractState(
        address as never,
      );
      return state ? { state } : null;
    },
  };
};

export async function deployOrderContract(
  input: DeployOrderInput,
): Promise<DeployOrderResult> {
  try {
    const configuration = assertOrderConfiguration(input.configuration);
    const privateState = assertOrderPrivateState(input.privateState);
    const keys = await readVerifierKeys(input.session);
    const signingKey =
      input.resume?.signingKey ?? (sampleSigningKey() as SigningKey);
    const ledger = stagedLedger(
      input.session,
      configuration,
      privateState,
      keys,
    );
    const record = input.record ?? (() => {});
    const result = await runStagedDeploy({
      ledger,
      keys,
      signingKey,
      configuration: encodeConfiguration(configuration),
      resume: input.resume ?? null,
      record,
      onProgress: input.onProgress,
      observeAttempts: input.attempts,
      observeRetryMs: input.retryMs,
      wait: input.wait,
    });
    const state =
      await input.session.providers.publicDataProvider.queryContractState(
        result.contractAddress as never,
      );
    if (!state)
      throw new ChainError(
        "TX_FAILED",
        `The staged deploy reported completion but the indexer returned no state at ${result.contractAddress}.`,
      );
    const blockHeight = await blockHeightOf(
      input.session,
      result.contractAddress,
    );
    return {
      contractAddress: result.contractAddress,
      txId: result.txId,
      blockHeight,
      installedCircuits: result.installedCircuits,
    };
  } catch (error) {
    throw toChainError(error);
  }
}

type JoinOrderInput = {
  readonly session: ChainSession;
  readonly contractAddress: string;
  readonly privateState: OrderPrivateState;
};

export async function joinOrderContract(
  input: JoinOrderInput,
): Promise<{ readonly contractAddress: string }> {
  try {
    const privateState = assertOrderPrivateState(input.privateState);
    const found = await findDeployedContract<Generated.Contract>(
      input.session.providers as never,
      {
        compiledContract: input.session.compiledContract as never,
        contractAddress: input.contractAddress,
        privateStateId: ORDER_PRIVATE_STATE_ID,
        initialPrivateState: privateState as never,
      } as never,
    );
    return { contractAddress: found.deployTxData.public.contractAddress };
  } catch (error) {
    throw toChainError(error);
  }
}

export type CallOrderInput = {
  readonly session: ChainSession;
  readonly contractAddress: string;
  readonly circuit: OrderCircuitName;
  readonly expectedRevision: bigint;
  readonly commitment?: Uint8Array;
  readonly expectedDelivery?: Uint8Array;
  readonly evidence?: Uint8Array;
  readonly approveOrder?: boolean;
};

export type CallOrderResult = {
  readonly circuit: OrderCircuitName;
  readonly txId: string;
  readonly blockHeight: number;
};

export async function callOrderCircuit(
  input: CallOrderInput,
): Promise<CallOrderResult> {
  try {
    if (!ORDER_CIRCUITS.includes(input.circuit))
      throw new ChainError(
        "INVALID_REQUEST",
        `Unknown order circuit "${String(input.circuit)}".`,
      );
    const args = circuitArguments(input.circuit, input);
    // A wallet that never settles its pop-up would otherwise leave the caller
    // pending forever, which is what pushes a user to reload mid-submit.
    const finalized = await Promise.race([
      submitCallTx(
        input.session.providers as never,
        {
          compiledContract: input.session.compiledContract as never,
          circuitId: input.circuit,
          contractAddress: input.contractAddress,
          privateStateId: ORDER_PRIVATE_STATE_ID,
          args,
        } as never,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new ChainError(
                "TX_FAILED",
                "The wallet did not answer in time. The step is not confirmed; check the order before retrying.",
              ),
            ),
          SUBMIT_TIMEOUT_MS,
        ),
      ),
    ]);
    const { txId, blockHeight } = finalized.public;
    if (typeof txId !== "string" || txId.length === 0)
      throw new ChainError(
        "TX_FAILED",
        "The wallet returned no transaction id; nothing is claimed as submitted.",
      );
    return { circuit: input.circuit, txId, blockHeight };
  } catch (error) {
    throw toChainError(error);
  }
}

export function decodeOrderState(
  state: RuntimeContractState,
): OrderContractState {
  const ledger = Generated.ledger(state.data);
  const phase = ORDER_PHASES[Number(ledger.phase)];
  if (!phase)
    throw new ChainError(
      "CONTRACT_REJECTED",
      "The contract reports a phase that this build does not know.",
    );
  const evidence = ledger.evidenceCommitment;
  return {
    phase,
    revision: Number(ledger.revision),
    evidenceCommitment: evidence.some((byte) => byte !== 0)
      ? toHex(evidence)
      : null,
  };
}

type Unsubscribable = { unsubscribe(): void };

type ObservableLike<T> = {
  subscribe(observer: {
    next(value: T): void;
    error(error: unknown): void;
    complete(): void;
  }): Unsubscribable;
};

type OrderStateSource = {
  contractStateObservable(
    address: never,
    config: { type: "latest" } | { type: "all" },
  ): ObservableLike<RuntimeContractState>;
  /** The current state, read once. The `all` branch subscribes from the tip and
   * does not replay, so the first paint needs this or the page is blank until the
   * next change. Optional so a test or a caller with only an observable works. */
  contractState?(address: never): Promise<RuntimeContractState | null>;
};

type WatchOrderStateOptions = {
  readonly attempts?: number;
  readonly retryMs?: number;
  readonly wait?: (ms: number) => Promise<void>;
  /** Called when the subscription drops, with the delay before the next attempt, so
   * the UI can show a stale marker instead of freezing on the last state it saw. */
  readonly onStale?: (retryInMs: number) => void;
  /** Jitter source, injectable so a test can make backoff deterministic. */
  readonly random?: () => number;
};

/** Exponential backoff with jitter, capped. Without jitter every client retries in
 * lockstep after a server restart and the retry waves keep it down. `attempt` is
 * 1-based, so the first retry waits `baseMs`. */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), 30_000);
  return Math.floor(exponential * (0.5 + random() * 0.5));
}

export function watchOrderState(
  source: OrderStateSource,
  address: string,
  onState: (state: OrderContractState) => void,
  options: WatchOrderStateOptions = {},
): () => void {
  const attempts = options.attempts ?? 30;
  const retryMs = options.retryMs ?? 2_000;
  const wait = options.wait ?? defaultWait;
  const random = options.random ?? Math.random;
  const onStale = options.onStale;
  let stopped = false;
  let attempt = 0;
  let subscription: Unsubscribable | undefined;
  let scheduled = false;
  /** The last state published to the subscriber, so an identical re-emit is dropped. */
  let published: OrderContractState | undefined;

  const sameState = (next: OrderContractState): boolean =>
    published !== undefined &&
    published.phase === next.phase &&
    published.revision === next.revision &&
    published.evidenceCommitment === next.evidenceCommitment;

  const stop = () => {
    stopped = true;
    subscription?.unsubscribe();
    subscription = undefined;
  };

  const schedule = () => {
    if (stopped || scheduled) return;
    scheduled = true;
    // Drop the dead subscription before waiting: an errored stream will not deliver
    // again, and leaving it attached leaks one subscription per retry.
    subscription?.unsubscribe();
    subscription = undefined;
    const delay = backoffDelay(attempt, retryMs, random);
    onStale?.(delay);
    void wait(delay).then(() => {
      scheduled = false;
      look();
    }, stop);
  };

  const publish = (value: RuntimeContractState) => {
    let decoded: OrderContractState;
    try {
      decoded = decodeOrderState(value);
    } catch {
      // An unreadable state is not recoverable by retrying: stop rather than
      // report a guess.
      stop();
      return;
    }
    // The indexer can re-emit the same state, and a re-render per emission is
    // wasted work. Publish one object per actual change.
    if (sameState(decoded)) return;
    published = decoded;
    onState(decoded);
  };

  const subscribe = () => {
    if (stopped) return;
    subscription = source
      .contractStateObservable(address as never, { type: "all" })
      .subscribe({
        next(value) {
          if (stopped) return;
          publish(value);
          // A successful emission proves the stream is healthy, so the budget
          // counts CONSECUTIVE failures. Without this reset `attempt` only ever
          // grew, and since `latest` emitted once per block the default 30 was
          // spent by ordinary operation: the page stopped updating after ~30
          // blocks and never recovered.
          attempt = 0;
        },
        // A dropped subscription is the normal case, not a fatal one. The SDK's
        // graphql-ws client is built without retryAttempts or keepAlive, so
        // reconnecting is this function's job and must stay.
        error: schedule,
        complete: schedule,
      });
  };

  const look = () => {
    if (stopped) return;
    if (attempt >= attempts) return stop();
    attempt += 1;
    // `all` is the server-filtered branch: CONTRACT_STATE_SUB($address) streams
    // only this contract's changes, where `latest` opened TXS_FROM_BLOCK_SUB and
    // pushed every block on chain through the socket for a client-side filter.
    //
    // Measured on the local indexer (2026-10-28): `all` replays the contract's
    // state history from deployment on every subscribe — 3 messages / 69,764 B
    // for a 3-revision contract, against 1 message / 27,301 B for `latest` over
    // the same 10 blocks. So it does deliver the current state on its own, and no
    // separate read is needed; the dedupe below drops the trailing duplicate.
    //
    // A source without the optional read subscribes synchronously, which keeps the
    // observable-only shape working.
    if (!source.contractState) return subscribe();
    void source
      .contractState(address as never)
      .then((current) => {
        if (!stopped && current) publish(current);
      })
      .catch(() => undefined)
      .then(subscribe);
  };

  look();
  return stop;
}

export type WatchOrderInput = WatchOrderOptions & {
  readonly connected: ConnectedAPI;
  readonly address: string;
  readonly onState: (state: OrderContractState) => void;
};

export async function watchOrderContract(
  input: WatchOrderInput,
): Promise<() => void> {
  try {
    const config = await readWalletConfig(input.connected);
    const provider = browserIndexerProvider(
      config.indexerUri,
      config.indexerWsUri,
    );
    return watchOrderState(
      {
        contractStateObservable: (address, config) =>
          provider.contractStateObservable(address as never, config as never),
        // `queryContractState(address)` with no config is "as of the latest
        // block". It does not accept `{type:"latest"}` — its config is
        // `BlockHeightConfig | BlockHashConfig` only.
        contractState: (address) =>
          provider.queryContractState(address as never),
      },
      input.address,
      input.onState,
      {
        attempts: input.attempts,
        retryMs: input.retryMs,
        wait: input.wait,
      },
    );
  } catch (error) {
    throw toChainError(error);
  }
}
