import { type ReactNode, useEffect, useRef } from "react";

function useRouteHeading(title: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    document.title = `Milo · ${title}`;
    if (mounted.current) ref.current?.focus();
    mounted.current = true;
  }, [title]);
  return ref;
}

export function PageTitle({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRouteHeading(title);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1
          tabIndex={-1}
          ref={ref}
          // The title can be the brief the user typed, so it sets its own
          // direction; a Latin title is unaffected.
          dir="auto"
          className="max-w-3xl text-2xl leading-tight font-extrabold tracking-[-0.03em] outline-none"
        >
          {title}
        </h1>
        {children}
      </div>
      {actions}
    </div>
  );
}

export function PublicTitle({ title }: { title: string }) {
  const ref = useRouteHeading(title);
  return (
    <h1 tabIndex={-1} ref={ref} dir="auto" className="display-xl outline-none">
      {title}
    </h1>
  );
}
