# R2 TODO audit

Date: 2026-09-30  HEAD: 6688e7a

| Item | Verdict | Evidence | Note |
|---|---|---|---|
| G6/gate-prototype | KEEP | `gates/prototype latest` | prototype 8/8 |
| D2a | KEEP | `obs_d2a_local_happy_complete_1` | local happy path hashes |
| D3c | KEEP | `sdk-connector-prod-boundary` | prod bundle boundary |
| PR7 | UNCHECK | `obs_pr7_axe_1` | R2: axe only 3 HTML entries; not every route × state; STAYS OPEN |
| M11 | UNCHECK | `obs_m11_indep_verify_1` | R2: re-label as D5-type re-query; not full row verification |
| M8 | UNCHECK | `OWNER-QUEUE M8` | R2: needs owner accept/reject Lace gap |
| D10/M13/PR10 | UNCHECK | `STAGE-LOG revocations` | R2: weak tags revoked; remaining=none |
| D5 | KEEP | `RECEIPTS.md` | on-chain rows present |
| D2c | KEEP | `SPEND-LEDGER/RECEIPTS` | preprod rows |
| M2 | UNCHECK | `obs_m2_multi_instance_1` | R2: re-scope; 2 happy-path instances ≠ 14 circuits across instances |
| unit-suite | KEEP | `bun test:unit` | unit summary |

## Unchecked after audit

- **PR7** — R2: axe only 3 HTML entries; not every route × state; STAYS OPEN
- **M11** — R2: re-label as D5-type re-query; not full row verification
- **M8** — R2: needs owner accept/reject Lace gap
- **D10/M13/PR10** — R2: weak tags revoked; remaining=none
- **M2** — R2: re-scope; 2 happy-path instances ≠ 14 circuits across instances
