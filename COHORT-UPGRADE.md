# COHORT-UPGRADE.md — Midnight cohort go/no-go

Date: 2026-09-30 · Policy: U2 (no main-line cohort bump)

## Current cohort (pinned)

| Package | Pin | npm view | Note |
|---|---|---|---|
| `@midnight-ntwrk/compact-runtime` | 0.16.0 | 0.19.0 | **newer exists** |
| `@midnight-ntwrk/onchain-runtime-v3` | 3.1.1 | 3.1.1 | current |
| `@midnight-ntwrk/dapp-connector-api` | 4.0.1 | 4.0.1 | current |
| `@midnight-ntwrk/ledger-v8` (integration) | 8.1.2 | — | feesWithMargin R8 |
| compiler artifacts | 0.31.1 / 0bede3fb | matrix | **protected** |

Deployed instances and canonical hash `0bede3fb…` stay untouched.

## Verdict: **NO-GO (main line)**

Reasons:

1. Compiler/runtime change alters verifier keys → new canonical build = **OWNER**
   decision (protected contract).
2. R8 fee spin is in ledger/dust wallet 8.1.2; a cohort bump might fix fees but
   can break Preprod compatibility and receipts.
3. Preprod support matrix must be re-read at upgrade time (docs.midnight.network
   support-matrix); do not assume.

## If a newer cohort is required

1. Create branch `cohort-next` (not main).
2. Pin compactc/devtools + compact-runtime + ledger + midnight-js + wallet-sdk +
   dapp-connector + matching proof-server/indexer/node images.
3. Compile; compare **all 14 verifier keys** to `0bede3fb` receipt.
4. If keys differ → **OWNER** ratifies a new canonical build.
5. Only then merge to main and re-pin evidence (U8).

## Risks

- Verifier key drift (contract identity)
- Fee math / DUST changes (R8)
- Indexer GraphQL / proof-server protocol drift
- Wallet SDK private-state format
