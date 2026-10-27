# Verification gates

Every "done" claim in this repository is backed by a gate you can run yourself.
The scripts and the evidence they read are tracked, so a fresh clone can
reproduce the claims instead of trusting them.

## What each gate proves

| Gate                   | Command                                | Proves                                                                                                                                      | Pass looks like                                                                                        |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Substance gate         | `bash scripts/gates/gate.sh <stage>`   | The stage's checks hold at `HEAD`. Stages: `prototype` (8 checks), `demo` (9), `mvp` (12), `production` (9).                                | `STAGE_AT_HEAD=<stage>`, exit 0, and `gates/<stage>-<ts>.json` with `fail: 0`                          |
| Gate self-test         | `bash scripts/gates/gate-selftest.sh`  | The substance gate can fail. Each of 11 checks is fed a mutated input and must go red.                                                      | `SELFTEST_EXIT=0`, exit 0                                                                              |
| Negative controls (G4) | `bash scripts/g4-negative-controls.sh` | Seven security modules are protected by tests that pass on real code and fail on a deliberate mutation applied in a throwaway git worktree. | `G4_PASS`, `tests-with-negative-control 7 of 7`, `modules-signed 7 of 7`, `leftover_worktrees_under=0` |
| Judging minimum        | `bash scripts/judging-minimum.sh`      | The J1-J6 submission requirements, reported MET / NOT MET.                                                                                  | `=== unmet: 0 ===`, exit 0                                                                             |
| Post-push verify       | `bash scripts/post-push-verify.sh`     | The shipped checks pass in sequence and the exit code reflects it.                                                                          | `=== failed: 0 ===`, exit 0                                                                            |
| M11 independent verify | `node scripts/m11-verify-all.mjs`      | Recorded circuit tx hashes are re-queried against the local indexer rather than trusted from the receipt file.                              | `{"found":<n>,"total":<n>}` with `found == total`                                                      |
| PR7 axe (all routes)   | `node scripts/pr7-axe-all.mjs`         | Every route in the route table is served over loopback and scanned for serious/critical axe violations at 1280 and 375.                     | `PR7_AXE_ALL_PASS`, `seriousTotal=0`                                                                   |

`gate.sh` writes `gates/<stage>-<timestamp>.json` (that directory is local output,
not tracked). On a clean `prototype` run it also moves the `stage/prototype-<sha>`
tag; higher stages print `TAG_SUPPRESSED` until their evidence exists.

## How to run

From the repository root:

```bash
bash scripts/gates/gate.sh prototype      # substance gate, one stage
bash scripts/gates/gate-selftest.sh       # prove the gate can fail
bash scripts/g4-negative-controls.sh      # mutation controls
bash scripts/judging-minimum.sh           # J1-J6
bash scripts/post-push-verify.sh          # shipped checks in sequence
node scripts/m11-verify-all.mjs           # needs the local indexer
node scripts/pr7-axe-all.mjs              # needs dist/ and playwright
```

Requirements: `bun` on `PATH` (or `~/.bun/bin`), `python3`, and `git`. The two
`.mjs` harnesses also need `node_modules` installed. `m11-verify-all.mjs` reads
`audit/discovery/M2-circuit-table.md` and `RECEIPTS-LOCAL.md` and needs a local
indexer on `127.0.0.1:8088`; `pr7-axe-all.mjs` reads `apps/web/src/route-table.ts`
and needs `bun run build` to have produced `dist/`.

## What the gates read

The gates read evidence by path from `audit/discovery/`. Tracked evidence:
`*.md` reports and the gate-result `*.json` files. Not tracked: `_g4_logs/`
(run logs), `*.png`, `*.log`, `*.out`.

Two paths that `gate.sh` requires are **not present in the tree**, so the checks
that read them fail:

| Path                                        | Check that needs it                         |
| ------------------------------------------- | ------------------------------------------- |
| `audit/discovery/E2E-01-three-pass.md`      | `D9_e2e_or_preprod` (demo)                  |
| `audit/discovery/D2c-preprod-happy-path.md` | `preprod_real_fee_table` (demo, production) |

`demo` therefore fails on `D9_e2e_or_preprod` until that evidence exists. That is
the gate reporting a real absence, not a bug in the gate. `prototype` passes,
because `audit/discovery/MASTER-LEDGER.md` is present and `P1_ledger` reads it.

## Known state

- `judging-minimum.sh` reports `unmet 0`: all six requirements are MET.
- `gate.sh prototype` passes 8 of 8 at `9a3bfdc`.
- `g4-negative-controls.sh` passes: 7 of 7 modules have working negative controls.

## Convex codegen cannot run in this environment

`npx convex codegen` aborts here. It is not offline: it uploads functions to the
deployment first, and the deployment then evaluates `convex/auth.config.ts`,
which reads `BETTER_AUTH_URL` from the deployment's environment.

Exact failure:

```
✖ Environment variable BETTER_AUTH_URL is used in auth config file but its value was not set.
Set it with:

    npx convex env set --deployment tremendous-rooster-473 BETTER_AUTH_URL <value>
```

The throw is `convex/auth.config.ts:19` reading `process.env.BETTER_AUTH_URL`,
guarded at line 21. Setting the variable locally does not help: the value is
read on the deployment (`tremendous-rooster-473`), not in this shell.

### Fix

```bash
npx convex env set --deployment tremendous-rooster-473 BETTER_AUTH_URL <value>
npx convex codegen
```

### Why a fresh clone breaks before it gets there

`convex/_generated/` is gitignored (`.gitignore:60`), so a fresh clone has no
generated barrel at all, and `bun run typecheck` fails on the missing
`./_generated/api` module. Even with a barrel present it can be **stale**: the
one in this working tree was missing `chainObserver` and `orderProjection`,
which broke `tsc` until both entries were added by hand.

### The hand-edit is a stopgap

Adding module entries to `convex/_generated/api.d.ts` by hand unblocks `tsc` and
nothing else. That file is generated output: the next successful codegen
overwrites it, and a hand-edit that drifts from the real module list produces a
typecheck that passes against an API surface the deployment does not have.

Treat a hand-edited barrel as a temporary bridge. The durable state is a
deployment with `BETTER_AUTH_URL` set and a real `npx convex codegen` run. If
you hand-edit, say so in the commit message so the next reader knows the file is
not authoritative.
