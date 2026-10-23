import type {
  KitScope,
  PendingOperation,
  RecoveryKit,
} from "../../../packages/domain/src/recovery-kit";

const KEY_PREFIX = "milo.recovery-kit.";
const STAGES = new Set(["EXPORTED", "VERIFIED", "CHECKPOINTED", "LOST"]);
const OPERATIONS = new Set(["deploy", "reserve", "submit", "approve"]);

export const RECOVERY_KIT_CHANGED = "milo:recovery-kit-changed";

export function emitRecoveryKitChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(RECOVERY_KIT_CHANGED));
}

export function subscribeKitChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener(RECOVERY_KIT_CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RECOVERY_KIT_CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function recoveryKey(scope: KitScope): string {
  return `${KEY_PREFIX}${scope.actorId}.${scope.network}.${scope.orderNonce}`;
}

function validPending(value: unknown): value is PendingOperation | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<PendingOperation>;
  return (
    OPERATIONS.has(pending.operation as string) &&
    typeof pending.identity === "string" &&
    pending.identity.trim().length > 0 &&
    Number.isSafeInteger(pending.revision)
  );
}

function isKit(value: unknown, scope: KitScope): value is RecoveryKit {
  if (!value || typeof value !== "object") return false;
  const kit = value as Partial<RecoveryKit>;
  return (
    STAGES.has(kit.stage as string) &&
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
