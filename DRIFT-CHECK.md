# DRIFT-CHECK.md

Purpose anchor: private commissioning workspace. One buyer. One merchant. One 3-image deal.
Terms off-chain. Midnight proves lifecycle only. Stripe off-chain money. Capture on APPROVED. Void on CANCELLED.

| Surface | Deviation | Class | Action |
|---|---|---|---|
| README dual-state 14/14 vs 0/14 | intentional honesty | ON-PURPOSE-CHANGE | keep |
| order.compact sealed ledger | intentional | ON-PURPOSE-CHANGE | keep |
| landing copy | already softened | DOC-STALE? | re-read after receipts |
| form "immutable" terms | terms immutable after reserve; never on-chain | ON-PURPOSE-CHANGE | keep both words |
| stripeSettlement:run missing | roadmap M4 | REMAINING | build in MVP |
| recovery-kit 7 ops unwired | M6 | REMAINING | wire or justify |
| diagnostics by_intent unique | F-21 class | DRIFT if present | verify |
| SCOPE-CREEP | none identified this pass | — | re-run each wave |

## Building guide commands
| Command | State |
|---|---|
| bun run setup | WORKS (pinned toolchain) |
| bun run build | WORKS |
| bun run test:unit | WORKS (4 known fails) |
| bun run typecheck | STALE (5 errors) |
| bun run lint | STALE (errors) |

Re-run after every wave.
