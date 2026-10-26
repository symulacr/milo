/**
 * The four order windows, in one place. `deadlines` is the only arithmetic:
 * each deadline is cumulative from the moment the quote is finalized.
 */
export const ORDER_WINDOWS_MS = {
  acceptance: 60 * 60_000,
  delivery: 24 * 60 * 60_000,
  review: 48 * 60 * 60_000,
  resolution: 48 * 60 * 60_000,
} as const;

/**
 * How long after a deadline the UI still offers the expiry action. The server
 * enforces the deadline itself; this only decides when the button appears, so
 * one constant keeps the two from drifting.
 */
export const EXPIRY_GRACE_MS = 120_000;

export type Deadlines = {
  acceptance: number;
  delivery: number;
  review: number;
  resolution: number;
};

export function deadlines(now: number): Deadlines {
  const at = (ms: number) => Math.floor((now + ms) / 1000);
  const { acceptance, delivery, review, resolution } = ORDER_WINDOWS_MS;
  return {
    acceptance: at(acceptance),
    delivery: at(acceptance + delivery),
    review: at(acceptance + delivery + review),
    resolution: at(acceptance + delivery + review + resolution),
  };
}
