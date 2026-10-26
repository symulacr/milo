# Audit register

Date: 2026-10-26. Four workers read the code in parallel; each finding names a file and line. Status comes from the fixing patch and its test. Findings I checked myself are marked (verified).

Totals: 4 critical, 22 high, 32 medium, 12 low, 10 warning (80).

## Critical and high

| ID | Sev | Finding | Status |
|---|---|---|---|
| C-01 | Critical | Chain module was untracked, so a fresh clone could not build | Fixed: committed 2026-10-26 |
| C-04 | Critical | `escalateUnreviewed` leaves an unresolvable dispute (verified) | Open: fix written, redeploy held (ADR 2) |
| B-01 | Critical | A failed reconcile was never retried because the retry skipped it (verified) | Fixed |
| B-02 | Critical | An ambiguous capture had no recovery path | Fixed |
| A-03 | High | Any signed-in holder of an invite token could read the order | Fixed |
| A-04 | High | A claimed invite link stayed valid | Fixed: token rotates on claim |
| A-05 | High | A wrong wallet nonce deleted the real one | Fixed |
| A-06 | High | Wallet routes had no rate limit | Fixed |
| B-03 | High | The sweep could starve lease recovery | Fixed |
| B-04 | High | Settlement ignored live mode | Fixed |
| B-05 | High | No refund or dispute events | Fixed |
| B-06 | High | Capture ignored the resolution margin | Fixed |
| B-07 | High | A status-less Stripe error was retried | Fixed: treated as ambiguous |
| C-02 | High | Role secrets stored as plain JSON | Fixed: encrypted with a non-extractable key. Does not stop XSS |
| C-03 | High | Export labelled encrypted held plaintext | Fixed |
| C-05 | High | Buyer approval limit could not fail | Deferred: contract change |
| C-06 | High | Wallet signature accepted without the prefix | Fixed |
| C-07 | High | 11 MB wasm had no integrity check | Fixed: SHA-256 at load |
| C-08 | High | Deploy record said complete before confirmation | Fixed |
| C-09 | High | DUST was never checked | Fixed |
| C-10 | High | Service versions recorded and never compared | Fixed; pins updated |
| D-02 | High | A failed invite claim destroyed the saved order key | Fixed |
| D-03 | High | Live-mode hold froze the quote before the live check | Fixed |
| D-04 | High | Invite token never rotated | Fixed |
| D-05 | High | Double submit created two quotes | Fixed |
| D-06 | High | `/terms` described the windows wrongly | Fixed |

## Medium, low and warning

Most are fixed. Still open or deferred:

| ID | Finding | Status |
|---|---|---|
| A-01 | `privy.io` fallback in the session check | Fixed. Rated hardening, not an open door: Convex rejects other issuers first |
| A-17, A-18, A-20 | CORS coupling, N+1 order list, operator email parse | Fixed in round 16 |
| B-13 | `happy-dom` advisory | Fixed: 21.0.4 |
| B-14 | No CSP | Report-only with a live receiver. Enforcing needs a real Lace session |
| C-14 | No upper bound on deadlines | Deferred: contract change |
| C-02 (at rest) | Protection against XSS or a malicious extension | Not addressable here; CSP is the control |

## Corrected during review

- B-11 (unused rate-limit code) was not a defect.
- Two payment risks reported later did not exist: capture already sends an idempotency key, and `capture_before` is already stored.
- Research said Safari would block the session cookie. The Convex Better Auth client carries the session in a header held in `localStorage`, so there is no cookie to block.
