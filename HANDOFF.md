# HANDOFF.md

## State (2026-09-30 after R1–R4 + U0)

- **R1 DONE**: mis-issued demo/mvp/production tags revoked (STAGE-LOG.md).
  Rebuilt gate.sh: prototype 8 · demo 9 · mvp 12 · production 9 (substance).
  Self-tests 11/11 mutations must FAIL. **Honest stage: PROTOTYPE** (higher
  tags suppressed until R2/E audit).
- **R2 DONE**: TODO audit — unchecked PR7 (axe scope), M11→D5-type, M8 (owner),
  D10/M13/PR10 (tags), M2 (re-scope), D2c (need Preprod hashes). Report:
  `audit/discovery/R2-TODO-AUDIT.md`.
- **R3 DONE**: evidence scripts under `evidence/scripts/` by evidence ID.
- **R4 DONE**: Stripe HMAC → `@noble/hashes` + WebCrypto async. RFC 4231 KATs,
  Stripe shape, ±5 min, 10k differential vs node:crypto (12/12 pass).
- **R7 DONE (revert)**: SIWE login change reverted to email model; owner options
  A/B/C in DRIFT-CHECK.md + OWNER-QUEUE `O-PRIVY-AUTH`.
- **U0 DONE**: PERF-BASELINE.md (src 70855 / tests 16720 / docs 19389 / gen 3850;
  deps direct 22 transitive ~930; unit 562/0; typecheck clean; app bundle 5.4MB raw).
- Unit 562/0 · typecheck 0 · prototype gate 8/8.
- Acceptance dual-state unchanged: 14/14 execution · 0/6 · 0/14.

## Next (in order)

1. **R5** stripeSettlement.test.ts diff review (removed assertions).
2. **R6** G3 per-circuit table re-derive (independent agent).
3. **R8** feesWithMargin WASM spin root-cause + version matrix.
4. **R9** claim corrections (M2/D2c scopes already un-checked).
5. **U1** dependency research log (npm view / release notes).
6. **U2** COHORT-UPGRADE.md go/no-go (do not bump Midnight cohort in main line).

## Owner (OWNER-QUEUE.md)

O-PRIVY-TEST, O-PRIVY-AUTH (A/B/C), O-PUSH, O-HOST, O-LIVE-STRIPE, O-MAINNET,
M8 Lace gap, F-22, F-24.

CONTINUE: R5 stripeSettlement.test.ts diff review
