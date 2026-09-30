import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  abandonOperation,
  beginOperation,
  checkpointAddress,
  confirmOperation,
  createKit,
  loseCapability,
  type RecoveryKit,
  verifyKit,
} from "../../../packages/domain/src/recovery-kit";

const scope = {
  actorId: "did:privy:buyer",
  network: "preprod",
  orderNonce: "order-42",
};

function verifiedKit(): RecoveryKit {
  return verifyKit(createKit(scope), scope);
}
function checkpointedKit(): RecoveryKit {
  return checkpointAddress(verifiedKit(), "0xdeployed");
}

type PrivyAuthState = {
  authenticated: boolean;
  user: { id: string } | undefined;
};
let privyState: PrivyAuthState = {
  authenticated: true,
  user: { id: "did:privy:buyer" },
};

beforeAll(() => {
  mock.module("@privy-io/react-auth", () => ({
    usePrivy: () => privyState,
    useLogin: () => ({ login: () => {} }),
    PrivyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  }));
});

/** The seven recovery-kit ops the panel must wire or justify in writing. */
const SEVEN = [
  "beginOperation",
  "resumeOperation",
  "confirmOperation",
  "abandonOperation",
  "loseCapability",
  "restoreKit",
  "adoptBackup",
] as const;

describe("M6: seven recovery-kit ops are wired or justified", () => {
  test("panel exports a complete RECOVERY_KIT_OPS inventory", async () => {
    const mod = await import("./RecoveryKitPanel");
    const ops = mod.RECOVERY_KIT_OPS as Array<{
      op: string;
      disposition: "ui-wired" | "justified";
      detail: string;
    }>;
    expect(Array.isArray(ops)).toBe(true);
    for (const op of SEVEN) {
      const entry = ops.find((row) => row.op === op || row.op.startsWith(op));
      expect(entry, `missing inventory row for ${op}`).toBeTruthy();
      expect(entry?.detail.length ?? 0).toBeGreaterThan(20);
      expect(["ui-wired", "justified"]).toContain(entry?.disposition);
    }
  });

  test("every justified op names why the UI refuses to simulate it", async () => {
    const mod = await import("./RecoveryKitPanel");
    const justified = (
      mod.RECOVERY_KIT_OPS as Array<{
        op: string;
        disposition: string;
        detail: string;
      }>
    ).filter((row) => row.disposition === "justified");
    expect(justified.length).toBeGreaterThan(0);
    for (const row of justified) {
      expect(row.detail).toMatch(/browser UI|no browser|not wired|Blocked|gated/i);
    }
  });

  test("panel markup presents the inventory and never silently drops an op", async () => {
    const { RecoveryKitPanel } = await import("./RecoveryKitPanel");
    privyState = { authenticated: true, user: { id: "did:privy:buyer" } };
    const markup = renderToStaticMarkup(<RecoveryKitPanel />);
    for (const op of SEVEN) {
      expect(markup).toContain(op);
    }
  });
});

describe("M6: no-usable-order property holds through the UI", () => {
  test("UI kit renders never claim a usable order without commercial confirm", async () => {
    const { RecoveryKitPanel, BuyerReserveSection } = await import(
      "./RecoveryKitPanel"
    );
    privyState = { authenticated: true, user: { id: "did:privy:buyer" } };

    const states: Array<{ label: string; kit: RecoveryKit | null }> = [
      { label: "missing", kit: null },
      { label: "created", kit: createKit(scope) },
      { label: "verified", kit: verifiedKit() },
      { label: "checkpointed", kit: checkpointedKit() },
      {
        label: "pending-reserve",
        kit: beginOperation(checkpointedKit(), "reserve", "tx-a", 1),
      },
      {
        label: "abandoned",
        kit: abandonOperation(
          beginOperation(checkpointedKit(), "reserve", "tx-a", 1),
        ),
      },
      { label: "lost", kit: loseCapability(checkpointedKit()) },
      {
        label: "deploy-confirmed",
        kit: confirmOperation(
          beginOperation(verifiedKit(), "deploy", "tx-d", 1),
          "tx-d",
          1,
        ),
      },
    ];

    for (const { label, kit } of states) {
      expect(kit?.usable ?? false, `${label} must not be usable`).toBe(false);
      const markup = renderToStaticMarkup(
        <BuyerReserveSection kit={kit} onBegin={() => {}} />,
      );
      // Affirmative usability claims only — honest negations in inventory copy
      // ("never yields a usable order") are required and must not trip this.
      expect(markup, label).not.toContain("Order is usable");
      expect(markup, label).not.toContain("order is now usable");
      expect(markup, label).not.toContain("ready to approve");
      expect(markup, label).not.toContain("reserve succeeded");
      const panel = renderToStaticMarkup(<RecoveryKitPanel />);
      expect(panel).not.toContain("Order is usable");
      expect(panel).not.toContain("order is now usable");
      expect(panel).not.toContain("reserve succeeded");
    }
  });

  test("confirm without a real observation cannot surface a usable order in UI", async () => {
    const { BuyerReserveSection } = await import("./RecoveryKitPanel");
    const pending = beginOperation(checkpointedKit(), "reserve", "tx-a", 1);
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={pending} onBegin={() => {}} />,
    );
    // The confirm control is present only for a pending reserve and the copy
    // refuses invented observations.
    expect(markup).toContain("Confirm from observation");
    expect(markup).toContain("never invents one");
    expect(markup).not.toContain("usable order");
    expect(pending.usable).toBe(false);
  });

  test("domain commercial confirm is the sole usable path, and UI does not auto-run it", async () => {
    const confirmed = confirmOperation(
      beginOperation(checkpointedKit(), "reserve", "tx-a", 1),
      "tx-a",
      1,
    );
    expect(confirmed.usable).toBe(true);
    // The panel itself does not apply a confirmation without an observation
    // source: runConfirm always receives null and fails closed.
    const { BuyerReserveSection } = await import("./RecoveryKitPanel");
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={confirmed} onBegin={() => {}} />,
    );
    expect(markup).toContain("Buyer reserve");
    expect(markup).not.toContain("Order is usable");
    expect(markup).not.toContain("reserve succeeded");
  });
});
