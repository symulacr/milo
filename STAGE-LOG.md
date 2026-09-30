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

## 2026-09-30 — Phase 0 false-positive revocation

Demo/mvp/production gates passed without E2E-01 3× evidence, Preprod real-fee
happy path, or an observer service. Those tags are mis-issued.

| Tag | Verdict | Action |
|---|---|---|
| stage/demo-* (none currently) | — | — |
| stage/mvp-0cdeb04 | REVOCATION | delete |
| stage/mvp-105c27b | REVOCATION | delete |
| stage/mvp-5f760ca | REVOCATION | delete |
| stage/mvp-ff4bdd3 | REVOCATION | delete |
| stage/production-0cdeb04 | REVOCATION | delete |
| stage/production-5f760ca | REVOCATION | delete |
| stage/production-ff4bdd3 | REVOCATION | delete |
| stage/prototype-* | retained | prototype only |

True stage recomputed after gate substance tightening: **PROTOTYPE**.


## 2026-09-30 — Phase 0.1 true stage

| Stage | Result | Label |
|---|---|---|
| prototype | 8/8 | **PROTOTYPE** |
| demo | 8/9 (D9 needs E2E-01 3x or Preprod 4/4) | NONE |
| mvp | 11/14 (browser matrix, observer) | NONE |
| production | 8/9 (Preprod real fees + observer) | NONE |

ONE label at HEAD: **PROTOTYPE**.
