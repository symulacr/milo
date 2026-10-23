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

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const nonEmpty = (value: unknown, label: string): string => {
  require(typeof value === "string" &&
    value.trim().length > 0, `${label} is required`);
  return value as string;
};

const copy = (kit: RecoveryKit): RecoveryKit => ({
  ...kit,
  pending: kit.pending ? { ...kit.pending } : null,
});

export const sameScope = (kit: KitScope, scope: KitScope): boolean =>
  kit.actorId === scope?.actorId &&
  kit.network === scope?.network &&
  kit.orderNonce === scope?.orderNonce;

const STAGE_MESSAGES: Record<RecoveryStage, string> = {
  EXPORTED: "kit is not awaiting verification",
  VERIFIED: "address bound before verification",
  CHECKPOINTED: "a commercial operation needs a bound address",
  LOST: "kit is not lost",
};

const expectStage = (kit: RecoveryKit, stage: RecoveryStage): void =>
  require(kit.stage === stage, STAGE_MESSAGES[stage]);

export function createKit(scope: KitScope): RecoveryKit {
  return {
    actorId: nonEmpty(scope?.actorId, "kit actor"),
    network: nonEmpty(scope?.network, "kit network"),
    orderNonce: nonEmpty(scope?.orderNonce, "kit order nonce"),
    stage: "EXPORTED",
    address: null,
    pending: null,
    appliedRevision: 0,
    usable: false,
    requiresReconciliation: false,
  };
}

export function verifyKit(kit: RecoveryKit, scope: KitScope): RecoveryKit {
  expectStage(kit, "EXPORTED");
  require(sameScope(kit, scope), "kit scope mismatch");
  return { ...copy(kit), stage: "VERIFIED" };
}

export function checkpointAddress(
  kit: RecoveryKit,
  address: string,
): RecoveryKit {
  expectStage(kit, "VERIFIED");
  const bound = nonEmpty(address, "canonical address");
  require(bound !==
    kit.orderNonce, "an order nonce is not a canonical address");
  return { ...copy(kit), stage: "CHECKPOINTED", address: bound };
}

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

export function resumeOperation(kit: RecoveryKit): PendingOperation {
  require(kit.pending !== null, "no interrupted operation to resume");
  return { ...kit.pending };
}

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

export function abandonOperation(kit: RecoveryKit): RecoveryKit {
  require(kit.pending !== null, "no operation to abandon");
  return {
    ...copy(kit),
    pending: null,
    usable: false,
    requiresReconciliation: true,
  };
}

export function loseCapability(kit: RecoveryKit): RecoveryKit {
  require(kit.stage !== "LOST", "capability is already lost");
  return {
    ...copy(kit),
    stage: "LOST",
    usable: false,
    requiresReconciliation: kit.requiresReconciliation || kit.pending !== null,
  };
}

export function restoreKit(kit: RecoveryKit, scope: KitScope): RecoveryKit {
  expectStage(kit, "LOST");
  require(sameScope(kit, scope), "restored backup belongs to another scope");
  return {
    ...copy(kit),
    stage: kit.address ? "CHECKPOINTED" : "VERIFIED",
    usable: false,
  };
}

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
