# evidence/scripts

Scripts pinned to evidence IDs. Re-run these commands at HEAD to reproduce
receipts. Scratch helpers stay ignored.

| Evidence ID | Script | Command |
|---|---|---|
| obs_d2a_local_happy_complete_1 | obs_d2a_local_happy_complete_1.mjs (+ .run.sh) | `bash evidence/scripts/obs_d2a_local_happy_complete_1.run.sh` |
| obs_m2_multi_instance_1 | same as D2a, second fresh instance | run the `.run.sh` twice |
| obs_m11_indep_verify_1 | scripts/m11-verify.mjs | `node scripts/m11-verify.mjs` |
| obs_pr7_axe_1 | scripts/pr7-axe.mjs | `node scripts/pr7-axe.mjs` |
| obs_d2c_preprod_1 | packages/integration/src/preprod-*.mjs | see docs/RECEIPTS.md |
| obs_m2_circuit_sweep_1 | packages/integration/src/local-circuit-sweep.mjs (+ .run.sh) | `bash evidence/scripts/obs_m2_circuit_sweep_1.run.sh` |
