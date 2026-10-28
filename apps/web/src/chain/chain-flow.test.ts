import { describe, expect, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type {
  FinalizedTxData,
  PrivateStateProvider,
  ProofProvider,
  PublicDataProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { SucceedEntirely } from "@midnight-ntwrk/midnight-js-types";
import * as Generated from "../../../../packages/contract/generated/contract/index.js";
import {
  INITIAL_VERIFIER_CIRCUITS,
  ORDER_CIRCUITS,
  type OrderConfiguration,
  type OrderPrivateState,
} from "./order";
// Shared fixtures live in private-state.test.ts, which already hosts `fakeIdb`
// for the same reason. `memoryStorage` is shared too: this file and that one
// carried the same 14-line Storage stub.
import {
  bytes32,
  CONFIG,
  memoryStorage,
  SHIELDED,
  terms,
} from "./private-state.test";
import {
  type ChainSession,
  deployOrderContract,
  joinOrderContract,
  openChainSession,
} from "./runtime";
import { installedCircuitsOf, type StagedDeployRecord } from "./staged-deploy";

const NETWORK = (() => {
  const value = new Uint8Array(32);
  value.set(new TextEncoder().encode("preprod"));
  return value;
})();

const now = BigInt(Math.floor(Date.now() / 1000));

const configuration: OrderConfiguration = {
  network: NETWORK,
  orderNonce: bytes32(1),
  termsCommitment: Generated.pureCircuits.hashTerms(NETWORK, bytes32(1), terms),
  buyerCommitment: Generated.pureCircuits.hashCapability(
    NETWORK,
    bytes32(1),
    Generated.Role.BUYER,
    bytes32(11),
  ),
  merchantCommitment: Generated.pureCircuits.hashCapability(
    NETWORK,
    bytes32(1),
    Generated.Role.MERCHANT,
    bytes32(12),
  ),
  operatorCommitment: Generated.pureCircuits.hashCapability(
    NETWORK,
    bytes32(1),
    Generated.Role.OPERATOR,
    bytes32(13),
  ),
  acceptanceDeadline: now + 3_600n,
  deliveryDeadline: now + 7_200n,
  reviewDeadline: now + 10_800n,
  resolutionDeadline: now + 14_400n,
};

const buyerState: OrderPrivateState = {
  actor: "buyer",
  secret: bytes32(11),
  terms,
  limit: 36_000n,
};

const states = new Map<string, unknown>();
const deployed = new Map<string, Uint8Array>();
const submitted: string[] = [];
const balanced: string[] = [];

const contractStateAt = async (address: string) => {
  const bytes = deployed.get(address);
  if (!bytes) return null;
  const runtime = await import("@midnight-ntwrk/compact-runtime");
  return runtime.ContractState.deserialize(bytes) as never;
};

const publicDataProvider = (): PublicDataProvider =>
  ({
    queryContractState: async (address: string) =>
      contractStateAt(address as string),
    queryDeployContractState: async (address: string) =>
      contractStateAt(address as string),
    queryZSwapAndContractState: async (address: string) => {
      const state = await contractStateAt(address as string);
      if (!state) return null;
      const ledger = await import(
        "@midnight-ntwrk/midnight-js-protocol/ledger"
      );
      return [
        new ledger.ZswapChainState(),
        state,
        ledger.LedgerParameters.initialParameters(),
      ] as never;
    },
    queryUnshieldedBalances: async () => null,
    watchForContractState: async (address: string) =>
      contractStateAt(address as string) as never,
    watchForDeployTxData: async (address: string) =>
      ({
        txId: `deploy-${address}`,
        status: SucceedEntirely,
        blockHeight: 1,
        identifiers: [`deploy-${address}`],
      }) as unknown as FinalizedTxData,
    watchForTxData: async (txId: string) =>
      ({
        txId,
        status: SucceedEntirely,
        blockHeight: 2,
        identifiers: [txId],
      }) as unknown as FinalizedTxData,
    contractStateObservable: () => {
      throw new Error("not used");
    },
    unshieldedBalancesObservable: () => {
      throw new Error("not used");
    },
    watchForUnshieldedBalances: async () => [],
  }) as unknown as PublicDataProvider;

const proofProvider = (): ProofProvider => ({
  async proveTx(unprovenTx) {
    return unprovenTx.prove(
      {
        check: async () => [],
        prove: async () => new Uint8Array(32),
      } as never,
      (
        await import("@midnight-ntwrk/midnight-js-protocol/ledger")
      ).CostModel.initialCostModel(),
    ) as never;
  },
});

const privateStateProvider = (): PrivateStateProvider<
  string,
  OrderPrivateState
> =>
  ({
    setContractAddress: () => {},
    set: async (id: string, state: OrderPrivateState) =>
      void states.set(id, state),
    get: async (id: string) => (states.get(id) as OrderPrivateState) ?? null,
    remove: async (id: string) => void states.delete(id),
    clear: async () => states.clear(),
    setSigningKey: async () => {},
    getSigningKey: async () => "cc".repeat(32) as never,
    removeSigningKey: async () => {},
    clearSigningKeys: async () => {},
    exportPrivateStates: async () => ({}) as never,
    importPrivateStates: async () => ({
      imported: 0,
      skipped: 0,
      overwritten: 0,
    }),
    exportSigningKeys: async () => ({}) as never,
    importSigningKeys: async () => ({
      imported: 0,
      skipped: 0,
      overwritten: 0,
    }),
  }) as unknown as PrivateStateProvider<string, OrderPrivateState>;

function connector(): ConnectedAPI {
  return {
    getShieldedAddresses: async () => SHIELDED,
    getConfiguration: async () => CONFIG,
    getProvingProvider: async () => ({}) as never,
    async balanceUnsealedTransaction(tx: string) {
      balanced.push(tx);
      const parsed = Transaction.deserialize(
        "signature",
        "proof",
        "pre-binding",
        Uint8Array.from(
          tx.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
        ),
      );
      const sealed = parsed.bind();
      return { tx: Buffer.from(sealed.serialize()).toString("hex") };
    },
    async submitTransaction(tx: string) {
      submitted.push(tx);
      const ledger = await import(
        "@midnight-ntwrk/midnight-js-protocol/ledger"
      );
      const parsed = Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        Uint8Array.from(
          tx.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
        ),
      );
      for (const intent of parsed.intents?.values() ?? [])
        for (const action of intent.actions) {
          if (action instanceof ledger.ContractDeploy) {
            deployed.set(action.address, action.initialState.serialize());
            continue;
          }
          if (action instanceof ledger.MaintenanceUpdate) {
            const current = deployed.get(action.address);
            if (!current) throw new Error(`No contract at ${action.address}`);
            const state = ledger.ContractState.deserialize(current);
            let nextAuthority = new ledger.ContractMaintenanceAuthority(
              state.maintenanceAuthority.committee,
              state.maintenanceAuthority.threshold,
              state.maintenanceAuthority.counter + 1n,
            );
            for (const update of action.updates) {
              if (update instanceof ledger.ReplaceAuthority) {
                nextAuthority = update.authority;
                continue;
              }
              if (!(update instanceof ledger.VerifierKeyInsert)) continue;
              const operation = new ledger.ContractOperation();
              operation.verifierKey = Buffer.concat([
                Buffer.from("midnight:verifier-key[v6]:"),
                Buffer.from(update.vk.rawVk),
              ]);
              state.setOperation(update.operation, operation);
            }
            state.maintenanceAuthority = nextAuthority;
            deployed.set(action.address, state.serialize());
          }
        }
    },
  } as unknown as ConnectedAPI;
}

function sessionWith(
  base: ChainSession,
  overrides: Partial<ChainSession["providers"]>,
): ChainSession {
  return {
    ...base,
    providers: { ...base.providers, ...overrides },
  };
}

const generated = new URL(
  "../../../../packages/contract/generated/",
  import.meta.url,
);

const zkFetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  const match = /\/zk\/(keys|zkir)\/([A-Za-z0-9]+)\.(\w+)$/.exec(url);
  if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
  const [, directory, circuit, extension] = match;
  const file = Bun.file(
    new URL(`${directory}/${circuit}.${extension}`, generated),
  );
  return new Response(await file.arrayBuffer(), {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}) as typeof fetch;

const withStorage = async (run: () => Promise<void>) => {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  });
  try {
    states.clear();
    deployed.clear();
    submitted.length = 0;
    balanced.length = 0;
    await run();
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      configurable: true,
    });
  }
};

