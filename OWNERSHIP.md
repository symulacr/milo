# OWNERSHIP.md

Disjoint claims. Coordinator applies hot files; agents propose diffs.

| agent | task | globs | worktree | branch | started | state |
|---|---|---|---|---|---|---|
| coordinator | queue | TODO.md, OWNERSHIP.md, WORKLOG.md, HANDOFF.md, package.json, bun.lock, tsconfig*, biome.json, convex/schema.ts, convex/auth.config.ts, scripts/gates/**, scripts/next-task.sh, scripts/todo-check.sh, scripts/ownership-check.sh, scripts/net-health.sh, scripts/todo_lib.py | /home/eya/milo/milo-main | publish | 2026-09-30 | active |
| A | D2c+R6+R8+R9 | convex/ (not schema.ts not auth.config.ts), packages/integration/**, packages/backend/**, packages/midnight-client/**, scripts/ingest-*, scripts/m11-verify.mjs, scripts/pr7-axe.mjs, evidence/scripts/chain-* | /home/eya/milo-wt/A-R6 | wt/R6-D2c | 2026-09-30 | active |
| B | R7C+E2E | apps/web/**, e2e/**, clickmap-harness/**, docs/**, evidence/scripts/ui-* | /home/eya/milo-wt/B-R7C | wt/R7C-e2e | 2026-09-30 | active |

Ports: A 3100–3199 · B 3200–3299.
Locks: .locks/{preprod-wallet,convex-deploy,midnight-lane,stripe-webhook,privy}.lock
