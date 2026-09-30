# HANDOFF.md

## State (2026-09-30 post A/B merge)

- S0 scripts live: next-task, todo-check, ownership-check, net-health, master-ledger-rebuild.
- Merged `wt/R7C-e2e` (B) and `wt/R6-D2c` (A) into `publish`.
- **R8 product fix landed** (`installFeeMath` eraseProofs): fee-math 6/6; Preprod no longer spins.
- **R6 signed 14/14 keys** `obs_r6_g3_circuit_keys_1` table sha `fd05fe68…`.
- **R9 circuit table** `obs_r9_circuit_call_table_1` (local 4/14 called).
- **R7C** test JWT issuer e2e-gated; 19/19 boundary; CLICK-MAP 13/13 no drift.
- **D2c BLOCKED** `B-D2C-01`: Preprod DUST=0 after `dust-already-registered`;
  `Wallet.InsufficientFunds: could not balance dust`. NIGHT=35e9 specks.
  Fee math is fine; need DUST accrual or more registered NIGHT UTXOs.
- Unit 562/0 · typecheck 0 · e2e-boundary 19/19 · fee-math 6/6.

## Next

1. Retry D2c after DUST accrual (`preprod-lane --check` then `--sweep` happy-path).
2. U3 non-cohort dep bumps (SOLO) if D2c stays blocked.
3. Local remaining-10-circuit calls for M2 table.

CONTINUE: D2c retry after DUST accrual
