# FLOW-READINESS.md

| flow | route | role | wallet tier | 3× pass | evidence |
|---|---|---|---|---|---|
| FL-01 merchant offer | /merchant/quotes/new | merchant | W0 | no | — |
| FL-02 buyer reserve | /orders | buyer | W1/W2 | no | — |
| FL-03 merchant accept | /merchant/orders | merchant | W0 | no | — |
| FL-04 delivery upload | /merchant/orders | merchant | W0 | no | — |
| FL-05 approve + capture | /orders | buyer | W1 | no | — |
| FL-06 cancel void | /orders | buyer | W0 | no | — |
| FL-07 decline | /merchant/orders | merchant | W0 | no | — |
| FL-08 dispute resolve | /operator/cases | operator | W0 | no | — |
| FL-09 expiry | /operator/cases | operator | W0 | no | — |
| FL-10 recovery interrupt | all | all | W0 | no | — |
| FL-11 receipts/judge | /connections | — | W0 | no | — |
| FL-12 abuse set | — | — | W0–W2 | no | — |

Auth label: local-convex+test-issuer unless owner Privy test accounts.
