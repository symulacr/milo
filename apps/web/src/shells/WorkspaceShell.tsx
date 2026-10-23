import { type CSSProperties, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { Role, Scenario } from "../../../../packages/domain/src/prototype";
import {
  ArrowUpRightIcon,
  FileIcon,
  FlagIcon,
  InboxIcon,
  PlugIcon,
  ShieldIcon,
} from "../components/icons";
import { OrderDialog } from "../components/OrderDialog";
import { Badge, Icon } from "../components/ui";
import { WordmarkStar } from "../components/Wordmark";
import { roleNames, scenarios, useWorkspace } from "../workspace/model";

const avatarPhoto: Record<Role, string> = {
  buyer: "/images/avatar-buyer.webp",
  merchant: "/images/avatar-merchant.webp",
  operator: "/images/avatar-operator.webp",
};

const NAV = [
  { to: "/orders/sample-001", label: "Sample workspace", Icon: ShieldIcon },
  { to: "/orders", label: "Your orders", Icon: InboxIcon, end: true },
  { to: "/quotes/sample-001", label: "The agreement", Icon: FileIcon },
  { to: "/merchant/orders", label: "Studio queue", Icon: InboxIcon },
  { to: "/merchant/quotes/new", label: "New quote", Icon: FileIcon },
  { to: "/operator/cases", label: "Resolution desk", Icon: FlagIcon },
  { to: "/connections", label: "Connections", Icon: PlugIcon },
] as const;

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
      <aside
        className="sidebar"
        aria-label="Workspace navigation"
        style={
          {
            "--avatar-photo": `url(${avatarPhoto[state.role]})`,
          } as CSSProperties
        }
      >
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
          {NAV.map(({ to, label, Icon: Glyph, ...rest }) => (
            <NavLink key={to} to={to} aria-label={label} {...rest}>
              <Icon>
                <Glyph />
              </Icon>
              <span className="nav-text">{label}</span>
            </NavLink>
          ))}
          <NavLink
            to="/account"
            className="account-nav-link"
            aria-label={`Account — ${roleNames[state.role]}`}
          >
            <span className="avatar" aria-hidden="true" />
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <a className="text-link" href="/how-it-works">
            How Milo works <ArrowUpRightIcon />
          </a>
          <NavLink to="/account" className="account-link">
            <span className="avatar" />
            <span className="nav-text">
              <strong>{roleNames[state.role]}</strong>
              <small>Sample {state.role}</small>
            </span>
            <span className="nav-text" aria-hidden="true">
              <ArrowUpRightIcon />
            </span>
          </NavLink>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <div>
            <Badge tone="violet">
              {isConnections
                ? "Connection diagnostics"
                : "Synthetic sample · no wallet, payment or transaction"}
            </Badge>
            {!isConnections && (
              <Badge tone="neutral">Perspective: {roleNames[state.role]}</Badge>
            )}
            <a href="/">
              Back to Milo <ArrowUpRightIcon />
            </a>
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
