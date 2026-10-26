import * as Generated from "../../../../packages/contract/generated/contract/index.js";

export type OrderCircuitName =
  | "reserve"
  | "accept"
  | "cancelReserved"
  | "decline"
  | "submitDelivery"
  | "approve"
  | "disputeBuyer"
  | "disputeMerchant"
  | "resolve"
  | "expireBootstrap"
  | "expireReserved"
  | "expireUndelivered"
  | "escalateUnreviewed"
  | "expireDispute";

export const ORDER_CIRCUITS: readonly OrderCircuitName[] = [
  "accept",
  "approve",
  "cancelReserved",
  "decline",
  "disputeBuyer",
  "disputeMerchant",
  "escalateUnreviewed",
  "expireBootstrap",
  "expireDispute",
  "expireReserved",
  "expireUndelivered",
  "reserve",
  "resolve",
  "submitDelivery",
];

const DEPLOY_BATCH_SIZE = 7;

export const INITIAL_VERIFIER_CIRCUITS: readonly OrderCircuitName[] =
  ORDER_CIRCUITS.filter((name) => name !== "reserve").slice(
    0,
    DEPLOY_BATCH_SIZE,
  );

export const REMAINING_VERIFIER_CIRCUITS: readonly OrderCircuitName[] =
  ORDER_CIRCUITS.filter((name) => !INITIAL_VERIFIER_CIRCUITS.includes(name));

export const ORDER_PHASES = [
  "DEPLOYED",
  "RESERVED",
  "ACCEPTED",
  "SUBMITTED",
  "DISPUTED",
  "APPROVED",
  "CANCELLED",
] as const;

export type OrderPhase = (typeof ORDER_PHASES)[number];

const ROLE = { buyer: 0, merchant: 1, operator: 2 } as const;

/** The two commitment hashes are pure circuits, so they live here with the rest of
 * the ledger-free code: the onchain runtime is the only wasm they need. */
export function capabilityCommitment(
  network: Uint8Array,
  orderNonce: Uint8Array,
  actor: OrderPrivateState["actor"],
  secret: Uint8Array,
): Uint8Array {
  return Generated.pureCircuits.hashCapability(
    network,
    orderNonce,
    ROLE[actor],
    secret,
  );
}

export function termsCommitment(
  network: Uint8Array,
  orderNonce: Uint8Array,
  terms: OrderTerms,
): Uint8Array {
  return Generated.pureCircuits.hashTerms(network, orderNonce, terms as never);
}

export const toHex = (bytes: Uint8Array): string =>
  // Byte padding for a hex digest, not a 01/02/03 label.
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); // taste-skill-ignore

export type OrderContractState = {
  readonly phase: OrderPhase;
  readonly revision: number;
  readonly evidenceCommitment: string | null;
};

export type WatchOrderOptions = {
  readonly attempts?: number;
  readonly retryMs?: number;
  readonly wait?: (ms: number) => Promise<void>;
};

export type DeployOrderResult = {
  readonly contractAddress: string;
  readonly txId: string;
  readonly blockHeight: number;
  readonly installedCircuits: readonly OrderCircuitName[];
};

export const BYTES32 = 32;

export type OrderTerms = {
  readonly serviceVersion: bigint;
  readonly packQuantity: bigint;
  readonly outputCount: bigint;
  readonly unitPrice: bigint;
  readonly total: bigint;
  readonly currency: Uint8Array;
  readonly scopeDigest: Uint8Array;
  readonly rightsDigest: Uint8Array;
  readonly paymentPolicy: Uint8Array;
  readonly salt: Uint8Array;
};

export type OrderConfiguration = {
  readonly network: Uint8Array;
  readonly orderNonce: Uint8Array;
  readonly termsCommitment: Uint8Array;
  readonly buyerCommitment: Uint8Array;
  readonly merchantCommitment: Uint8Array;
  readonly operatorCommitment: Uint8Array;
  readonly acceptanceDeadline: bigint;
  readonly deliveryDeadline: bigint;
  readonly reviewDeadline: bigint;
  readonly resolutionDeadline: bigint;
};

export type OrderPrivateState = {
  readonly actor: "buyer" | "merchant" | "operator";
  readonly secret: Uint8Array;
  readonly terms: OrderTerms;
  readonly limit: bigint;
};

type CircuitArguments = readonly unknown[];

const bytes32 = (value: Uint8Array, label: string): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length !== BYTES32)
    throw new Error(`${label} must be ${BYTES32} bytes.`);
  return value;
};

const uint64 = (value: bigint, label: string): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > 18446744073709551615n)
    throw new Error(`${label} must be a non-negative Uint<64>.`);
  return value;
};

const revisionOf = (value: bigint): bigint => uint64(value, "expectedRevision");

