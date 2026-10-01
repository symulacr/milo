# SUBMISSION-UPDATE.md — Wave 2 progress (draft)

## What changed since Wave 1 (Sep 16 → HEAD)

Midnight-related first (see WAVE-DELTA.md, 200+ commits):

1. Staged 7+7 verifier-key deploy on disposable local network; 14/14 circuits confirmed on-chain.
2. 14 proof circuits called across 10 fresh instances with tx hashes (M2).
3. Fee path: root-caused `feesWithMargin` WASM spin on proved call txs; product `eraseProofs` pricing.
4. Provider-assembly factory, typed client errors, network guards.
5. Independent verifier-key table signed (14/14 == compile-receipt).
6. Preprod real-fee happy path attempted; blocked on DUST fee resource (B-DUST-01).

## Claims check

| Sentence | Evidence |
|---|---|
| Compact contract compiles | sha256 `0bede3fb…` · 14 `proofCircuits` |
| 14 circuits called locally | `audit/discovery/M2-circuit-table.md` |
| Private terms off public ledger | `docs/MIDNIGHT-INTEGRATION.md` |
| Tests pass | unit 562/0 · semantic-sim 8/8 · soak 20 cycles |
| Preprod execution 14/14 (historical) | RECEIPTS.md dual-state |
| Acceptance 0/14 | dual-state unchanged |

## Team

Individual entrant (owner).
