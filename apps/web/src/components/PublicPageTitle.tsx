import { useEffect, useRef } from "react";

/**
 * Public-surface page heading with no workspace/simulator dependency — the
 * lean public bundle must not import the workspace model (01 §7.4).
 *
 * The heading is focused on NAVIGATION, not on first load: focusing it on mount
 * moved the sequential-focus start past the skip link that PublicShell renders
 * first in the DOM, so the link was no longer the first tab stop (WCAG 2.2
 * SC 2.4.1 Bypass Blocks). The title is still set on every mount.
 */
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
