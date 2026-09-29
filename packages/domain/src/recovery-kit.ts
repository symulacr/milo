/**
 * Pure client recovery-kit state machine for one order. It has no storage,
 * clock, wallet, chain or provider authority: the browser persists it and
 * Convex stores only the non-secret identifiers it mirrors
 * (06-backend-design section 5.2; blueprint section 5.5).
 */
export type RecoveryStage = "EXPORTED" | "VERIFIED" | "CHECKPOINTED" | "LOST";
export type RecoveryOperation = "deploy" | "reserve" | "submit" | "approve";
export type KitStatus = "unprepared" | "ready" | "interrupted" | "lost";

export interface KitScope {
  actorId: string;
  network: string;
  orderNonce: string;
}

export interface PendingOperation {
  operation: RecoveryOperation;
  identity: string;
  revision: number;
}

export interface RecoveryKit extends KitScope {
  stage: RecoveryStage;
  address: string | null;
  pending: PendingOperation | null;
  appliedRevision: number;
  usable: boolean;
  requiresReconciliation: boolean;
}

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${label} is required`);
  return value;
};

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const copy = (kit: RecoveryKit): RecoveryKit => ({
  ...kit,
  pending: kit.pending ? { ...kit.pending } : null,
});

/** The one scope-identity decision, shared by verification, restore and the browser's record check. */
export const sameScope = (kit: KitScope, scope: KitScope): boolean =>
  kit.actorId === scope?.actorId &&
  kit.network === scope?.network &&
  kit.orderNonce === scope?.orderNonce;

/** Exports a predeployment kit bound to actor, network and order nonce. */
export function createKit(scope: KitScope): RecoveryKit {
  const kit = {
    actorId: nonEmpty(scope?.actorId, "kit actor"),
    network: nonEmpty(scope?.network, "kit network"),
    orderNonce: nonEmpty(scope?.orderNonce, "kit order nonce"),
  };
  return {
    ...kit,
    stage: "EXPORTED",
    address: null,
    pending: null,
    appliedRevision: 0,
    usable: false,
    requiresReconciliation: false,
  };
}

/** The isolated-scope verification; a wrong actor/network/order cannot unlock the kit. */
export function verifyKit(kit: RecoveryKit, scope: KitScope): RecoveryKit {
  require(kit.stage === "EXPORTED", "kit is not awaiting verification");
  require(sameScope(kit, scope), "kit scope mismatch");
  return { ...copy(kit), stage: "VERIFIED" };
}

/** Binds the admitted canonical address after a confirmed deployment; never the nonce. */
export function checkpointAddress(
  kit: RecoveryKit,
  address: string,
): RecoveryKit {
  require(kit.stage === "VERIFIED", "address bound before verification");
  const bound = nonEmpty(address, "canonical address");
  const boundIsNonce = bound === kit.orderNonce;
  require(!boundIsNonce, "an order nonce is not a canonical address");
  return { ...copy(kit), stage: "CHECKPOINTED", address: bound };
}

/**
 * Records an in-flight operation, refusing a second one until the first is
 * confirmed or abandoned. Every begin leaves the kit unusable.
 */
export function beginOperation(
  kit: RecoveryKit,
  operation: RecoveryOperation,
  identity: string,
  revision: number,
): RecoveryKit {
  require(kit.pending === null, "an operation is already pending");
  require(operation !== "deploy" ||
    kit.stage === "VERIFIED", "deploy needs a verified kit");
  require(operation === "deploy" ||
    kit.stage ===
      "CHECKPOINTED", "a commercial operation needs a bound address");
  nonEmpty(identity, "operation identity");
  require(Number.isSafeInteger(revision) &&
    revision >= kit.appliedRevision, "operation revision is stale");
  return {
    ...copy(kit),
    pending: { operation, identity, revision },
    usable: false,
    requiresReconciliation: false,
  };
}

/** Reconciles the retained identity; it never resubmits and never marks the order usable. */
export function resumeOperation(kit: RecoveryKit): PendingOperation {
  require(kit.pending !== null, "no interrupted operation to resume");
  return { ...kit.pending };
}

/**
 * Applies the confirmed private-state update exactly once, only on the expected
 * identity and revision. A deployment alone never yields a usable order.
 */
export function confirmOperation(
  kit: RecoveryKit,
  identity: string,
  revision: number,
): RecoveryKit {
  const pending = kit.pending;
  require(pending !== null, "no pending operation to confirm");
  require(pending.identity === identity &&
    pending.revision ===
      revision, "observed transition does not match the pending operation");
  require(revision >=
    kit.appliedRevision, "stale revision cannot overwrite newer state");
  require(pending.operation === "deploy" ||
    kit.stage ===
      "CHECKPOINTED", "commercial confirmation needs a bound address");
  return {
    ...copy(kit),
    pending: null,
    appliedRevision: revision,
    usable: pending.operation !== "deploy",
    requiresReconciliation: false,
  };
}

/**
 * Abandons the retained operation. Aborting cannot cancel a possibly submitted
 * transaction, so it always requests reconciliation and never yields a usable order.
 */
export function abandonOperation(kit: RecoveryKit): RecoveryKit {
  require(kit.pending !== null, "no operation to abandon");
  return {
    ...copy(kit),
    pending: null,
    usable: false,
    requiresReconciliation: true,
  };
}

/** Lost or conflicted capability; the pending identity is kept for support reconciliation. */
export function loseCapability(kit: RecoveryKit): RecoveryKit {
  require(kit.stage !== "LOST", "capability is already lost");
  return {
    ...copy(kit),
    stage: "LOST",
    usable: false,
    requiresReconciliation: kit.requiresReconciliation || kit.pending !== null,
  };
}

/** Restores a matching backup. It never re-grants a usable order by itself. */
export function restoreKit(kit: RecoveryKit, scope: KitScope): RecoveryKit {
  require(kit.stage === "LOST", "kit is not lost");
  require(sameScope(kit, scope), "restored backup belongs to another scope");
  return {
    ...copy(kit),
    stage: kit.address ? "CHECKPOINTED" : "VERIFIED",
    usable: false,
  };
}

/**
 * Adopts a same-scope backup only when it does not roll back newer active state:
 * a backup behind the active confirmed revision, or lacking an address the active
 * kit bound, is refused (06 6.2). The pure half of the browser import path.
 */
export function adoptBackup(
  active: RecoveryKit,
  backup: RecoveryKit,
): RecoveryKit {
  require(sameScope(active, backup), "backup belongs to another scope");
  const rolledBack =
    backup.appliedRevision < active.appliedRevision ||
    (active.address !== null && backup.address === null);
  return copy(rolledBack ? active : backup);
}

export function kitStatus(kit: RecoveryKit): KitStatus {
  if (kit.stage === "LOST") return "lost";
  if (kit.pending !== null) return "interrupted";
  return kit.usable ? "ready" : "unprepared";
}
