# WORKLOG.md

## 2026-09-29
- Created TODO.md. Starting G0.
G0 | gate audit + self-tests | | SELFTEST_EXIT=0 | prototype
G2 | integration 143/0 | test:integration exit 0
D1a | deploy 37 functions | function-spec
D1b | rejects 400/413 accept 200 | curl+python hmac
D1c | pi_3ULApvIDa2vgC4L910VVRFbO inbox row dedup
D1d | stripeSettlement:run deployed | function-spec
D2a | compose healthy | wallet sync blocked B-D2A-01
D7 | PITCH deck video submission | files

## 2026-09-30 R1 integrity repairs
- Revoked mis-issued stage/demo|mvp|production tags (weak gate arms). Logged in STAGE-LOG.md.
- Rebuilt scripts/gates/gate.sh check sets: prototype 8, demo 9, mvp 12, production 9 (substance).
- gate-selftest.sh: 11 mutations must FAIL; all OK.
- R7: reverted Privy SIWE login to documented email model; OWNER-QUEUE O-PRIVY-AUTH.
- Honest stage at HEAD 3f5770d: PROTOTYPE (higher tags suppressed until R2 audit).


## 2026-09-30 R2 TODO audit
- Re-ran acceptance on checked items. Unchecked: PR7 (axe scope), M11 (relabel D5-type),
  M8 (owner), D10/M13/PR10 (tags revoked), M2 (re-scope), D2c (need Preprod tx hashes).
- Report: audit/discovery/R2-TODO-AUDIT.md
- Counts after audit: see script output in HANDOFF.

## 2026-09-30 S0/S1 coordinator
- Scripts: next-task.sh, todo-check.sh, ownership-check.sh, net-health.sh, todo_lib.py, master-ledger-rebuild.sh.
- Claims: A wt/R6-D2c (D2c/R6/R8/R9) · B wt/R7C-e2e (R7C/E2E) · disjoint ownership.
- Bundle gzip/brotli measured. Full coverage suite env-gated (registerHooks / isolated Node).
- next-task prints D2c until Agent A lands Preprod hashes.

## 2026-09-30 agent merges
- A: R8 fee-math, R6 signed keys, R9 table, D2c attempt (DUST blocker).
- B: R7C test issuer + E2E-01 scaffold + CLICK-MAP verify.
- D2c marked blocked B-D2C-01 (DUST=0). Fee spin fixed.

## 2026-09-30 M2 complete
- A2 local-circuit-sweep: 14/14 circuits, 10 instances, 30 SucceedEntirely rows.
- Evidence: obs_m2_circuit_sweep_1 · M2-circuit-table.md
