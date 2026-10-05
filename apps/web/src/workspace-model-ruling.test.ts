import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Q9 (recon open question): is `apps/web/src/workspace/model.tsx` a simulator
 * or the real workspace store? Three sources disagreed and the code settles it.
 *
 * The answer is that BOTH the README and the workspace routing table are
 * half-right about different routes. The workspace app is a synthetic
 * simulator, and one route, `/connections`, is a real read-only console
 * living beside it. Calling the whole thing "a real read-only console" is
 * wrong; calling it "a simulator" without naming the exception is also wrong.
 *
 * These tests pin that ruling in code so a future edit cannot quietly turn the
 * simulator into something that claims to be real, or the console into
 * something that claims to write.
 */

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url).pathname, "utf8");

const modelSource = read("./workspace/model.tsx");
const appSource = read("./App.tsx");
const shellSource = read("./shells/WorkspaceShell.tsx");
const readme = read("../../../README.md");
const prototypeSource = read("../../../packages/domain/src/prototype.ts");

describe("Q9: model.tsx is a synthetic in-memory simulator", () => {
  test("it persists nothing", () => {
    // No storage of any kind. A reload rebuilds from the scenario fixture.
    for (const store of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
    ]) {
      expect(modelSource).not.toContain(store);
    }
  });

  test("it talks to no backend", () => {
    for (const transport of [
      "fetch(",
      "XMLHttpRequest",
      "convex",
      "Convex",
      "useQuery",
      "useQueries",
      "makeFunctionReference",
      "/api/",
    ]) {
      expect(modelSource).not.toContain(transport);
    }
  });

  test("its state comes from the synthetic fixture, not from an order", () => {
    expect(modelSource).toContain(
      'from "../../../../packages/domain/src/prototype"',
    );
    expect(modelSource).toContain("createScenario(");
    expect(modelSource).toContain("transition(");
    // The fixture module says so in its own first line.
    expect(prototypeSource).toContain(
      "it has no persistence or chain authority",
    );
  });

  test("its only cross-route persistence is the URL deep link", () => {
    expect(modelSource).toContain("useSearchParams");
    expect(modelSource).toContain("syncDeepLink");
  });
});

describe("Q9: the real read-only console is /connections, beside the simulator", () => {
  test("/connections is the one route that reaches a real backend", () => {
    // It lazy-loads PrivyConnection, which is the only component tree holding
    // PrivyProvider, ConvexProviderWithAuth and the order record.
    expect(read("./Connections.tsx")).toContain(
      'lazy(() => import("./PrivyConnection"))',
    );
    const backendComponents = ["OrderRecordPanel", "PaymentMonitoring"];
    for (const name of backendComponents) {
      expect(read("./PrivyConnection.tsx")).toContain(name);
    }
  });

  test("every other workspace route is prototype-only", () => {
    // All seven order/quote/account routes read useWorkspace() and nothing
    // else. If one of them ever imports a real backend, this fails and the
    // README has to be rewritten rather than silently falsified.
    for (const route of [
      "Orders",
      "OrderView",
      "OperatorCases",
      "Account",
      "NewQuote",
      "QuoteView",
      "Receipt",
    ]) {
      const source = read(`./routes/${route}.tsx`);
      expect(source).toContain("useWorkspace()");
      for (const backend of [
        "Privy",
        "convex",
        "Convex",
        "OrderRecordPanel",
        "RecoveryKit",
      ]) {
        expect(source).not.toContain(backend);
      }
    }
  });

  test("the workspace shell itself carries no identity", () => {
    expect(shellSource).toContain("useWorkspace()");
    expect(shellSource).not.toContain("PrivyProvider");
    expect(shellSource).not.toContain("ConvexProvider");
  });

  test("both trees hang off one router, so the ruling is not a routing accident", () => {
    expect(appSource).toContain('path="/connections"');
    expect(appSource).toContain("WorkspaceShell");
  });
});

describe("Q9: README says so, in the same words as the code", () => {
  test("it no longer calls the whole workspace a read-only console", () => {
    expect(readme).not.toContain(
      "the browser workspace is a real read-only console rather than a simulator",
    );
  });

  test("it names the simulator and the one real route", () => {
    // Markdown wraps these lines, so compare on collapsed whitespace.
    const flat = readme.replace(/\s+/g, " ");
    expect(flat).toContain("synthetic simulator");
    expect(flat).toContain("/connections");
    expect(flat).toContain("real read-only console");
  });

  test("its unit-test count claim is not asserted here", () => {
    // The count moves with every commit; asserting it would make this test a
    // tripwire for unrelated work. What matters is that no sentence claims a
    // capability the code does not have.
    expect(readme).not.toContain("no circuit call, no payment");
  });
});
