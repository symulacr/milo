import { type ReactNode, useEffect, useRef } from "react";
import { useParams } from "react-router";
import type { Role } from "../../../../packages/domain/src/prototype";
import { NotFound } from "../routes/NotFound";
import { useWorkspace } from "../workspace/model";
import { Panel } from "./ui";

export function RoleRequired({
  requiredRole: role,
  children,
}: {
  requiredRole: Role;
  children: ReactNode;
}) {
  const { state, chooseRole, mainHeading } = useWorkspace();
  const requestedRole = useRef(false);
  useEffect(() => {
    if (requestedRole.current && state.role === role) {
      requestedRole.current = false;
      mainHeading.current?.focus();
    }
  }, [state.role, role, mainHeading]);
  return state.role === role ? (
    children
  ) : (
    <Panel className="reading-panel">
      <h1 tabIndex={-1} ref={mainHeading}>
        This is the {role} view.
      </h1>
      <p>
        Switch the sample role to continue. Real access requires membership and
        capabilities.
      </p>
      <button
        type="button"
        className="button"
        onClick={() => {
          requestedRole.current = true;
          chooseRole(role);
        }}
      >
        Explore the {role} perspective
      </button>
    </Panel>
  );
}

export function BoundOrder({ children }: { children: ReactNode }) {
  const params = useParams();
  return params.orderId === "sample-001" ||
    params.quoteId === "sample-001" ||
    params.caseId === "sample-001" ? (
    children
  ) : (
    <NotFound />
  );
}
