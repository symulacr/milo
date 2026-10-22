# R5 stripeSettlement.test.ts diff review

Date: 2026-09-30

## Diff reviewed

Commits touching `convex/stripeSettlement.test.ts`:

1. `c849acd` — created file (D1d): 3 tests
2. `58b11af` — lint autofix only

## Removed assertions

**None.** The `58b11af` diff is formatting only:

| Change | Type | Assertions lost |
|---|---|---|
| `import { run, providerIntent }` → `import { providerIntent, run }` | import sort | 0 |
| multi-line `typeof providerIntent` expect | prettier wrap | 0 |
| `outcome: \"failed\"` → `outcome: "failed"` | quote style | 0 |
| `outcome: \"ambiguous\"` → `outcome: "ambiguous"` | quote style | 0 |

All three original tests remain: export shape, args fence, provider paths /
fail-closed key gate.

## Negative controls

Present as source-substring guards (`STRIPE_SECRET_KEY missing`, `outcome: "failed"`,
`outcome: "ambiguous"`). R5 accepts these as kept. A behavioral negative
(missing key → refuse) is covered in `convex/settlement.test.ts` / auth inventory.

## Verdict

**R5 KEEP** — no removed assertions to account for; negatives retained.
