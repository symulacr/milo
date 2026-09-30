# STAGE-LOG.md

Append-only record of stage tag issuance and revocation.

## 2026-09-30 — R1 integrity repair (campaign auto-continue)

The pre-R1 `gate.sh` demo/mvp/production arms only asserted file existence or a
`[x]` in TODO.md. Those are not substance checks. Tags issued from those arms
are **mis-issued** and revoked.

| Tag | HEAD | Issued by | Verdict | Action |
|---|---|---|---|---|
| `stage/demo-3f5770d` | `3f5770d89c14c6ae43ddf62bd3384b80d4f0b9d0` | weak demo arm (`RECEIPTS.md` contains `VERIFIED-ONCHAIN`) | **REVOCATION** | delete |
| `stage/mvp-3f5770d` | `3f5770d89c14c6ae43ddf62bd3384b80d4f0b9d0` | weak mvp arm (`grep [x] TODO.md`) | **REVOCATION** | delete |
| `stage/production-3f5770d` | `3f5770d89c14c6ae43ddf62bd3384b80d4f0b9d0` | weak production arm (same as mvp) | **REVOCATION** | delete |
| `stage/prototype-*` | various | prototype 8-check arm (substance) | retained | none |

After revocation the highest honest stage at HEAD is **PROTOTYPE at most**,
recomputed only if G2–G5 evidence reproduces under the rebuilt gate.

Rebuilt check sets: prototype 8 · demo 9 · mvp 12 · production 9.
Each check runs a real command; mutated inputs must FAIL (gate-selftest.sh).


## 2026-09-30 — R1 recompute after rebuilt gates

| Stage | Checks | Result | Tagged? |
|---|---|---|---|
| prototype | 8 | 8/8 PASS | yes (`stage/prototype-3f5770d`) |
| demo | 9 | 9/9 PASS | **suppressed** (R1: PROTOTYPE at most) |
| mvp | 12 | 12/12 PASS | **suppressed** |
| production | 9 | 9/9 PASS | **suppressed** |

Self-tests: 11/11 mutations FAIL as required; clean tree prototype.
Higher-stage tags remain revoked until R2 re-audits checked TODO items and
owner-acceptance rows (acceptance dual-state 0/6 · 0/14 unchanged).

**Honest stage label at HEAD `3f5770d`: PROTOTYPE.**
