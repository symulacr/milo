# M10 COVERAGE.md

Scripted `bun test --coverage` at HEAD (integration included).

| Package | Func % | Notes |
|---|---|---|
| domain/prototype | 100 | |
| domain/recovery-kit | 73 | gaps 118-119,177-183 |
| backend (via tests) | high | |
| midnight-client/network | 50 | |
| midnight-client/wallet-sdk-connector | 0 | untested paths |
| midnight-client/wallet | 25 | |
| integration/volume-batch | 100 | |
| ingest-observation | 58 | |

Totals: 647 pass / 1 skip / 12 fail / 8 errors (660 tests, 70 files) — **includes integration + coverage-only files**.  
Product gate `test:unit`: 493 pass / 0 fail.

**Uncovered MVP paths:** wallet-sdk-connector body, wallet.ts connect paths, recovery-kit restore tails, ingest-observation CLI branches.

Evidence: E-M10-01
