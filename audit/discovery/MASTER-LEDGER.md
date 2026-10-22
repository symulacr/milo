# MASTER-LEDGER.md

States computed by gate evidence. Gates: Impl · Unit · Integration · Runtime · Browser · Docs · Independent-verify.
DONE = all seven evidenced. PENDING = some evidence. REMAINING = nothing.
Rung: NONE|SCAFFOLD|CODE|TESTED|RUNTIME + qualifier.

| ID | Source | Purpose | Class | Impl | Unit | Integ | Runtime | Browser | Docs | Indep | Rung | State |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L-01 | blueprint/contract | order.compact 14 circuits | MVP | YES | YES | YES | YES prior+state | NO | YES | NO | RUNTIME prior-not-rerun | PENDING |
| L-02 | P3 | canonical hash 0bede3fb pinned | MVP | YES | YES | N/A | YES identity | N/A | YES | NO | RUNTIME | PENDING |
| L-03 | P3 | verifier keys vs chain 14/14 | MVP | NO | NO | NO | NO | N/A | NO | NO | NONE | REMAINING |
| L-04 | http webhook | Stripe HMAC ingress | MVP | YES | YES | NO | NO | NO | YES | NO | TESTED | PENDING |
| L-05 | settlement | capture/void/fences F-21 | MVP | YES | YES | NO | NO | NO | YES | NO | TESTED | PENDING |
| L-06 | files+delivery | digest commitment | MVP | YES | YES | NO | NO | NO | YES | NO | TESTED | PENDING |
| L-07 | attachUpload provenance | URL→storageId | MVP | PARTIAL | PARTIAL | NO | NO | NO | NO | NO | TESTED | PENDING |
| L-08 | observationIngest | durable writer | MVP | YES | YES | NO | PARTIAL local | NO | YES | NO | TESTED | PENDING |
| L-09 | release-flags | R1 gates | MVP | YES | YES | N/A | N/A | N/A | YES | NO | TESTED | PENDING |
| L-10 | recovery-kit | no false usable order | MVP | YES | YES | N/A | N/A | NO | YES | NO | TESTED | PENDING |
| L-11 | recovery-kit UI ops | 7 ops wired or justified | MVP | NO | PARTIAL | N/A | N/A | NO | NO | NO | SCAFFOLD | PENDING |
| L-12 | midnight-client | wallet path | MVP | YES | YES | NO | NO | NO | YES | NO | TESTED | PENDING |
| L-13 | Stripe webhook endpoint | live endpoint | MVP | YES | NO | NO | YES created | NO | YES | NO | RUNTIME | PENDING |
| L-14 | D3 browser E2E-01 | happy deal 3× | MVP | NO | NO | NO | NO | NO | NO | NO | NONE | REMAINING |
| L-15 | D4 negatives | cancel/void/forged/… | MVP | NO | NO | NO | NO | NO | NO | NO | NONE | REMAINING |
| L-16 | unit 485/4/1 | fix 4 fails + 1 error | MVP | PARTIAL | PARTIAL | — | — | — | — | NO | TESTED | PENDING |
| L-17 | typecheck 5 errors | clean | MVP | NO | NO | — | — | — | — | NO | NONE | REMAINING |
| L-18 | lint errors | clean | MVP | NO | NO | — | — | — | — | NO | NONE | REMAINING |
| L-19 | integration hash assert | canonical variant | MVP | NO | NO | FAIL | — | — | — | NO | NONE | REMAINING |
| L-20 | RECEIPTS.md | chain facts | MVP | YES | N/A | N/A | YES | N/A | YES | PARTIAL | RUNTIME | PENDING |
| L-21 | SUBMISSION+CLAIMS | judge package | MVP | YES | N/A | N/A | N/A | N/A | YES | NO | CODE | PENDING |
| L-22 | PITCH+deck+video | D7 | MVP | YES (files) | NO | NO | NO | NO | NO | NO | FILES ONLY (script not filmed) | DONE-FILES |
| L-23 | LCOV coverage | M10 | MVP | NO | NO | NO | NO | NO | NO | NO | NONE | REMAINING |
| L-24 | Privy real auth | M7 | MVP | NO | NO | NO | NO | NO | NO | NO | NONE | REMAINING |
| L-25 | stripeSettlement:run | M4 | MVP | NO | NO | NO | NO | NO | NO | NO | NONE | REMAINING |
| L-26 | F-22 escalate empty evidence | OWNER | OWNER | — | — | — | — | — | — | — | NONE | OWNER |
| L-27 | F-24 never-read digests | OWNER | OWNER | — | — | — | — | — | — | — | NONE | OWNER |
| L-28 | 14/14 one instance | multi-instance M2 | MVP | NO | NO | NO | PARTIAL | NO | PARTIAL | NO | RUNTIME prior | PENDING |
| L-29 | clean-clone P5 | judge reproduce | MVP | NO | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| L-30 | secret scan P6 | history clean | MVP | YES | N/A | N/A | YES | N/A | YES | NO | TESTED | PENDING |

