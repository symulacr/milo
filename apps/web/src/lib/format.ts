import { useSyncExternalStore } from "react";
import type { Role, Stage } from "../api";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * A deadline, shown in the reader's own time zone **with the zone named**.
 *
 * Z-03: the chain stores deadlines as absolute UTC seconds, and this formatter
 * had no `timeZone`, so it rendered in the device's zone. That is the right
 * choice for a person reading a deadline — but it printed only "21 Oct, 14:30",
 * so a buyer in Tokyo and a studio in London saw the same numbers meaning
 * different instants, and neither could tell which. Adding `timeZoneName` makes
 * the two agree without forcing everyone onto UTC, which would be worse for the
 * common case (a buyer reading their own deadline).
 */
const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Largest first, so the first unit that fits is the one to print.
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export const usd = (amount: number) => money.format(amount);

export function shortDate(value: number | string | null | undefined) {
  if (value == null) return "Not yet";
  return stamp.format(
    new Date(typeof value === "string" ? Number(value) * 1000 : value),
  );
}

let clock = Date.now();
let ticker: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const readClock = () => clock;

/**
 * Re-read the clock and notify every subscriber.
 *
 * Exported so a caller that needs a different cadence (the order page's 30 s
 * deadline countdown) can drive this one store instead of running a second
 * ticker. Two tickers meant two sources of "now" for two numbers on the same
 * screen, which could disagree by up to a tick.
 */
export const tickClock = () => {
  clock = Date.now();
  for (const notify of listeners) notify();
};

function subscribeClock(listener: () => void) {
  listeners.add(listener);
  ticker ??= setInterval(tickClock, 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

/** The largest unit that fits, so a 48 h window reads "in 2 days". */
export function relativeTo(value: number, now: number) {
  const delta = value - now;
  for (const [unit, size] of UNITS)
    if (Math.abs(delta) >= size)
      return relative.format(Math.round(delta / size), unit);
  return relative.format(0, "second");
}

export function useAgo(value: number | null | undefined) {
  const now = useSyncExternalStore(subscribeClock, readClock, readClock);
  return value == null ? "" : relativeTo(value, now);
}

/** The shared clock store, for a caller that wants the same "now" as `useAgo`
 * but with its own tick cadence. */
export const useClock = () =>
  useSyncExternalStore(subscribeClock, readClock, readClock);

export const ROLE_NAME: Record<Role, string> = {
  buyer: "Client",
  merchant: "Studio",
  operator: "Operator",
};

export const badgeTone = (stage: Stage) =>
  stage === "APPROVED"
    ? "positive"
    : stage === "DISPUTED"
      ? "warning"
      : stage === "CANCELLED"
        ? "negative"
        : "neutral";
