import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderRecordControls } from "./OrderRecordPanel";
import type {
  ChainOrderRecord,
  OrderRecordTransport,
} from "./order-record-runtime";

const record: ChainOrderRecord = {
  orderId: "order_1",
  network: "preprod",
  address: "0xproj",
  phase: "DEPLOYED",
  revision: 0,
  deliveryManifest: null,
  observedAt: 1_700_000_000_000,
  fresh: false,
  fileCount: 2,
};

function transportOf(
  result: ChainOrderRecord | null | Error,
): OrderRecordTransport {
  return {
    read: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("OrderRecordControls honesty", () => {
  test("idle surface withholds every phase label", () => {
    const markup = renderToStaticMarkup(
      <OrderRecordControls transport={transportOf(record)} />,
    );
    expect(markup).toContain("Chain-backed order record");
    expect(markup).toContain("no phase");
    expect(markup).toContain('data-order-record="absent"');
    expect(markup).not.toContain('data-order-record="record"');
    expect(markup).not.toContain("Phase DEPLOYED");
    expect(markup).not.toContain("Phase RESERVED");
  });

  test("unconfigured Convex names the gap and withholds phase", () => {
    const markup = renderToStaticMarkup(
      <OrderRecordControls transport={transportOf(null)} unconfigured />,
    );
    expect(markup).toContain("Convex is not configured");
    expect(markup).toContain("No phase");
    expect(markup).not.toContain("Phase DEPLOYED");
  });

  test("provenance names the A1 ingest path", () => {
    const markup = renderToStaticMarkup(
      <OrderRecordControls transport={transportOf(record)} />,
    );
    expect(markup).toContain("A1 ingest");
    expect(markup).toContain("observationIngest");
  });
});

describe("recovery-kit dead ops are marked unused, not simulated", () => {
  test("panel modules still export the live reserve path only (static check)", async () => {
    const mod = await import("./RecoveryKitPanel");
    // Presentational exports that the order console uses.
    expect(typeof mod.RecoveryKitPanel).toBe("function");
    expect(typeof mod.CheckpointSection).toBe("function");
    expect(typeof mod.BuyerReserveSection).toBe("function");
    expect(typeof mod.UNUSED_RECOVERY_KIT_OPS).toBe("object");
    expect(mod.UNUSED_RECOVERY_KIT_OPS.length).toBeGreaterThan(0);
    const names = mod.UNUSED_RECOVERY_KIT_OPS.map((entry) => entry.op);
    expect(names).toContain("resumeOperation");
    expect(names).toContain("abandonOperation");
    expect(names).toContain("restoreKit");
    expect(names).toContain("adoptBackup");
  });
});

// silence unused import in case of tree-shaking lint noise
void mock;
