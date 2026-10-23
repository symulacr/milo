import type { ReactNode } from "react";
import { AlertIcon, CheckIcon, ShieldIcon, XIcon } from "./icons";

export function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="icon" aria-hidden="true">
      {children}
    </span>
  );
}

const toneGlyphs: Record<string, ReactNode> = {
  success: <CheckIcon />,
  warning: <AlertIcon />,
  danger: <XIcon />,
  violet: <ShieldIcon />,
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