export function assertOrderTerms(terms: OrderTerms): OrderTerms {
  if (!terms || typeof terms !== "object")
    throw new Error("Agreed terms are required.");
  if (terms.serviceVersion !== 1n)
    throw new Error(
      "Unsupported service version; the contract accepts 1 only.",
    );
  if (terms.packQuantity !== 1n)
    throw new Error("Unsupported pack quantity; the contract accepts 1 only.");
  if (terms.outputCount !== 3n)
    throw new Error("Unsupported output count; the contract accepts 3 only.");
  uint64(terms.unitPrice, "unitPrice");
  uint64(terms.total, "total");
  if (terms.total !== terms.unitPrice * terms.packQuantity)
    throw new Error("total must equal unitPrice times packQuantity.");
  if (
    !(terms.currency instanceof Uint8Array) ||
    terms.currency.length !== 3 ||
    String.fromCharCode(...terms.currency) !== "USD"
  )
    throw new Error('Unsupported currency; the contract accepts "USD" only.');
  bytes32(terms.scopeDigest, "scopeDigest");
  bytes32(terms.rightsDigest, "rightsDigest");
  bytes32(terms.paymentPolicy, "paymentPolicy");
  bytes32(terms.salt, "salt");
  return terms;
}

export function assertOrderConfiguration(
  configuration: OrderConfiguration,
): OrderConfiguration {
  if (!configuration || typeof configuration !== "object")
    throw new Error("A public order configuration is required.");
  bytes32(configuration.network, "network");
  bytes32(configuration.orderNonce, "orderNonce");
  bytes32(configuration.termsCommitment, "termsCommitment");
  bytes32(configuration.buyerCommitment, "buyerCommitment");
  bytes32(configuration.merchantCommitment, "merchantCommitment");
  bytes32(configuration.operatorCommitment, "operatorCommitment");
  const commitments = [
    configuration.buyerCommitment,
    configuration.merchantCommitment,
    configuration.operatorCommitment,
  ].map((value) => Array.from(value).join(","));
  if (new Set(commitments).size !== commitments.length)
    throw new Error("Buyer, merchant and operator commitments must differ.");
  const deadlines = [
    configuration.acceptanceDeadline,
    configuration.deliveryDeadline,
    configuration.reviewDeadline,
    configuration.resolutionDeadline,
  ];
  for (const [index, deadline] of deadlines.entries())
    uint64(deadline, `deadline ${index}`);
  if (
    !(
      deadlines[0] > 0n &&
      deadlines[0] < deadlines[1] &&
      deadlines[1] < deadlines[2] &&
      deadlines[2] < deadlines[3]
    )
  )
    throw new Error(
      "Deadlines must be strictly increasing: acceptance < delivery < review < resolution.",
    );
  return configuration;
}

export function assertOrderPrivateState(
  state: OrderPrivateState,
): OrderPrivateState {
  if (!state || typeof state !== "object")
    throw new Error("Order private state is required.");
  if (
    state.actor !== "buyer" &&
    state.actor !== "merchant" &&
    state.actor !== "operator"
  )
    throw new Error(
      "Order private state must name a buyer, merchant or operator actor.",
    );
  bytes32(state.secret, `${state.actor} secret`);
  assertOrderTerms(state.terms);
  uint64(state.limit, "approval limit");
  return state;
}

export function circuitArguments(
  circuit: OrderCircuitName,
  input: {
    readonly expectedRevision: bigint;
    readonly commitment?: Uint8Array;
    readonly expectedDelivery?: Uint8Array;
    readonly evidence?: Uint8Array;
    readonly approveOrder?: boolean;
  },
): CircuitArguments {
  const revision = revisionOf(input.expectedRevision);
  switch (circuit) {
    case "reserve":
    case "accept":
    case "cancelReserved":
    case "decline":
    case "expireBootstrap":
    case "expireReserved":
    case "expireUndelivered":
    case "escalateUnreviewed":
    case "expireDispute":
      return [revision];
    case "submitDelivery":
      return [
        revision,
        bytes32(input.commitment ?? new Uint8Array(0), "commitment"),
      ];
    case "approve":
      return [
        revision,
        bytes32(
          input.expectedDelivery ?? new Uint8Array(0),
          "expectedDelivery",
        ),
      ];
    case "disputeBuyer":
    case "disputeMerchant":
      return [
        revision,
        bytes32(input.evidence ?? new Uint8Array(0), "evidence"),
      ];
    case "resolve": {
      if (typeof input.approveOrder !== "boolean")
        throw new Error("resolve requires an approveOrder decision.");
      return [
        revision,
        input.approveOrder,
        bytes32(input.evidence ?? new Uint8Array(0), "evidence"),
      ];
    }
    default: {
      const exhaustive: never = circuit;
      throw new Error(`Unknown order circuit "${String(exhaustive)}".`);
    }
  }
}

export function orderWitnesses() {
  const role =
    (actor: OrderPrivateState["actor"]) =>
    ({ privateState }: { privateState: OrderPrivateState }) => {
      if (privateState?.actor !== actor)
        throw new Error(
          `The ${actor} witness was requested with another actor's private state.`,
        );
      return [privateState, bytes32(privateState.secret, `${actor} secret`)];
    };
  return {
    buyerSecret: role("buyer"),
    merchantSecret: role("merchant"),
    operatorSecret: role("operator"),
    agreedTerms: ({ privateState }: { privateState: OrderPrivateState }) => [
      privateState,
      assertOrderTerms(privateState.terms),
    ],
    buyerApprovalLimit: ({
      privateState,
    }: {
      privateState: OrderPrivateState;
    }) => [privateState, uint64(privateState.limit, "approval limit")],
  };
}
