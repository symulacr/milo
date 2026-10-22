# M3 — E2E-02..07 ×3 matrix

Chain-layer matrix from `obs_m2_circuit_sweep_1` (pass 1) plus two more
`obs_m3_matrix_1` sweeps (passes 2–3). UI journeys (browser) still require
auth (D3d / O-PRIVY); those cells stay empty until then.

## Scenarios (E2E-02..07 + extras)

| ID | Scenario | Circuits driven | Pass1 | Pass2 | Pass3 |
|---|---|---|---|---|---|
| E2E-01 | happy-path | reserve,accept,submitDelivery,approve | 4/4 | 14/14 | 14/14 |
| E2E-02 | cancel | reserve,cancelReserved | 2/2 | 14/14 | 14/14 |
| E2E-03 | decline | reserve,decline | 2/2 | 14/14 | 14/14 |
| E2E-04 | dispute-buyer | reserve,accept,disputeBuyer,resolve | 4/4 | 14/14 | 14/14 |
| E2E-05 | dispute-merchant | reserve,accept,disputeMerchant,resolve | 4/4 | 14/14 | 14/14 |
| E2E-06 | expire-* | expireBootstrap,expireReserved,expireUndelivered,expireDispute | 4/4 | 14/14 | 14/14 |
| E2E-07 | escalate-unreviewed | escalateUnreviewed (+ reserve/accept) | 1+ | 14/14 | 14/14 |

## UI cells (browser / video / HAR)

Blocked on auth (O-PRIVY-TEST or option C live local Convex). Not claimed.

## Evidence

- Pass 1: `obs_m2_circuit_sweep_1` · `M2-circuit-table.md`
- Passes 2–3: `obs_m3_matrix_1` (running)


## Result (2026-09-30)

| Pass | circuits SucceedEntirely | evidence |
|---|---|---|
| 1 | 14/14 | obs_m2_circuit_sweep_1 |
| 2 | 14/14 | obs_m3_matrix_1 run 2 |
| 3 | 14/14 | obs_m3_matrix_1 run 3 |

Chain-layer E2E-02..07 matrix: **3× PASS (14/14)**.
UI browser cells remain open (auth).
