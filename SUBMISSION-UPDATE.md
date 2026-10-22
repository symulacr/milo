# SUBMISSION-UPDATE.md — state at HEAD `9a3bfdc`

Every claim below is reproducible at this commit with the command named beside
it. Nothing here is a roadmap item or an intention.

## What this branch contains

Milo is a Convex-backed order workspace for a Midnight Compact contract. A
frozen quote is admitted, bound to a deployed contract address, then advanced by
a chain observer that reads the Preprod indexer and projects the observed phase
into the delivery surface.

| Area | What is there | Verify with |
|---|---|---|
| Contract | `packages/contract/src/order.compact`, 14 proof circuits, source sha256 `453af640…` matching `packages/contract/generated/compile-receipt.json` | `bash scripts/judging-minimum.sh` (J2) |
| Chain observer | `convex/chainObserver.ts` polls `contractAction`, gates on finality depth, decodes the serialized state, and writes only on a `bind` verdict | `bun run test:unit` |
| Admission | `convex/canonicalAdmission.ts` plus the fixture-free kernel in `packages/backend/src/admission-policy.ts` | `bun run test:unit` |
| Settlement | `convex/settlement.ts` outbox with generation/attempt fences, lease reclaim, and a bounded 60s sweep | `bun run test:unit` |
| Delivery | `convex/files.ts` upload grants, provenance checks, and the `files.sweepGrantsMutation` TTL sweep | `bun run test:unit` |
| Web | Public routes `/demo`, `/sign-in`, `/how-it-works`, `/privacy`, `/terms`, `/pilot`; workspace routes `/orders`, `/merchant/orders`, `/merchant/quotes/new`, `/operator/cases`, `/account`, `/connections` | `node scripts/pr7-axe-all.mjs` |

## Verified baseline at `9a3bfdc`

These numbers were measured on this commit, not carried forward.

| Check | Command | Result |
|---|---|---|
| Unit tests | `bun run test:unit` | 737 pass, 0 fail, 67 files |
| Typecheck | `bun run typecheck` | clean, exit 0 |
| Lint | `bun run lint` | 0 errors, 6 warnings (all in generated `convex/_generated`) |
| Contract tests | `bun test packages/contract` | 43 pass, 0 fail, 9 files |
| Negative controls | `bash scripts/g4-negative-controls.sh` | `G4_PASS`, 7 of 7 modules |
| Accessibility | `node scripts/pr7-axe-all.mjs` | `PR7_AXE_ALL_PASS`, 0 serious across 34 routes |
| Build | `bun run build` | pass, `dist/` produced |
| Substance gate | `bash scripts/gates/gate.sh prototype` | 8 pass, 0 fail, `STAGE_AT_HEAD=prototype` |
| Judging minimum | `bash scripts/judging-minimum.sh` | unmet 0 |

## Submission requirements J1–J6

| | Requirement | State |
|---|---|---|
| J1 | Repo public, topic `midnightntwrk` | MET |
| J2 | Contract source matches its compile receipt | MET |
| J3 | `scripts/verify-readme.sh` passes | MET |
| J4 | Deck PDF present | MET — `pitch/deck/milo-d7-deck.pdf`, 10 slides |
| J5 | Demo video URL in README | MET — `https://youtu.be/nyB9qJ1OL-4` |
| J6 | This file names HEAD | MET — `9a3bfdc` |

## Honest limits

- **Preprod execution is not green end to end.** The real-fee happy path is
  blocked on a DUST fee resource (B-DUST-01). Local-network circuit calls and the
  on-chain verifier-key table are what exist; a Preprod capture has not been
  demonstrated.
- **`convex codegen` cannot run here.** It aborts because `BETTER_AUTH_URL` must
  be set on the Convex deployment, not locally. The generated barrel
  `convex/_generated/api.d.ts` is gitignored and was hand-patched to unblock
  `tsc`. That patch is a stopgap, not a substitute for codegen. See
  `scripts/gates/README.md`.
- **Only the `prototype` stage is green.** `demo`, `mvp` and `production` each
  need evidence that does not exist yet, so the gate reports those stages as
  unmet rather than passing them.
- **J4 is a PDF, not a live link.** The deck is tracked as a file.

## Team

Individual entrant (owner).
