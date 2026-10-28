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
 *
 * React 19 hoists this `<title>` into `<head>` and inserts it *before* the
 * shell's own static title (`mountHoistable`), so the document ends up with two
 * and the stale second one keeps whatever the shell shipped. `document.title`
 * reads the first, so the tab is right and the duplicate is invisible; it is
 * still invalid, and a reader that takes the last title sees the stale one.
 * The static title stays in the shell on purpose — it is what a crawler, a
 * no-JS visitor and the first paint get — so the stale copy is dropped here,
 * after React's own title has been committed.
 */
function useRouteHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) ref.current?.focus();
    mounted.current = true;
    const titles = document.head.querySelectorAll("title");
    for (const stale of [...titles].slice(1)) stale.remove();
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
