import { useSyncExternalStore } from "react";
import type { Role, Stage } from "../api";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
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

function subscribeClock(listener: () => void) {
  listeners.add(listener);
  ticker ??= setInterval(() => {
    clock = Date.now();
    for (const notify of listeners) notify();
  }, 60_000);
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
