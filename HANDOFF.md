# HANDOFF.md

## State
- Stage: PROTOTYPE (gate.sh 8/8, self-tests 4/4) at HEAD ~52c16fa
- G0 done. G1 done (75 ledger rows). G2 done (integration 143/0). G3 keys 14/14 IDENTICAL (partial action list). G4 7/7 negative controls. G5 secrets clean. G6 gate green.
- Unit 493/0/0. typecheck/lint/build 0. Contract canonical 0bede3fb.

## Next 5 IDs
1. D1a deploy convex to tremendous-rooster-473 + function-spec
2. D1b webhook bad-signature reject cases
3. D1c real Stripe test event
4. D1d stripeSettlement:run rebuild
5. D2a local Midnight happy path

## Risks
- G3 14 Call rows not fully enumerated
- Online evidence 24h staleness
- Owner items in OWNER-QUEUE.md

## Evidence
E-GATE-01 E-SELF-01 E-NC-01..05 E-SIG-01 E-G3-STATE-01 E-SEC-01 E-RECV-01

CONTINUE: D1a
