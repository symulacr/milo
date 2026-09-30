# PERF-BASELINE.md

HEAD: `be18745` · collected 2026-09-30 (U0, before Phase U changes)

## LOC

| Bucket | Lines |
|---|---|
| src (apps/packages/convex/scripts) | 70855 |
| tests (filename/tests dir) | 16720 |
| docs (*.md) | 19389 |
| generated | 3850 |

## Dependencies

| Metric | Value |
|---|---|
| direct (package.json deps+dev) | 22 |
| transitive (`bun pm ls --all` lines) | 930 |
| lockfiles | bun.lock (+ any package-lock) |

## Timings

| Command | Seconds | Result |
|---|---|---|
| typecheck | 10.2 | ok |
| lint | 1.0 | see log |
| unit | 16.0 | pass=562 fail=0 |
| build | 0.7 | rc=0 |

## Bundle (raw bytes)

| Entry | Bytes |
|---|---|
| app-xc21g14s.js | 5456666 |
| index-2mpkz6ht.js | 0 |
| public-app-fqgxxsnb.js | 252550 |

## Quality (pre-campaign)

| Metric | Value |
|---|---|
| unit pass/fail | 562 / 0 |
| typecheck | clean |
| stage tag | PROTOTYPE only (R1) |

## Notes

- Fees: local-happy uses fixed fee `2_000_000_000n` behind local path; real
  `feesWithMargin` WASM spin on proved call txs is R8 open.
- Midnight cohort **not bumped** (U2 policy).


## Bundle compression (U1 S1 complete)

| Entry | raw | gzip -9 | brotli |
|---|---|---|---|
| app-xc21g14s.js | 5456666 | 1600778 | 1152069 |
| public-app-fqgxxsnb.js | 252550 | 80476 | 69877 |
| index-2mpkz6ht.js | 0 | 20 | 1 |
