/**
 * Browser QA harness for RecoveryKitPanel / BuyerReserveSection fail-closed UI.
 * Mounts the REAL product components with a Privy stub and a switchable
 * window.midnight Lace mock. Not part of the product entry graph.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RecoveryKit } from "../../../packages/domain/src/recovery-kit";
import {
  beginReserveOperation,
  confirmObservedReserve,
} from "./buyer-reserve-runtime";
import { BuyerReserveSection, RecoveryKitPanel } from "./RecoveryKitPanel";

// ---------------------------------------------------------------------------
// window.midnight Lace mock (dapp-connector-api v4 shape)
// ---------------------------------------------------------------------------

type MockMode = "none" | "reject" | "wrong-network" | "locked" | "connected";

function installMidnightMock(mode: MockMode) {
  const w = window as unknown as { midnight?: Record<string, unknown> };
  if (mode === "none") {
    delete w.midnight;
    return;
  }
  const connect = async (_network: string) => {
    if (mode === "reject") throw new Error("User rejected the connection");
    if (mode === "locked") throw new Error("Wallet is locked");
    return {
      getConnectionStatus: async () =>
        mode === "wrong-network"
          ? { status: "connected", networkId: "mainnet" }
          : { status: "connected", networkId: "preprod" },
      getConfiguration: async () =>
        mode === "wrong-network"
          ? { networkId: "mainnet" }
          : { networkId: "preprod" },
      getUnshieldedAddress: async () => ({
        unshieldedAddress: "addr_test1_qa_unshielded",
      }),
      hintUsage: async () => {},
    };
  };
  w.midnight = {
    "qa-lace-mock": { apiVersion: "4.0.0", name: "QA Lace Mock", connect },
  };
}

installMidnightMock("none");

// ---------------------------------------------------------------------------
// Runtime probes with a shared kit so double-submit and stale revision are real
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __QA__?: {
      log: (tag: string, message: string) => void;
      setWalletMode: (mode: MockMode) => void;
      runConfirmNoObservation: () => void;
      runBegin: (identity: string, revision: number) => void;
      rows: { tag: string; message: string }[];
    };
  }
}

const rows: { tag: string; message: string }[] = [];
function log(tag: string, message: string) {
  rows.push({ tag, message });
  const el = document.getElementById("qa-log");
  if (el)
    el.textContent = rows.map((r) => `[${r.tag}] ${r.message}`).join("\n");
  console.log("[QA]", tag, message);
}

function baseKit(): RecoveryKit {
  return {
    actorId: "did:privy:qa-buyer",
    network: "preprod",
    orderNonce: "qa-order",
    stage: "CHECKPOINTED",
    address: "0xqa",
    pending: null,
    appliedRevision: 5,
    usable: true,
    requiresReconciliation: false,
  };
}

function checkpointedFixture(): RecoveryKit {
  return {
    ...baseKit(),
    address: "0xqa_deployed_contract",
  };
}

let sharedKit: RecoveryKit = baseKit();

window.__QA__ = {
  log,
  rows,
  setWalletMode: (mode: MockMode) => {
    installMidnightMock(mode);
    log("wallet-mode", `window.midnight mock set to ${mode}`);
    window.dispatchEvent(new CustomEvent("qa-remount"));
  },
  runConfirmNoObservation: () => {
    const result = confirmObservedReserve(sharedKit, null);
    log("confirm-no-observation", JSON.stringify(result));
  },
  runBegin: (identity: string, revision: number) => {
    try {
      const next = beginReserveOperation(sharedKit, identity, revision);
      sharedKit = next.ok ? next.kit : sharedKit;
      log("begin", JSON.stringify(next));
    } catch (error) {
      log(
        "begin-error",
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};

// remount bump so BuyerReserveSection re-reads discoverWallets(window.midnight)
function useRemountBump() {
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const handler = () => setBump((b) => b + 1);
    window.addEventListener("qa-remount", handler);
    return () => window.removeEventListener("qa-remount", handler);
  }, []);
  return bump;
}

function Shell() {
  const bump = useRemountBump();
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 920,
        margin: "24px auto",
        lineHeight: 1.45,
      }}
    >
      <h1>QA · RecoveryKitPanel fail-closed browser proof</h1>
      <p data-testid="qa-banner">
        Real RecoveryKitPanel + BuyerReserveSection with Privy stub and Lace
        mock. No signature is requested. No reserve is claimed complete.
      </p>
      <section
        style={{
          border: "1px solid #ccc",
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <h2>Wallet mock</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            ["none", "reject", "wrong-network", "locked", "connected"] as const
          ).map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`wallet-${mode}`}
              onClick={() => window.__QA__?.setWalletMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>
      <section
        style={{
          border: "1px solid #ccc",
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <h2>Runtime probes</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="confirm-no-obs"
            onClick={() => window.__QA__?.runConfirmNoObservation()}
          >
            Confirm without observation
          </button>
          <button
            type="button"
            data-testid="reset-kit"
            onClick={() => {
              sharedKit = baseKit();
              log("reset-kit", "shared kit reset to pending=null applied=5");
            }}
          >
            Reset shared kit
          </button>
          <button
            type="button"
            data-testid="begin-ok"
            onClick={() => window.__QA__?.runBegin("tx-ok", 5)}
          >
            Begin @rev 5 (on applied 5)
          </button>
          <button
            type="button"
            data-testid="begin-stale"
            onClick={() => window.__QA__?.runBegin("tx-stale", 1)}
          >
            Begin @rev 1 STALE
          </button>
          <button
            type="button"
            data-testid="begin-dup"
            onClick={() => {
              window.__QA__?.runBegin("tx-first", 5);
              window.__QA__?.runBegin("tx-second", 5);
            }}
          >
            Double submit (two begins)
          </button>
        </div>
      </section>
      <section
        style={{
          border: "1px solid #000",
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <h2>RecoveryKitPanel (product)</h2>
        <div data-testid="panel-host">
          <RecoveryKitPanel />
        </div>
      </section>
      <section
        style={{ border: "1px dashed #666", padding: 12, borderRadius: 8 }}
      >
        <h2>BuyerReserveSection (product, checkpointed kit)</h2>
        <div data-testid="reserve-host" key={`reserve-${bump}`}>
          <BuyerReserveSection kit={checkpointedFixture()} onBegin={() => {}} />
        </div>
      </section>
      <section
        style={{ border: "1px dashed #666", padding: 12, borderRadius: 8 }}
      >
        <h2>BuyerReserveSection (product, kit=null)</h2>
        <BuyerReserveSection kit={null} onBegin={() => {}} />
      </section>
      <h2>QA log</h2>
      <pre
        id="qa-log"
        data-testid="qa-log"
        style={{
          background: "#111",
          color: "#9f9",
          padding: 12,
          minHeight: 120,
          whiteSpace: "pre-wrap",
        }}
      />
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");
createRoot(rootEl).render(<Shell />);
