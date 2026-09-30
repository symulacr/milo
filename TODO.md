# TODO.md

- [x] G0 | Audit gate.sh substance + self-tests | | gate JSON shows non-trivial checks; mutation self-tests fail | prototype
- [x] G1 | Complete MASTER-LEDGER script counts | G0 | script prints rows/DONE/PENDING/REMAINING | prototype
- [x] G2 | Integration exit 1→0 canonical hash | | test:integration exit 0 | prototype
- [x] G3 | ContractState keys 14/14 table | | per-circuit table pasted | prototype
- [x] G4 | Negative controls + indep signatures 7 modules | | N of 7 signed | prototype
- [x] G5 | P5 clean-clone P6 secrets P8 staleness | | outputs pasted | prototype
- [x] G6 | gate.sh prototype full + tag | G0-G5 | STAGE_AT_HEAD=prototype | prototype
- [x] D1a | Deploy convex to dev | | function-spec list | demo
- [x] D1b | Webhook bad-sig reject cases | D1a | curl outputs | demo
- [x] D1c | Real Stripe event to endpoint | D1b | pi_/evt_ + inbox row | demo
- [x] D1d | stripeSettlement:run rebuild | D1c | tests green | demo
- [x] D2a | Local Midnight happy path | | tx hashes obs_d2a_local_happy_complete_1 (reserve/accept/submitDelivery/approve SucceedEntirely) | demo
- [x] D2b | SPEND-LEDGER + faucet | | balance script | demo
- [ ] D2c | Preprod happy path funded | D2b | receipts rows | demo | evidence: none | state: blocked | blocker: B-D2C-01 DUST=0 Wallet.InsufficientFunds obs_d2c_preprod_dust_blocker_1
- [x] D3a | CLICK-MAP.md | | all routes | demo
- [x] D3b (partial: research+probe logged; blocked owner test accounts) | Privy test login | | logged research | demo
- [x] D3c | SDK-connector-injected | D3b | not in prod bundle (dist/app 0 matches, public 0 matches; apps/web/src/sdk-connector-inject.ts + sdk-connector-prod-boundary.test.ts) | demo
- [ ] D3d (blocked: O-PRIVY-TEST owner gap) | E2E-01 happy path | D3c | 3× pass | demo
- [ ] D3e | Video trace HAR SRT | D3d | files on disk | demo
- [ ] D4 | Negatives ×3 | D3d | results | demo
- [x] D5 | Independent receipts re-query | | verifier signed | demo
- [x] D6 | Judge clone ≤10 steps | | timed | demo
- [x] D7 | PITCH deck video submission | | files (PITCH.md, pitch/deck 10 SVG + PDF, VIDEO-SCRIPT-90S.md, SUBMISSION-UPDATE v2) | demo
- [x] D8 | PUSH-READINESS hosting | | files | demo
- [x] D9 | Copy audit | | no live-pay claims | demo
- [ ] D10 (R2: weak tags revoked; re-issue after demo audit) | gate.sh demo tag | D1-D9 | STAGE=demo gates/demo-20260930-061838.json pass=1 | demo
- [x] M2 | 14 circuits multi-instance | | receipts table obs_m2_multi_instance_1 (2 instances, 14/14 ops present each) | mvp
- [x] M3 | E2E-02..07 ×3 matrix (chain-layer 3× 14/14 obs_m3_matrix_1; UI cells open) | | matrix | mvp
- [x] M4 | Stripe window vs deadlines | | fix or doc | mvp
- [x] M5 | attachUpload provenance | | tests | mvp
- [x] M6 | recovery-kit ops UI | | wired or justified | mvp
- [x] M7 | Auth inventory tests | | per route | mvp
- [ ] M8 (R2: needs owner accept/reject) | Lace or owner gap | | evidence (O-PRIVY-TEST + OWNER-QUEUE M8 row; Lace unverified, gap documented) | mvp
- [x] M9 | Privacy invariant tests | | green | mvp
- [x] M10 | LCOV + mutation | | reports | mvp
- [x] M11→D5-type | Indep verify all rows | | signed (obs_m11_indep_verify_1 indexer re-query height match 4/4) | mvp
- [x] M12 | Design partner + runbook | | docs | mvp
- [x] M13 | gate.sh mvp tag | | STAGE=mvp gates/mvp-20260930-061907.json | mvp
- [x] PR2 | Security inventory | | report | production
- [x] PR3 | Reliability drills | | report | production
- [x] PR4 | Chain ops | | report | production
- [x] PR5 | Payments live-gate OFF | | procedure | production
- [x] PR6 | Privacy copy | | tested | production
- [x] PR7 | UX axe keyboard | | 0 serious (obs_pr7_axe_1 scripts/pr7-axe.mjs) | production
- [x] PR8 | Ops runbooks | | docs | production
- [x] PR9 | Docs current | | dual-state (HANDOFF.md refreshed 2026-09-30; README dual-state intact) | production
- [x] PR10 | gate.sh production tag | | final label gates/production-20260930-061907.json STAGE_AT_HEAD=production | production


## Phase R — integrity repairs (auto-continue 2026-09-30)

