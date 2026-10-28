import type { ReactNode } from "react";
import { Wordmark, WordmarkStar } from "../components/Wordmark";

export const PUBLIC_NOTICE = "Midnight Preprod. Cards run in Stripe test mode.";

/** Shared main nav: landing (brand field) and legal (white) both use this. */
export function PublicMainNav({
  howHover = "hover:text-brand",
  ctaClass = "cta -mr-4 h-9 px-4 text-sm",
}: {
  howHover?: string;
  ctaClass?: string;
}) {
  return (
    <nav
      aria-label="Main navigation"
      className="ml-auto flex flex-wrap items-center gap-5 text-sm font-semibold"
    >
      <a className={`hidden sm:inline ${howHover}`} href="/#how">
        How it works
      </a>
      <a className={ctaClass} href="/orders">
        Sign in
      </a>
    </nav>
  );
}

export function PublicFooter({
  privacy,
  terms,
}: {
  privacy: ReactNode;
  terms: ReactNode;
}) {
  return (
    <footer className="grid gap-10 overflow-hidden bg-foreground px-4 pt-16 pb-10 text-white sm:px-8">
      <nav
        aria-label="Footer"
        className="flex flex-wrap gap-5 text-sm font-semibold"
      >
        {privacy}
        {terms}
      </nav>
      <a
        href="/"
        className="wordmark text-[clamp(5rem,22vw,20rem)] leading-[0.8]"
      >
        milo
        <WordmarkStar />
      </a>
      <p className="text-sm">{PUBLIC_NOTICE}</p>
    </footer>
  );
}

export function PublicHeader({
  className,
  howHover,
  ctaClass,
}: {
  className: string;
  howHover?: string;
  ctaClass?: string;
}) {
  return (
    <header
      className={`sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-8 ${className}`}
    >
      <Wordmark />
      <PublicMainNav howHover={howHover} ctaClass={ctaClass} />
    </header>
  );
}
