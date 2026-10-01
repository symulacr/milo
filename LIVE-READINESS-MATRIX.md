# LIVE-READINESS-MATRIX.md

| Requirement | Source | Status | Who | Evidence | Date |
|---|---|---|---|---|---|
| Stripe merchant payout / Connect | blueprint + Stripe docs | OPEN | OWNER | need entity country + Connect approval | — |
| Card hold vs review/expiry deadlines | M4 research | DECISION NEEDED | OWNER | M4: capture_before vs resolutionDeadline | 2026-09-30 |
| Midnight mainnet endpoints/versions | support-matrix | RESEARCHED | agent | U1/COHORT-UPGRADE | 2026-09-30 |
| Mainnet NIGHT acquisition | official docs | OWNER | OWNER | no faucet | — |
| DUST generation/designation | wallet SDK docs | BLOCKED 0 balance | agent+OWNER | B-DUST-01 | 2026-10-01 |
| F-22 escalateUnreviewed empty evidence | contract | OWNER decision | OWNER | before mainnet | — |
| F-24 never-read digests | contract | OWNER decision | OWNER | before mainnet | — |
| Upload scanning / T&S vendor | industry | OWNER | OWNER | policy | — |
| Terms/Privacy/Refund drafts | compliance | DRAFT | agent | DRAFT — counsel review required | — |
| Prod env separation + runbooks | ops | PARTIAL | agent | RUNBOOKS.md | — |
| Live caps / kill switch | safety | OPEN | agent | — | — |
| Continuous observer service | U6 | OPEN | agent | — | — |
| Hosted Preprod staging URL | UX rubric | OWNER | OWNER | — | — |

Stripe hold window (M4): card-not-present Visa MIT 5d (4d18h), CIT 7d; MC/Amex/Discover 7d. If review+expiry exceed the hold, capture-after-APPROVED conflicts. Owner options: extended authorization, re-auth, capture-then-refund, shorter deadlines.
