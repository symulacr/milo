import { useEffect, useRef } from "react";

/**
 * Public-surface page heading with no workspace/simulator dependency — the
 * lean public bundle must not import the workspace model (01 §7.4).
 */
export function PublicPageTitle({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `Milo — ${title}`;
    ref.current?.focus();
  }, [title]);
  return (
    <div className="page-heading">
      <div>
        <h1 tabIndex={-1} ref={ref}>
          {title}
        </h1>
      </div>
    </div>
  );
}
