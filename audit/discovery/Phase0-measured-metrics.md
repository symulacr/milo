# Phase 0.2 measured metrics (2026-09-30)

## Duplication (jscpd)

| Metric | Value |
|---|---|
| total percentage | 5.150199379707576 |
| duplicated lines | 2906 |
| total lines | 56425 |
| JS percentage | 6.83 |

## Dead exports (knip production scan)

Unused files listed in knip output (scripts/* helper CLIs).
Unused **dependencies (knip, production flags)**: 7 — several are false positives
(midnight-client integration imports); see U4 notes.

## Cycles (madge)

**1 circular dependency**: `packages/backend/src/convex-admission.ts` → `payment-monitor.ts`

## Coverage (bun test --coverage)

No root `coverage/lcov.info` emitted by bun (coverage prints a table only).
Line/function %: **UNKNOWN** (tool does not write LCOV). Test counts: 771 pass / 1 skip / 12 fail / 8 errors under coverage.

## Mutation score

**UNKNOWN** — no mutation tool configured in the repo.

## Lint 11 → 26 warnings

Warnings grew because U3 biome 2.5.14 + new U6/e2e/m11 files added style/useTemplate,
unused vars, and generated `convex/_generated` diagnostics. Errors remain 0.

## LOC src +2,978

Category: U6 provider-factory/errors/network (midnight-client + integration),
M2 local-circuit-sweep, e2e R7C issuer/harness, fee-math, evidence scripts.

## Lockfiles (2)

1. `bun.lock` (root, 279,277 B before U4; reduced after firecrawl-cli drop)
2. `packages/integration/package-lock.json` (178,788 B) — npm lock inside integration package