describe("real midnight-js deploy and call through a mocked connector", () => {
  test("deploys the order contract and returns a real address and tx id", async () => {
    await withStorage(async () => {
      const base = await openChainSession({
        connected: connector(),
        zkBaseUrl: "/zk",
        privateStateScope: "deploy-test",
        fetchFunc: zkFetch,
      });
      const session = sessionWith(base, {
        publicDataProvider: publicDataProvider(),
        proofProvider: proofProvider(),
        privateStateProvider: privateStateProvider(),
      });

      const progress: { stage: string; done: number; total: number }[] = [];
      const result = await deployOrderContract({
        session,
        configuration,
        privateState: buyerState,
        onProgress: (step) =>
          progress.push({
            stage: step.stage,
            done: step.done,
            total: step.total,
          }),
        wait: async () => {},
      });

      expect(result.contractAddress).toMatch(/^[0-9a-f]{64}$/);
      expect(result.txId.length).toBeGreaterThan(0);
      expect(typeof result.blockHeight).toBe("number");
      expect(result.installedCircuits).toEqual([...ORDER_CIRCUITS]);

      expect(balanced.length).toBe(2);
      expect(submitted.length).toBe(2);
      expect(progress.map((step) => step.stage)).toEqual([
        "deploy",
        "deploy",
        "verifiers",
        "verifiers",
        "confirm",
      ]);

      const finalState = await publicDataProvider().queryContractState(
        result.contractAddress as never,
      );
      expect(installedCircuitsOf(finalState?.operations() ?? [])).toEqual([
        ...ORDER_CIRCUITS,
      ]);
      expect(finalState?.maintenanceAuthority.counter).toBe(1n);
      expect(finalState?.maintenanceAuthority.committee).toEqual([]);
      expect(finalState?.maintenanceAuthority.threshold).toBe(1);
    });
  }, 120_000);

  test("deploys, joins and observes the deployed state", async () => {
    await withStorage(async () => {
      const base = await openChainSession({
        connected: connector(),
        zkBaseUrl: "/zk",
        privateStateScope: "call-test",
        fetchFunc: zkFetch,
      });
      const session = sessionWith(base, {
        publicDataProvider: publicDataProvider(),
        proofProvider: proofProvider(),
        privateStateProvider: privateStateProvider(),
      });

      const deployedOrder = await deployOrderContract({
        session,
        configuration,
        privateState: buyerState,
      });

      const joined = await joinOrderContract({
        session,
        contractAddress: deployedOrder.contractAddress,
        privateState: buyerState,
      });
      expect(joined.contractAddress).toBe(deployedOrder.contractAddress);
      expect(submitted.length).toBe(2);
      expect(
        installedCircuitsOf(
          (
            await publicDataProvider().queryContractState(
              deployedOrder.contractAddress as never,
            )
          )?.operations() ?? [],
        ),
      ).toEqual([...ORDER_CIRCUITS]);
    });
  }, 120_000);

  test("resumes an interrupted deploy from the persisted record", async () => {
    await withStorage(async () => {
      let rejectInsert = true;
      const flaky = connector();
      const submit = flaky.submitTransaction.bind(flaky);
      (flaky as unknown as Record<string, unknown>).submitTransaction = async (
        tx: string,
      ) => {
        const ledger = await import(
          "@midnight-ntwrk/midnight-js-protocol/ledger"
        );
        const parsed = Transaction.deserialize(
          "signature",
          "proof",
          "binding",
          Uint8Array.from(
            tx.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
          ),
        );
        const isInsert = [...(parsed.intents?.values() ?? [])].some((intent) =>
          intent.actions.some(
            (action) => action instanceof ledger.MaintenanceUpdate,
          ),
        );
        if (isInsert && rejectInsert)
          throw new Error("wallet closed mid-deploy");
        return submit(tx);
      };

      const base = await openChainSession({
        connected: flaky,
        zkBaseUrl: "/zk",
        privateStateScope: "resume-test",
        fetchFunc: zkFetch,
      });
      const session = sessionWith(base, {
        publicDataProvider: publicDataProvider(),
        proofProvider: proofProvider(),
        privateStateProvider: privateStateProvider(),
      });

      const records: StagedDeployRecord[] = [];
      await expect(
        deployOrderContract({
          session,
          configuration,
          privateState: buyerState,
          record: (record) => records.push(record),
          wait: async () => {},
        }),
      ).rejects.toThrow(/wallet closed mid-deploy/);

      expect(submitted.length).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0].installedCircuits).toEqual([
        ...INITIAL_VERIFIER_CIRCUITS,
      ]);

      const address = records[0].contractAddress;
      expect(
        installedCircuitsOf(
          (
            await publicDataProvider().queryContractState(address as never)
          )?.operations() ?? [],
        ),
      ).toEqual([...INITIAL_VERIFIER_CIRCUITS]);

      rejectInsert = false;
      const resumed = await deployOrderContract({
        session,
        configuration,
        privateState: buyerState,
        resume: records[0],
        record: (record) => records.push(record),
        wait: async () => {},
      });

      expect(resumed.contractAddress).toBe(address);
      expect(resumed.installedCircuits).toEqual([...ORDER_CIRCUITS]);
      expect(submitted.length).toBe(2);
      expect(
        installedCircuitsOf(
          (
            await publicDataProvider().queryContractState(address as never)
          )?.operations() ?? [],
        ),
      ).toEqual([...ORDER_CIRCUITS]);
    });
  }, 120_000);
});
