/**
 * Boundary-clean carrier for the sample review deadline (one fact, one
 * carrier — 04 §2.2). Zero imports by design: the §7.4 public-entry scan
 * (demo-boundary.test.tsx) follows every relative import, so this module
 * must never reach workspace or packages/domain modules. The static landing
 * frame (index.html) cannot import it; public-chrome.test.tsx asserts parity.
 */
export const REVIEW_DEADLINE = "10 Sep 2026, 16:00 UTC";
