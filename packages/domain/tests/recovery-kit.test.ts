import { describe, expect, test } from "bun:test";
import {
  abandonOperation,
  adoptBackup,
  beginOperation,
  checkpointAddress,
  confirmOperation,
  createKit,
  kitStatus,
  loseCapability,
  type RecoveryKit,
  restoreKit,
  resumeOperation,
  sameScope,
  verifyKit,
} from "../src/recovery-kit";

const scope = {
  actorId: "did:privy:buyer",
  network: "preprod",
  orderNonce: "order-42",
};

function verified(): RecoveryKit {
  return verifyKit(createKit(scope), scope);
}

function checkpointed(address = "0xdeployed"): RecoveryKit {
  return checkpointAddress(verified(), address);
}

/** The seven recovery-kit operations the UI must wire or justify. */
export const SEVEN_RECOVERY_KIT_OPS = [
  "beginOperation",
  "resumeOperation",
  "confirmOperation",
  "abandonOperation",
  "loseCapability",
  "restoreKit",
  "adoptBackup",
] as const;

describe("recovery-kit seven-op surface", () => {
  test("exposes exactly the seven named recovery operations as callables", async () => {
    const mod = await import("../src/recovery-kit");
    for (const op of SEVEN_RECOVERY_KIT_OPS) {
      expect(typeof (mod as Record<string, unknown>)[op]).toBe("function");
    }
  });
});

describe("no-usable-order property", () => {
  test("create, verify and checkpoint never yield a usable order", () => {
    expect(createKit(scope).usable).toBe(false);
    expect(verified().usable).toBe(false);
    expect(checkpointed().usable).toBe(false);
  });

  test("beginOperation always leaves the kit unusable", () => {
    for (const operation of [
      "deploy",
      "reserve",
      "submit",
      "approve",
    ] as const) {
      const base = operation === "deploy" ? verified() : checkpointed();
      const begun = beginOperation(base, operation, `tx-${operation}`, 1);
      expect(begun.usable).toBe(false);
      expect(begun.pending).not.toBeNull();
    }
  });

  test("resumeOperation never marks the order usable", () => {
    const pending = beginOperation(checkpointed(), "reserve", "tx-a", 1);
    const identity = resumeOperation(pending);
    expect(identity.identity).toBe("tx-a");
    expect(pending.usable).toBe(false);
  });

  test("deploy confirmation alone never yields a usable order", () => {
    const begun = beginOperation(verified(), "deploy", "tx-deploy", 1);
    const confirmed = confirmOperation(begun, "tx-deploy", 1);
    expect(confirmed.usable).toBe(false);
    expect(confirmed.pending).toBeNull();
  });

  test("commercial confirmation is the only path to a usable order", () => {
    const begun = beginOperation(checkpointed(), "reserve", "tx-reserve", 1);
    const confirmed = confirmOperation(begun, "tx-reserve", 1);
    expect(confirmed.usable).toBe(true);
  });

  test("abandon, lose, restore and adoptBackup never grant usability", () => {
    const pending = beginOperation(checkpointed(), "reserve", "tx-a", 1);
    expect(abandonOperation(pending).usable).toBe(false);
    expect(loseCapability(checkpointed()).usable).toBe(false);

    const lost = loseCapability(
      beginOperation(checkpointed(), "reserve", "tx-a", 1),
    );
    const restored = restoreKit(lost, scope);
    expect(restored.usable).toBe(false);

    const backup = {
      ...checkpointed(),
      appliedRevision: 0,
      usable: false,
    };
    const adopted = adoptBackup(checkpointed(), backup);
    expect(adopted.usable).toBe(false);
  });

  test("adoptBackup refuses a backup that would roll back newer active state", () => {
    const active = {
      ...beginOperation(checkpointed(), "reserve", "tx-a", 1),
      appliedRevision: 5,
      usable: false,
    };
    const stale = { ...checkpointed(), appliedRevision: 1, usable: true };
    expect(adoptBackup(active, stale)).toEqual(active);
  });

  test("kitStatus never reports ready without a usable commercial confirmation", () => {
    expect(kitStatus(createKit(scope))).toBe("unprepared");
    expect(kitStatus(checkpointed())).toBe("unprepared");
    expect(kitStatus(beginOperation(checkpointed(), "reserve", "tx", 1))).toBe(
      "interrupted",
    );
    expect(kitStatus(loseCapability(checkpointed()))).toBe("lost");
    const ready = confirmOperation(
      beginOperation(checkpointed(), "reserve", "tx", 1),
      "tx",
      1,
    );
    expect(kitStatus(ready)).toBe("ready");
  });

  test("sameScope is the one scope-identity decision", () => {
    expect(sameScope(scope, { ...scope })).toBe(true);
    expect(sameScope(scope, { ...scope, orderNonce: "other" })).toBe(false);
    expect(sameScope(scope, { ...scope, network: "testnet" })).toBe(false);
    expect(sameScope(scope, { ...scope, actorId: "other" })).toBe(false);
  });
});
