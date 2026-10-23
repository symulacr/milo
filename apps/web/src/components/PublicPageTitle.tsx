import { useEffect, useRef } from "react";

export function PublicPageTitle({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    document.title = `Milo — ${title}`;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
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
