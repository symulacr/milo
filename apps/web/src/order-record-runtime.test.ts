import { describe, expect, test } from "bun:test";
import {
  type ChainOrderRecord,
  describeOrderRecord,
  describeUnconfiguredOrderRecord,
  OrderRecordController,
  type OrderRecordTransport,
  orderRecordProvenance,
} from "./order-record-runtime";

const record: ChainOrderRecord = {
  orderId: "order_1",
  network: "preprod",
  address: "0xabc123",
  phase: "RESERVED",
  revision: 1,
  deliveryManifest: null,
  observedAt: 1_700_000_000_000,
  fresh: true,
  fileCount: 0,
};

describe("describeOrderRecord — no phase without a backing record", () => {
  test("empty quote is absent and carries no phase field", () => {
    const view = describeOrderRecord("", { status: "idle" });
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("no-quote");
    expect("phase" in view).toBe(false);
    expect("checkpointAddress" in view).toBe(false);
    expect(view.message).toContain("No phase is shown");
  });

  test("loading never yields a phase label", () => {
    const view = describeOrderRecord("q-1", { status: "loading" });
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("loading");
    expect("phase" in view).toBe(false);
  });

  test("error never yields a phase label", () => {
    const view = describeOrderRecord("q-1", { status: "error" });
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("error");
    expect("phase" in view).toBe(false);
  });

  test("null projection row is missing, not a default phase", () => {
    const view = describeOrderRecord("q-1", { status: "result", record: null });
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("missing");
    expect("phase" in view).toBe(false);
    expect(view.message).toContain("A1 ingest");
  });

  test("empty address is missing — phase cannot appear without a usable record", () => {
    const view = describeOrderRecord("q-1", {
      status: "result",
      record: { ...record, address: "" },
    });
    expect(view.kind).toBe("absent");
  });

  test("a real projection row yields phase and checkpoint address together", () => {
    const view = describeOrderRecord("q-1", { status: "result", record });
    expect(view.kind).toBe("record");
    if (view.kind !== "record") throw new Error("unreachable");
    expect(view.phase).toBe("RESERVED");
    expect(view.checkpointAddress).toBe("0xabc123");
    expect(view.phaseLabel).toContain("RESERVED");
    expect(view.phaseLabel).toContain("order_1");
  });

  test("unconfigured Convex names the missing deployment and withholds phase", () => {
    const view = describeUnconfiguredOrderRecord();
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("unconfigured");
    expect("phase" in view).toBe(false);
    expect(view.message).toContain("Convex is not configured");
  });
});

describe("OrderRecordController wiring (transport path)", () => {
  function harness(result: ChainOrderRecord | null | Error) {
    const calls: string[] = [];
    const transport: OrderRecordTransport = {
      read: async ({ quoteId }) => {
        calls.push(quoteId);
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return { controller: new OrderRecordController(transport), calls };
  }

  test("refresh loads the projection and view exposes phase only after a record", async () => {
    const { controller, calls } = harness(record);
    controller.setQuoteId("quote-live");
    expect(controller.view().kind).toBe("absent");
    const pending = controller.refresh();
    expect(controller.view().kind).toBe("absent");
    expect(controller.view()).toMatchObject({ reason: "loading" });
    await pending;
    expect(calls).toEqual(["quote-live"]);
    const view = controller.view();
    expect(view.kind).toBe("record");
    if (view.kind !== "record") throw new Error("unreachable");
    expect(view.checkpointAddress).toBe(record.address);
    expect(view.phase).toBe(record.phase);
  });

  test("transport error stays absent with no phase", async () => {
    const { controller } = harness(new Error("convex down"));
    controller.setQuoteId("quote-err");
    await controller.refresh();
    const view = controller.view();
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("error");
  });

  test("null row stays absent with no phase", async () => {
    const { controller } = harness(null);
    controller.setQuoteId("quote-empty");
    await controller.refresh();
    const view = controller.view();
    expect(view.kind).toBe("absent");
    if (view.kind !== "absent") throw new Error("unreachable");
    expect(view.reason).toBe("missing");
  });

  test("empty quote never calls the transport", async () => {
    const { controller, calls } = harness(record);
    await controller.refresh();
    expect(calls).toEqual([]);
  });
});

describe("A1 ingest provenance is stated for diagnostics", () => {
  test("provenance names observationIngest and the orders projection", () => {
    const text = orderRecordProvenance();
    expect(text).toContain("A1 ingest");
    expect(text).toContain("observationIngest");
    expect(text).toContain("orders");
  });
});