| F-01 | recon CRITICAL | No browser Midnight client | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-02 | W6 R-01 | Fixture-only deploymentObservations | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-03 | W2-A2 | deliveryCommitment randomBytes placeholder | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-04 | W3-A1 | verifyStripeSignature untested | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-05 | W3-A1 | Settlement begin/request/reconcile/sweep untested | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-06 | W3-A3 | 7 recovery-kit ops UI-dead | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-07 | W3-A3 | ESM cycle deploy-pipeline→batch-calls→bench | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-08 | W3-A3 | FrozenQuote shape duplicated backend vs Convex v | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-09 | W3-A3 | .mjs excluded from typecheck | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-10 | C4 | CI .github/ untracked | OWNER | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | OWNER |
| F-11 | C9 | Landing copy false "no payments/blockchain" | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-12 | C6 | VERIFICATION.md stale counts | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-13 | C8 | ARCHITECTURE_AUDIT "no webhooks/capture" | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-14 | R4-A1 | Phantom reconciliation.ts in backend README | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-15 | R3-A2 | Stale 0/14 counters in 6 docs | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-16 | C1 | Vite vs Bun | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-17 | C3 | vercel.json dist-only | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-18 | R2-A1 | R1-A1 Stripe/files MISSING | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-19 | drift | Address 0x7319 vs 0xb95c | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-20 | W6-A3 | hardening OQ #2/#6 | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-23 | deep dive | **bindingFields.network is v.string() vs v.literal("preprod" | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-25 | R2-A1 | **SPEC.md:60 "14 map 1:1 to MID-T01–T14" wrong** (T01 constr | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-26 | W1 contract | **Parity tests name-level only (no transition/guard semantic | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-27 | Wave C | **30 failing tests / 20 errors "outside scope"** | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-28 | Wave C | **4 typecheck errors in convex/files.test.ts** | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-29 | Wave C | **public-chrome.test.tsx order-dependent flake** | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-30 | Wave B/C R-04 | **attachUpload full upload-URL provenance** | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-31 | mandated | **.mjs excluded from typecheck; ESM cycle** | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-32 | mandated | **.github/ CI untracked** | OWNER | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | OWNER |
| F-33 | Wave C | **applyChainObservation address-claimed path hard to hit** | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-34 | BASELINE-RUN | Integration test fail: observer record interop bound vs reje | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-35 | BASELINE-RUN | Integration test fail: volume-batch 2079!==2400 submission-c | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-36 | W6-A3 | Stripe secret charset regex may reject real whsec_ | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-37 | deep dive | hex encoder fragmentation | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-38 | W5 | Dual lockfiles / Midnight pin split | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-39 | W6 | public-config not order-pinned | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-40 | drift | R1 flags hard-coded false | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | TESTED | PENDING |
| F-41 | D1 | Node 1.0.2 vs 2.1.0-beta.1 vs 1.0.0 | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-42 | D3 | R1 label semantics | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |
| F-43 | O1 | Acceptance-row flip policy | OWNER | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | OWNER |
| F-44 | O2 | Track Preprod receipts in git | OWNER | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | OWNER |
| F-45 | O6 | Organizer rubric 40 vs 20 | OWNER | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | OWNER |
| F-46 | O5 | Extract reconciliation.ts file | SUPERSEDED | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | SUPERSEDED |
| F-47 | R1-A1 | blueprint packages/ui/test-fixtures/contracts naming | OWNER | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | OWNER |
| F-48 | R1-A2 | packages/integration typecheck backlog ~2792 | MVP | PARTIAL | NO | NO | NO | NO | PARTIAL | NO | NONE | REMAINING |

## Counts (script to recompute)
PENDING 14 · REMAINING 14 · DONE 0 · OWNER 2 (seed; recompute with script)

## Seed sources
01–08, SPEC, CHANGELOG, ROADMAP-BLUEPRINT-CONTRACT, LOST-SET, FINDINGS-LEDGER, RECEIPTS, CLAIMS-CHECK, IMPLEMENTATION-P8/P9, BASELINE-P8.
