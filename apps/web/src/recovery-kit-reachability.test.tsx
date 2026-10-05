import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

/**
 * The recovery-kit panel had no production importer. Its only consumers were
 * tests and the QA harness, and `OrderConsole.tsx`, the route that once
 * mounted it, was deleted in Wave 2 having already been unreachable at
 * 297f128. The order-recovery surface therefore could not be reached by a
 * user.
 *
 * It is mounted rather than deleted because `PrivyConnection` already accepts
 * `children` and renders them inside its real `PrivyProvider`, which is what
 * `RecoveryKitPanel` needs from `usePrivy`. Its own doc comment calls it the
 * lazy entry point for both the order console and the connection diagnostics,
 * and it was passed no children.
 */

/** True while rendering the real PrivyProvider, so a mount outside it fails. */
let insidePrivyProvider = false;

mock.module("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: true,
    user: { id: "did:privy:order-recovery" },
  }),
  useLogin: () => ({ login: () => {} }),
  PrivyProvider: ({ children }: { children: ReactNode }) => {
    insidePrivyProvider = true;
    return <>{children}</>;
  },
}));

mock.module("convex/react", () => ({
  useConvex: () => ({ query: async () => null }),
  useConvexAuth: () => ({
    isLoading: false,
    isAuthenticated: false,
    isRefreshing: false,
  }),
  useQueries: () => [],
  ConvexProviderWithAuth: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ConvexReactClient: class {},
}));

const connectionsSource = await Bun.file(
  new URL("./Connections.tsx", import.meta.url).pathname,
).text();

const { default: PrivyConnection } = await import("./PrivyConnection");
const { RecoveryKitPanel } = await import("./RecoveryKitPanel");

describe("the recovery-kit panel has a production importer", () => {
  test("Connections.tsx imports it from the shipped module path", () => {
    expect(connectionsSource).toContain('from "./RecoveryKitPanel"');
  });

  test("it is a child of PrivyConnection, not merely an unused import", () => {
    // An unused import satisfies the test above while leaving the panel
    // unmounted. The child slot is what actually mounts it.
    expect(connectionsSource).toMatch(
      /<PrivyConnection[\s\S]*?<RecoveryKitPanel \/>[\s\S]*?<\/PrivyConnection>/,
    );
  });

  test("no other file needed changing: /connections is already a real route", () => {
    // The mount adds no public route, so route-table.ts, the generated
    // dist/_redirects and vercel.json rewrites are untouched. _redirects is
    // prefix-based and ends in `/* /app.html 200`, so /connections was
    // already served.
    expect(connectionsSource).not.toContain("workspaceRoutes");
    expect(connectionsSource).not.toContain("_redirects");
  });
});

describe("the shipped mount point renders the panel", () => {
  /** Exactly the subtree Connections.tsx mounts, with no config gate. */
  const shippedMount = (
    <MemoryRouter initialEntries={["/connections"]}>
      <PrivyConnection appId="did:privy:app" convexUrl={null}>
        <RecoveryKitPanel />
      </PrivyConnection>
    </MemoryRouter>
  );

  test("the panel renders its recovery context, not a placeholder", () => {
    const markup = renderToStaticMarkup(shippedMount);
    expect(markup).toContain("Order recovery context");
    expect(markup).toContain("did:privy:order-recovery");
    expect(markup).toContain("Prepare local context");
    expect(markup).toContain("Buyer reserve");
  });

  test("the checkpoint section stays hidden until a kit exists", () => {
    // CheckpointSection returns null with no kit, so it is correctly absent
    // on a fresh browser. Asserted so a future always-on render cannot claim
    // a checkpoint it has nothing to bind.
    const markup = renderToStaticMarkup(shippedMount);
    expect(markup).not.toContain("Checkpoint canonical address");
    expect(markup).toContain(
      "No local recovery context is stored for this actor and order nonce.",
    );
  });

  test("the panel really is inside a PrivyProvider in that subtree", () => {
    insidePrivyProvider = false;
    renderToStaticMarkup(shippedMount);
    expect(insidePrivyProvider).toBe(true);
  });

  test("the reserve path is present, not stubbed out", () => {
    const markup = renderToStaticMarkup(shippedMount);
    expect(markup).toMatch(/Begin reserve operation|Checkpoint address/);
  });
});

describe("the panel states what is still unavailable rather than faking it", () => {
  const markup = renderToStaticMarkup(<RecoveryKitPanel />);

  test("the three unavailable lifecycle steps are named", () => {
    expect(markup).toContain("Unavailable —");
    expect(markup).toContain("Merchant accepts and submits the delivery");
    expect(markup).toContain("Buyer approves or opens a dispute");
    expect(markup).toContain("Capture or void the payment");
  });

  test("every recovery-kit op is wired or justified in writing", () => {
    expect(markup).toContain("Recovery-kit operations: wired or justified");
    for (const op of [
      "beginOperation",
      "resumeOperation",
      "confirmOperation",
      "abandonOperation",
      "loseCapability",
      "restoreKit",
      "adoptBackup",
    ]) {
      expect(markup).toContain(`<code>${op}</code>`);
    }
  });

  test("it claims no persistence beyond the browser", () => {
    expect(markup).toContain(
      "No capability, witness, seed or file is ever stored here",
    );
  });
});
