import { type ClassValue, clsx } from "clsx";
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A synchronous "this handler is already running" guard.
 *
 * `pending`/`busy` state is a render behind: two clicks in the same frame both
 * pass the `disabled` check and both run the handler. The ref is set before the
 * first `await`, so the second click is refused. Every handler that starts a
 * mutation or a chain action needs this, and three copies of it had already
 * drifted (NewQuote, OrderView's actions, OrderView's invite claim) — so it is
 * one hook, and the call sites read as a single line.
 *
 * Usage: `const guard = useGuard();` then `if (!guard.start()) return;` and
 * `guard.end()` on every settle path (a `.finally` is the usual place).
 */
export function useGuard() {
  const running = useRef(false);
  return {
    /** Claim the handler. False means a previous run is still in flight. */
    start: () => {
      if (running.current) return false;
      running.current = true;
      return true;
    },
    /** Release it. Safe to call twice. */
    end: () => {
      running.current = false;
    },
  };
}
