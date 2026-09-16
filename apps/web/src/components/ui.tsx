import type { ReactNode } from "react";

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
  neutral: "○",
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
