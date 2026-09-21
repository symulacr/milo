import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { Role, Scenario } from "../../../../packages/domain/src/prototype";
import { OrderDialog } from "../components/OrderDialog";
import { Badge, Icon } from "../components/ui";
import { WordmarkStar } from "../components/Wordmark";
import { roleNames, scenarios, useWorkspace } from "../workspace/model";

export function WorkspaceShell() {
  const isConnections =
    useLocation().pathname.replace(/\/+$/, "") === "/connections";
  const { state, scenario, reset, chooseRole, notice, can, act } =
    useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-top">
          <a className="wordmark" href="/">
            milo
            <WordmarkStar />
          </a>
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          </button>
        </div>
        <nav aria-label="Workspace">
          <NavLink to="/orders/sample-001" aria-label="Sample workspace">
            <Icon>◈</Icon>
            <span className="nav-text">Sample workspace</span>
          </NavLink>
          <NavLink to="/orders" aria-label="Your orders">
            <Icon>▤</Icon>
            <span className="nav-text">Your orders</span>
          </NavLink>
          <NavLink to="/quotes/sample-001" aria-label="The agreement">
            <Icon>◇</Icon>
            <span className="nav-text">The agreement</span>
          </NavLink>
          <NavLink to="/merchant/orders" aria-label="Studio queue">
            <Icon>▧</Icon>
            <span className="nav-text">Studio queue</span>
          </NavLink>
          <NavLink to="/operator/cases" aria-label="Resolution desk">
            <Icon>⚑</Icon>
            <span className="nav-text">Resolution desk</span>
          </NavLink>
          <NavLink to="/connections" aria-label="Connections">
            <Icon>⬡</Icon>
            <span className="nav-text">Connections</span>
          </NavLink>
          {/* The horizontal mobile nav keeps account/recovery reachable
              (04 §9.3); the desktop sidebar-bottom shows the full entry. */}
          <NavLink
            to="/account"
            className="account-nav-link"
            aria-label={`Account — ${roleNames[state.role]}`}
          >
            <span
              className={`avatar avatar-${state.role}`}
              aria-hidden="true"
            ></span>
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <a className="text-link" href="/how-it-works">
            How Milo works ↗
          </a>
          <NavLink to="/account" className="account-link">
            <span className={`avatar avatar-${state.role}`}></span>
            <span className="nav-text">
              <strong>{roleNames[state.role]}</strong>
              <small>Sample {state.role}</small>
            </span>
            <span className="nav-text" aria-hidden="true">
              ↗
            </span>
          </NavLink>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <div>
            {/* Persistent sample label on every workspace surface (04 §4.4) */}
            <Badge tone="violet">
              {isConnections
                ? "Connection diagnostics"
                : "Synthetic sample · no wallet, payment or transaction"}
            </Badge>
            <a href="/">Back to Milo ↗</a>
          </div>
        </header>
        {!isConnections && (
          <details className="prototype-toolbar">
            <summary>
              <span>
                <strong>Sample controls</strong> ·{" "}
                {scenarios.find((s) => s.value === scenario)?.label} ·{" "}
                {state.role}
              </span>
            </summary>
            <div className="prototype-selects">
              <label>
                Scenario
                <select
                  value={scenario}
                  onChange={(event) => reset(event.target.value as Scenario)}
                >
                  {scenarios.map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Perspective
                <select
                  value={state.role}
                  onChange={(event) => chooseRole(event.target.value as Role)}
                >
                  <option value="buyer">Buyer</option>
                  <option value="merchant">Merchant</option>
                  <option value="operator">Operator</option>
                </select>
              </label>
              <button
                type="button"
                className="reset-button"
                onClick={() => reset(scenario)}
                aria-label="Reset this sample scenario"
              >
                ↺ <span>Reset</span>
              </button>
              {can("advance-deadline") && (
                <button
                  type="button"
                  className="reset-button"
                  onClick={() => act("advance-deadline")}
                  aria-label="Advance the sample clock"
                >
                  → <span>Advance clock</span>
                </button>
              )}
            </div>
          </details>
        )}
        <main id="workspace" className="workspace">
          <div
            className={`notice ${notice ? "visible" : ""}`}
            role="status"
            aria-live="polite"
          >
            {notice}
          </div>
          <Outlet />
          <footer className="workspace-footer">
            <span>Private agreements. Clear approvals.</span>
            <span>
              {isConnections ? "No admitted orders" : "Synthetic workspace"}
            </span>
          </footer>
        </main>
      </div>
      <OrderDialog />
    </div>
  );
}
