import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  checkpointAddress,
  createKit,
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

/** Presentational pieces do not touch Privy and can render directly. */
async function loadSections() {
  const mod = await import("./RecoveryKitPanel");
  return {
    CheckpointSection: mod.CheckpointSection,
    BuyerReserveSection: mod.BuyerReserveSection,
    RecoveryKitPanel: mod.RecoveryKitPanel,
  };
}

type PrivyAuthState = {
  authenticated: boolean;
  user: { id: string } | undefined;
};

let privyState: PrivyAuthState = { authenticated: false, user: undefined };

beforeAll(() => {
  mock.module("@privy-io/react-auth", () => ({
    usePrivy: () => privyState,
    useLogin: () => ({ login: () => {} }),
    PrivyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  }));
});

describe("CheckpointSection blocked states", () => {
  test("no kit renders nothing", async () => {
    const { CheckpointSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <CheckpointSection kit={null} onCheckpoint={() => {}} />,
    );
    expect(markup).toBe("");
  });

  test("exported kit is not offered a checkpoint control", async () => {
    const { CheckpointSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <CheckpointSection kit={createKit(scope)} onCheckpoint={() => {}} />,
    );
    expect(markup).toBe("");
  });

  test("verified kit with no observation shows deployment-not-observable copy", async () => {
    const { CheckpointSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <CheckpointSection kit={verifiedKit()} onCheckpoint={() => {}} />,
    );
    expect(markup).toContain("Checkpoint canonical address");
    expect(markup).toContain("will not invent");
    expect(markup).toContain("No confirmed deployment is observable");
    expect(markup).toContain("Checkpoint address");
    // The action is rendered but the gate is empty: no ready path without an address.
    expect(markup).toContain("disabled");
  });

  test("help text refuses the order nonce as an address", async () => {
    const { CheckpointSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <CheckpointSection kit={verifiedKit()} onCheckpoint={() => {}} />,
    );
    expect(markup).toContain("An order nonce is never accepted as an address");
  });

  test("already-checkpointed kit names the already-bound reason", async () => {
    const { CheckpointSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <CheckpointSection kit={checkpointedKit()} onCheckpoint={() => {}} />,
    );
    expect(markup).toContain("already bound to a canonical address");
  });
});

describe("BuyerReserveSection blocked states", () => {
  test("without a kit the prepare gate names the missing context", async () => {
    const { BuyerReserveSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={null} onBegin={() => {}} />,
    );
    expect(markup).toContain("Buyer reserve");
    expect(markup).toContain("Create, verify and checkpoint");
    expect(markup).toContain("descriptor only");
    expect(markup).toContain("Wallet-signed reserve runtime: UNKNOWN");
  });

  test("verified-but-uncheckpointed kit blocks reserve preparation", async () => {
    const { BuyerReserveSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={verifiedKit()} onBegin={() => {}} />,
    );
    expect(markup).toContain("bound canonical address");
    expect(markup).toContain("Checkpoint an observed deployment address");
  });

  test("disconnected wallet is named before prepare is offered", async () => {
    const { BuyerReserveSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={checkpointedKit()} onBegin={() => {}} />,
    );
    expect(markup).toContain("Midnight Lace");
    expect(markup).toContain("Not connected");
    expect(markup).toContain("Prepare reserve call");
    expect(markup).toContain("disabled");
  });

  test("never claims a completed reserve without a signed transaction", async () => {
    const { BuyerReserveSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={checkpointedKit()} onBegin={() => {}} />,
    );
    expect(markup).not.toContain("reserve succeeded");
    expect(markup).not.toContain("Reserve complete");
    expect(markup).toContain("without a real signed transaction");
  });

  test("in-flight tracking warns against invented identities", async () => {
    const { BuyerReserveSection } = await loadSections();
    const markup = renderToStaticMarkup(
      <BuyerReserveSection kit={checkpointedKit()} onBegin={() => {}} />,
    );
    expect(markup).toContain("never invents one");
    expect(markup).toContain("Begin reserve operation");
    expect(markup).toContain("Confirm from observation");
  });
});

describe("RecoveryKitPanel honesty under mocked Privy", () => {
  test("unauthenticated panel does not offer reserve or checkpoint", async () => {
    privyState = { authenticated: false, user: undefined };
    const { RecoveryKitPanel } = await loadSections();
    const markup = renderToStaticMarkup(<RecoveryKitPanel />);
    expect(markup).toContain("Sign in above to bind the order actor");
    expect(markup).not.toContain("Buyer reserve");
    expect(markup).not.toContain("Checkpoint canonical address");
    expect(markup).toContain("Unavailable —");
  });

  test("authenticated panel surfaces blocked reserve copy and honest lifecycle", async () => {
    privyState = { authenticated: true, user: { id: "did:privy:buyer" } };
    const { RecoveryKitPanel } = await loadSections();
    const markup = renderToStaticMarkup(<RecoveryKitPanel />);
    expect(markup).toContain("Order recovery context");
    expect(markup).toContain("Buyer reserve");
    expect(markup).toContain("Wallet-signed reserve runtime: UNKNOWN");
    expect(markup).toContain("Unavailable —");
    expect(markup).not.toContain("Reserve succeeded");
    expect(markup).not.toContain("Order placed");
    // Remaining lifecycle steps stay explicitly unavailable.
    expect(markup).toContain("Merchant accepts and submits the delivery");
    expect(markup).toContain("Buyer approves or opens a dispute");
    expect(markup).toContain("Capture or void the payment");
  });
});

describe("happy-dom window is available for browser APIs", () => {
  test("localStorage is usable for kit persistence checks", () => {
    const win = new Window();
    win.localStorage.setItem("milo.recovery-kit.test", "value");
    expect(win.localStorage.getItem("milo.recovery-kit.test")).toBe("value");
    expect(win.localStorage.getItem("milo.other")).toBeNull();
  });
});
