import { type ReactNode, useEffect, useRef } from "react";

/**
 * Focus the heading when the route changes, and set the document title.
 *
 * The shell ships a static `<title>`. That is what a crawler, a no-JS visitor and
 * the first paint get, and it is the only `<title>` element the document ever
 * has. React must not render a second one: React 19 hoists a rendered `<title>`
 * into `<head>` *before* the existing one (`mountHoistable`), so rendering one
 * leaves two elements and the stale second keeps whatever the shell shipped.
 * Writing `document.title` mutates the single existing element, so the count is
 * one at every moment and no cleanup pass is needed.
 *
 * `/privacy` and `/terms` are prerendered with no script at all
 * (`scripts/build.ts`), so they never run this; the build writes their title
 * into the head from the same `PAGES` entry that renders the page.
 *
 * `mounted` keeps the first render from stealing focus: a cold load should leave
 * focus at the top of the document, where the skip link is.
 */
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
    <>
      <h1
        tabIndex={-1}
        ref={ref}
        dir="auto"
        className="display-xl outline-none"
      >
        {title}
      </h1>
    </>
  );
}
