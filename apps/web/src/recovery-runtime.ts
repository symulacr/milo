import type {
  KitScope,
  PendingOperation,
  RecoveryKit,
} from "../../../packages/domain/src/recovery-kit";

/**
 * Browser-side persistence for the pure recovery-kit state machine
 * (packages/domain/src/recovery-kit.ts, 06-backend-design section 5.2). It uses
 * the platform's own storage API directly - no storage library and no wrapper
 * over the browser - and it never writes a capability: the record holds only
 * the actor, network, order nonce, stage, the pending operation's identity and
 * revision, and status flags (01-blueprint:762). Anything that must cross the
 * network would use native fetch; the only cross-network read the recovery
 * context needs is a Convex operations query, which does not exist yet
 * (OFFCHAIN-POLICY BP-02), so no request is made and that absent endpoint is
 * named in the UI instead of being simulated.
 */
const KEY_PREFIX = "milo.recovery-kit.";

/** Same-document kit-change ping (storage events do not fire for same-tab writes). */
export const RECOVERY_KIT_CHANGED = "milo:recovery-kit-changed";

export function emitRecoveryKitChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(RECOVERY_KIT_CHANGED));
}
const STAGES = ["EXPORTED", "VERIFIED", "CHECKPOINTED", "LOST"] as const;
const OPERATIONS = ["deploy", "reserve", "submit", "approve"] as const;

export function recoveryKey(scope: KitScope): string {
  return `${KEY_PREFIX}${scope.actorId}.${scope.network}.${scope.orderNonce}`;
}

function validPending(value: unknown): value is PendingOperation | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<PendingOperation>;
  return (
    OPERATIONS.includes(pending.operation as (typeof OPERATIONS)[number]) &&
    typeof pending.identity === "string" &&
    pending.identity.trim().length > 0 &&
    Number.isSafeInteger(pending.revision)
  );
}

/**
 * Structural and scope check. A corrupt, partial or foreign-scope record is
 * never a kit, so a stale backup can never unlock another order's context.
 * Every field of RecoveryKit is checked, so the predicate can narrow instead of
 * a cast asserting validity.
 */
function isKit(value: unknown, scope: KitScope): value is RecoveryKit {
  if (!value || typeof value !== "object") return false;
  const kit = value as Partial<RecoveryKit>;
  return (
    STAGES.includes(kit.stage as (typeof STAGES)[number]) &&
    kit.actorId === scope.actorId &&
    kit.network === scope.network &&
    kit.orderNonce === scope.orderNonce &&
    typeof kit.appliedRevision === "number" &&
    typeof kit.usable === "boolean" &&
    typeof kit.requiresReconciliation === "boolean" &&
    validPending(kit.pending) &&
    (kit.address === null || typeof kit.address === "string")
  );
}

export function parseKit(raw: string, scope: KitScope): RecoveryKit | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return isKit(value, scope) ? value : null;
}

export function readKit(
  scope: KitScope,
  storage: Storage | undefined = platformStorage(),
): RecoveryKit | null {
  const raw = storage?.getItem(recoveryKey(scope));
  return raw ? parseKit(raw, scope) : null;
}

export function writeKit(
  scope: KitScope,
  kit: RecoveryKit,
  storage: Storage | undefined = platformStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(recoveryKey(scope), JSON.stringify(kit));
    return true;
  } catch {
    // Storage can be full or disabled (private mode); the caller reports it.
    return false;
  }
}

export function forgetKit(
  scope: KitScope,
  storage: Storage | undefined = platformStorage(),
): void {
  storage?.removeItem(recoveryKey(scope));
}

function platformStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
