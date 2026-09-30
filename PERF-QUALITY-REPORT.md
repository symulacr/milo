# PERF-QUALITY-REPORT.md

Before/After/Δ vs PERF-BASELINE.md (U7). Filled after U3–U8.

## LOC

| Bucket | Before | After | Δ |
|---|---|---|---|
| src | 70855 | see U8 recount | TBD |
| tests | 16720 | TBD | TBD |
| docs | 19389 | TBD | TBD |
| generated | 3850 | TBD | TBD |

## Bundle

| Entry | raw before | gzip before | brotli before | after | Δ |
|---|---|---|---|---|---|
| app | 5456666 | 1600778 | 1152069 | TBD | TBD |
| public-app | 252550 | 80476 | 69877 | TBD | TBD |

## Quality

| Metric | Before | After |
|---|---|---|
| unit | 562/0 | TBD |
| typecheck | 0 | TBD |
| lint errors | 0 | TBD |
| coverage full-suite | 735/1/12/8 | TBD |
| stage | PROTOTYPE | TBD |

## Regressions

(none recorded yet)

## ROI

(see U4/U5 sections after those phases)


## U3/U4 deltas (2026-09-30)

| Item | Before | After | Δ |
|---|---|---|---|
| biome | 2.5.12 | 2.5.14 | +2 patch |
| react / react-dom | 19.2.8 | 19.3.0 | +0.0.x |
| react-router | 8.3.1 | 8.4.0 | +0.1 |
| convex | 1.45.0 | 1.46.0 | +0.1 |
| stripe | 22.6.1 | 22.6.2 | +0.0.1 |
| zod | 4.5.4 | 4.6.5 (kept) | +0.1 |
| @noble/hashes | 1.4.0 | 1.8.0 | +0.4 |
| firecrawl-cli | present | **removed** | unused |
| zod removal | attempt | **reverted** | public-config.ts imports zod |
| Midnight cohort | pinned | unchanged | U2 NO-GO |
