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
