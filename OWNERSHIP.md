# OWNERSHIP.md

| agent | task | globs | worktree | branch | started | state |
|---|---|---|---|---|---|---|
| coordinator | S0-queue | scripts/**, TODO.md, OWNERSHIP.md, package.json, bun.lock, convex/schema.ts, scripts/gates/** | /home/eya/milo/milo-main | publish | 2026-09-30 | active |
| A | D2c+R6+R8+R9 | convex/**, packages/integration/**, packages/backend/**, packages/midnight-client/**, scripts/ingest-*, evidence/scripts/chain-* | /home/eya/milo-wt/A-R6 | wt/R6-D2c | 2026-09-30 | active |
| B | R7C+E2E-01 | apps/web/**, e2e/**, packages/backend/src/auth*, convex/auth.config.ts (interface), evidence/scripts/ui-* | /home/eya/milo-wt/B-R7C | wt/R7C-e2e | 2026-09-30 | active |

Ports: A 3100–3199 · B 3200–3299.
Shared locks: .locks/{preprod-wallet,convex-deploy,midnight-lane,stripe-webhook,privy}.lock
