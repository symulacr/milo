import { useWorkspace } from "../workspace/model";

/** Workspace page heading. The shared main-heading ref is focused by the workspace
 * model on route changes, not on first load, so the skip link stays the first tab stop. */
export function PageTitle({ title }: { title: string }) {
  const { mainHeading } = useWorkspace();
  return (
    <div className="page-heading">
      <div>
        <h1 tabIndex={-1} ref={mainHeading}>
          {title}
        </h1>
      </div>
    </div>
  );
}
