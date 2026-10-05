/**
 * The two phase vocabularies and the one mapping between them.
 *
 * `chainOrders` stores the seven contract phases from `order.compact`'s
 * `Phase` enum. `orders` and `deliveries` store four phases, and TERMINAL
 * stands in for both APPROVED and CANCELLED. Nothing in the tree previously
 * said so, so the two lists were free to drift; this module is the single
 * place the relationship is written down.
 *
 * The mapping is LOSSY in one direction and is deliberately not given a
 * round-trip. TERMINAL does not record which of APPROVED or CANCELLED
 * produced it, so no total, injective `fromOrderRowPhase` exists and none is
 * invented here. `chainPhasesForOrderRowPhase` returns the whole preimage
 * instead, which is total and honest: it answers "which chain phases can
 * produce this row phase", never "which one did".
 */

/** The seven phases of `packages/contract/src/order.compact`'s Phase enum. */
export const CHAIN_ORDER_PHASES = [
  "DEPLOYED",
  "RESERVED",
  "ACCEPTED",
  "SUBMITTED",
  "DISPUTED",
  "APPROVED",
  "CANCELLED",
] as const;

export type ChainOrderPhase = (typeof CHAIN_ORDER_PHASES)[number];

/** The four phases an `orders` or `deliveries` row may hold. */
export const ORDER_ROW_PHASES = [
  "ACCEPTED",
  "SUBMITTED",
  "DISPUTED",
  "TERMINAL",
] as const;

export type OrderRowPhase = (typeof ORDER_ROW_PHASES)[number];

/**
 * Chain phases with no `orders` row. An order row starts at merchant
 * acceptance; before that the contract holds the order and `orders` does not.
 */
export const UNMAPPED_CHAIN_ORDER_PHASES = ["DEPLOYED", "RESERVED"] as const;

/**
 * The whole mapping, one entry per chain phase, so a new chain phase cannot be
 * added without deciding here.
 *
 * APPROVED -> capture and CANCELLED -> void is the settlement policy that
 * `settlementAuthorized` applied as two string comparisons. It is a property
 * of the chain vocabulary, so it lives with the vocabulary.
 */
const CHAIN_TO_ROW: {
  readonly [K in ChainOrderPhase]: OrderRowPhase | null;
} = {
  DEPLOYED: null,
  RESERVED: null,
  ACCEPTED: "ACCEPTED",
  SUBMITTED: "SUBMITTED",
  DISPUTED: "DISPUTED",
  APPROVED: "TERMINAL",
  CANCELLED: "TERMINAL",
};

/**
 * The order row phase a chain phase projects onto, or null when no `orders`
 * row exists at that chain phase (DEPLOYED, RESERVED).
 */
export function toOrderRowPhase(
  chainPhase: ChainOrderPhase,
): OrderRowPhase | null {
  return CHAIN_TO_ROW[chainPhase];
}

/**
 * Every chain phase that projects onto `rowPhase`.
 *
 * This is not an inverse. For ACCEPTED, SUBMITTED and DISPUTED it happens to
 * be a single phase and the round trip holds; for TERMINAL it is two phases
 * and the round trip is information-losing. Call `isLossy` before relying on a
 * round trip.
 */
export function chainPhasesForOrderRowPhase(
  rowPhase: OrderRowPhase,
): ChainOrderPhase[] {
  return CHAIN_ORDER_PHASES.filter(
    (chainPhase) => CHAIN_TO_ROW[chainPhase] === rowPhase,
  );
}

/** True when `rowPhase` has more than one chain phase behind it. */
export function isLossy(rowPhase: OrderRowPhase): boolean {
  return chainPhasesForOrderRowPhase(rowPhase).length > 1;
}

/** Whether an `orders` row in this phase can still change. */
export function isTerminal(rowPhase: OrderRowPhase): boolean {
  return rowPhase === "TERMINAL";
}

/** The settlement action a chain phase opens, or null when it opens none. */
export function settlementActionFor(
  chainPhase: ChainOrderPhase,
): "capture" | "void" | null {
  if (chainPhase === "APPROVED") return "capture";
  if (chainPhase === "CANCELLED") return "void";
  return null;
}

export function isChainOrderPhase(value: unknown): value is ChainOrderPhase {
  return (
    typeof value === "string" &&
    (CHAIN_ORDER_PHASES as readonly string[]).includes(value)
  );
}

export function isOrderRowPhase(value: unknown): value is OrderRowPhase {
  return (
    typeof value === "string" &&
    (ORDER_ROW_PHASES as readonly string[]).includes(value)
  );
}