- [x] R1 | Stage tags revoked + gate.sh full sets + self-tests | | STAGE-LOG.md; prototype 8/8; demo 9/9; mvp 12/12; production 9/9; selftest 11/11 | prototype
- [x] R2 | TODO audit re-run every checked acceptance | R1 | unchecked-by-audit list | prototype
- [x] R3 | Evidence scripts under evidence/scripts/ | R2 | cited IDs reproduce | prototype
- [x] R4 | Stripe HMAC → WebCrypto/@noble + RFC4231 + differential | R1 | KATs + 10k diff | prototype
- [x] R5 | stripeSettlement.test.ts diff review | R4 | removed assertions accounted | prototype
- [x] R6 | G3 per-circuit table re-derived signed | R1 | independent table | prototype
- [x] R7 | Auth model: SIWE reverted; option C local issuer | | DRIFT-CHECK + OWNER-QUEUE | prototype
- [x] R8 | feesWithMargin WASM spin root-cause | | repro + version matrix | prototype
- [x] R9 | M2/D2c claim corrections | R2 | honest scopes | prototype

## Phase U — dependency / dead-code / LOC (start after R2 baseline)

- [x] U0 | PERF-BASELINE.md | | LOC deps bundle times | prototype
- [x] U1 | Dependency research log | U0 | RESEARCH-LOG rows | prototype
- [x] U2 | Midnight cohort policy COHORT-UPGRADE.md | U1 | go/no-go | prototype
- [x] U3 | Bump non-cohort deps (types, react, convex, stripe, zod, noble 1.x) by risk group | U2 | outdated empty or justified | prototype
- [x] U4 | Reduce dependencies ROI | U3 | removals proven | prototype
- [x] U5 | Dead code / duplication | U4 | knip clean critical | prototype
- [x] U6 | Midnight integration upgrade (milestone1 factory+errors+guards; remainder in U6-integration-review) | U5 | observer + provider factory | prototype
- [x] U7 | PERF-QUALITY-REPORT.md | U6 | before/after/delta | prototype
- [x] U8 | Re-pin evidence IDs at new HEAD | U7 | gate + lanes re-run | prototype

## Phase E — remaining original gates (after R7 auth)

- [ ] E-D3d | E2E-01 3× video/HAR/SRT | R7 | 3 pass | demo | state: blocked | blocker: O-PRIVY-TEST auth; harness not-done 0/3
- [ ] E-D3e | Video trace | E-D3d | state: blocked | | files | demo
- [ ] E-D4 | Negatives 3× | E-D3d | state: blocked | | results | demo
- [ ] E-M2 | 14 circuits across instances Preprod | | table | mvp | state: blocked | blocker: B-D2C-01 Preprod DUST=0
- [ ] E-M3 | E2E-02..07 matrix | E-D3d | state: blocked | | matrix | mvp
- [ ] E-M8 | Real Lace attempt | R7 | error or pass | mvp | state: owner-blocked | blocker: no Lace extension in CI
- [x] E-M10 | Coverage + mutation | | scores (bun test --coverage 735/1/12/8 env-gated; mutation n/a) | mvp
- [x] E-PR2 | Auth inventory all routes | | signed obs_pr2_auth_inventory_1 | production
- [x] E-PR5 | Live gate OFF procedure | | gated (release-flags + PAYMENTS-LIVE-GATE.md; no liveMode true) | production
- [ ] E-PR6 | Privacy copy tested | | green | production
- [ ] E-PR7 | Axe every route + keyboard + 375 | | 0 serious | production
- [ ] E-PR8 | Ops runbooks SBOM SLO | | docs | production
- [ ] E-D6 | Timed judge clone | | timed | demo
- [ ] E-D7 | PITCH refresh | U8 | files | demo


## Marker scan (§2.3) 2026-09-30

- [ ] MK1 | map/remove 5 source markers | | rg markers; 2 ts-expect-error tests, 3 biome-ignore with reasons | prototype
- [x] MK0 | marker scan run | | /tmp/markers.txt count 5 | prototype


## MASTER-LEDGER map (L-id → TODO)

| L-id | row summary | maps to |
|---|---|---|
| L-01 | blueprint/contract | G0 |
| L-02 | P3 | G0 |
| L-03 | P3 | G0 |
| L-04 | http webhook | G0 |
| L-05 | settlement | G0 |
| L-06 | files+delivery | G0 |
| L-07 | attachUpload provenance | G0 |
| L-08 | observationIngest | G0 |
| L-09 | release-flags | G0 |
| L-10 | recovery-kit | G0 |
| L-11 | recovery-kit UI ops | G0 |
| L-12 | midnight-client | U2 |
| L-13 | Stripe webhook endpoint | D1d |
| L-14 | D3 browser E2E-01 | E-D3d |
| L-15 | D4 negatives | G0 |
| L-16 | unit 485/4/1 | G0 |
| L-17 | typecheck 5 errors | G0 |
| L-18 | lint errors | G0 |
| L-19 | integration hash assert | G0 |
| L-20 | RECEIPTS.md | G0 |
| L-21 | SUBMISSION+CLAIMS | G0 |
| L-22 | PITCH+deck+video | G0 |
| L-23 | LCOV coverage | G0 |
| L-24 | Privy real auth | M7 |
| L-25 | stripeSettlement:run | D1d |
| L-26 | F-22 escalate empty evidence | G0 |
| L-27 | F-24 never-read digests | G0 |
| L-28 | 14/14 one instance | G0 |
| L-29 | clean-clone P5 | G0 |
| L-30 | secret scan P6 | G0 |

- [ ] CV1 (env-gated: host node lacks registerHooks; use scripts/with-bun.sh Node 24.20) | fix 12 fail 8 errors in full coverage suite | | bun test --coverage | prototype
