import { type ReactNode, useEffect, useRef } from "react";

export function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="icon" aria-hidden="true">
      {children}
    </span>
  );
}

/* Status is always icon + text, never color alone (04-ui-design §2.1). */
const toneGlyphs: Record<string, string> = {
  success: "✓",
  warning: "!",
  danger: "×",
  violet: "◆",
};

export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  const glyph = toneGlyphs[tone];
  return (
    <span className={`tag ${tone}`}>
      {glyph && <Icon>{glyph}</Icon>}
      {children}
    </span>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}

/**
 * The single page heading for both entries: one programmatically focusable h1
 * per main region (a11y) plus the document title, with no dependency on a
 * workspace model, simulator or provider. The public bundle reaches it too, so
 * it must never import a workspace module (01 §7.4).
 */
export function PageTitle({ title }: { title: string }) {
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

/** Brand mark: the ✳ seal asterisk as inline SVG (emoji rendering varies). */
export function WordmarkStar() {
  return (
    <svg className="wordmark-star" viewBox="0 0 32 32" aria-hidden="true">
      <g fill="currentColor">
        <rect x="14.2" y="6" width="3.6" height="20" rx="1.8" />
        <rect
          x="14.2"
          y="6"
          width="3.6"
          height="20"
          rx="1.8"
          transform="rotate(60 16 16)"
        />
        <rect
          x="14.2"
          y="6"
          width="3.6"
          height="20"
          rx="1.8"
          transform="rotate(120 16 16)"
        />
      </g>
    </svg>
  );
}
