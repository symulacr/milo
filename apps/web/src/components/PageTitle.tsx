import { type ReactNode, useEffect, useRef } from "react";

/**
 * Focus the heading when the route changes, and let React own the title.
 *
 * The title used to be set here with `document.title`, which only works when the
 * page runs JavaScript. `/privacy` and `/terms` are prerendered with no script
 * at all (`scripts/build.ts`), so both shipped `<title>Milo</title>` — measured
 * on the live deploy. A `<title>` element is hoisted into `<head>` by React 19
 * in both the client and the prerender path, so the same component now titles
 * the page either way.
 *
 * `mounted` keeps the first render from stealing focus: a cold load should leave
 * focus at the top of the document, where the skip link is.
 */
function useRouteHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) ref.current?.focus();
    mounted.current = true;
  }, []);
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
  const ref = useRouteHeading();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <title>{`Milo · ${title}`}</title>
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
  const ref = useRouteHeading();
  return (
    <>
      <title>{`Milo · ${title}`}</title>
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
