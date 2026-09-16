import { useWorkspace } from "../workspace/model";

/** Workspace page heading; focuses the shared main-heading ref on mount. */
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
