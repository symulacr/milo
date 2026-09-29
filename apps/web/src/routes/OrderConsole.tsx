import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { LaceStatus, PublicConfigGate } from "../Connections";
import { PageTitle, Panel } from "../components/ui";
import { RecoveryKitPanel } from "../RecoveryKitPanel";

const PrivyConnection = lazy(() => import("../PrivyConnection"));

/**
 * The real order console. Every fact it shows comes from a source that exists
 * today — the Midnight wallet connector's connection status, the Convex
 * chain-backed order projection (A1 ingest path: phase and checkpoint address
 * only when a backing record exists), the Convex read-only test-payment
 * monitor, and the browser's own stored recovery context — and every lifecycle
 * step without a real path renders an explicit unavailable state naming what is
 * missing. It cannot show an order success that no chain or payment produced,
 * because it has no simulator state to advance. No phase label is rendered
 * without a backing Convex order record.
 */
export function OrderConsole() {
  return (
    <div className="order-console">
      <PageTitle title="Order console" />
      <p>
        This console reads real sources only: the Midnight wallet connector’s
        connection status, the Convex chain-backed order projection written by
        the A1 ingest path, the Convex read-only test-payment monitor, and the
        recovery context this browser stores for one order. Phase and checkpoint
        address appear only when that projection holds a backing record. No
        order action is simulated, and no browser input is treated as
        authorisation. SUPERSEDED (P3 A0-2): the earlier claim Your private terms never leave this device was stronger than 01-blueprint 2.2/2.4 (commitments and timing still reveal residual metadata on the public ledger; Convex and the payment processor are explicit data recipients). Private terms are kept off the public ledger as plaintext; residual metadata and authorized recipients still apply.
      </p>

      <Panel className="reading-panel">
        <h2>Chain connection · Midnight PREPROD</h2>
        <LaceStatus />
      </Panel>

      <PublicConfigGate>
        {(config) =>
          config.privyAppId && config.convexUrl ? (
            <Suspense fallback={<p role="status">Loading identity…</p>}>
              <Panel className="reading-panel">
                <h2>Authenticated order surfaces · Convex</h2>
                <PrivyConnection
                  appId={config.privyAppId}
                  convexUrl={config.convexUrl}
                >
                  <RecoveryKitPanel />
                </PrivyConnection>
              </Panel>
            </Suspense>
          ) : (
            <Panel className="reading-panel">
              <h2>Authenticated order surfaces · Convex</h2>
              <p role="status">
                {config.privyAppId
                  ? "Convex is not configured. The operator must set CONVEX_URL before authenticated payment observation and recovery are available. No phase label is shown without a backing order record."
                  : "Privy is not configured. The operator must set PRIVY_APP_ID and allow this origin before sign-in, payment observation and recovery are available."}
              </p>
            </Panel>
          )
        }
      </PublicConfigGate>

      <p className="soft-note">
        SUPERSEDED (P3 A0-2 tree loss): Convex sources and packages (backend, contract, domain, integration, midnight-client) are gone from this tree. Remaining honest surfaces in this build: wallet connection status, local recovery context, and explicit unavailable states. Authenticated Convex projection and payment observation are not buildable until sources and a hosted/local Convex URL are restored. Full
        diagnostics live on the{" "}
        <Link className="text-link" to="/connections">
          connection diagnostics
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
