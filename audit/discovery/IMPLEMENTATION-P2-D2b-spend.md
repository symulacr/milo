# IMPLEMENTATION-P2-D2b-spend.md

| Field | Value |
|---|---|
| Task | TODO **D2b** — SPEND-LEDGER + faucet / balance script |
| Stage | demo |
| Date | 2026-09-30 |
| Repo | `/home/eya/milo/milo-main` |
| Evidence criterion | balance script |
| Deliverables | `SPEND-LEDGER.md`, `scripts/spend-balance.mjs`, this report; `RECEIPTS.md` cross-ref |

---

## 1. Outcome

D2b complete for the spend surface:

1. **Fee estimates first** — local staged-deploy fees taken via `wallet.calculateTransactionFee` **before** submit (`bootstrap-wallet-fee-estimate` in `/tmp/d2a-local4.out`): 30 + 29 + 1 = **60 specks** with margin.
2. **SPEND-LEDGER.md** — per-tx `hash | purpose | fee | block | chain height`, covering the 3 local staged-deploy txs and Preprod rows from `RECEIPTS.md`.
3. **Balance script** `scripts/spend-balance.mjs` — reads chain heights / fee table / (optional) wallet balances **without echoing the seed**.
4. **Faucet** documented (tNIGHT Nethermind faucet, unshielded-only, 1000 tNIGHT/dose) with the funding address and seed policy.
5. **RECEIPTS.md** updated with a spend cross-ref so local + Preprod rows appear in both artifacts.

---

## 2. Fee estimation (before spend)

Order enforced by the local lane (`packages/integration/src/local.mjs:282-294`) and recorded here:

`estimate (`calculateTransactionFee`) → record → prove → submit → finalize → ledger`

| Stage | hash | fee est (specks + margin) | block | chain height at tx |
|---|---|---|---|---|
| MID-T01-staged-deploy | `0746d21e488f46698910e6fd0bf016f6a0a0a3d54db91c0af080bf07e0e5205c` | 30 | 701 | 701 |
| MID-T01-staged-install | `8b59ea5be0e0101ed599ada21db7a1e837da9e1485db0c69c9e13698cbcaa48c` | 29 | 704 | 704 |
| MID-T01-staged-lock | `40ade7947a0f70cb78eaa715b10d422650f838cd00d16e95993ea85ccc2b6a39` | 1 | 707 | 707 |
| **Total** | 3 txs | **60** | | |

Related funding (not staged-deploy): `43506e61576418638c180984c0bb52ff571b7ce57c9947a52d2059a9ccb9d720` block 691 (`fresh-buyer-funding`).

Source: `/tmp/d2a-local4.out` (`staged-bootstrap-complete-nonadmitted`, `feeEstimates`, `totalFeeEstimateSpecksWithMargin: 60`).

---

## 3. Preprod rows (from RECEIPTS.md)

| hash | purpose | fee | block | chain height |
|---|---|---|---|---|
| `5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58` | `ContractUpdate` / replaceAuthority on `b95c8243…e74586` | not captured (pre-D2b receipt) | 2639638 | 2765910 (read 2026-09-29) / 2769108 (re-query 2026-09-30) |

Indexer re-query confirms `contractAction.transaction.hash` and `block.height` match RECEIPTS.md.

---

## 4. Balance script (never prints seed)

`scripts/spend-balance.mjs`

| Mode | What it does | Seed |
|---|---|---|
| `--audit` (default) | addresses, local + Preprod chain heights, latest Preprod action, fee table, faucet | loaded, **redacted**; prints length only |
| `--local` | local node tip + 3 staged fee rows | not required |
| `--wallet` | delegates to `preprod-lane.mjs --check` for live NIGHT/DUST | passed via env, **never argv**; child stdout/stderr redacted |

Hard guarantees:
- `redact()` strips the seed value from every stdout/stderr line.
- Seed is never written to files, logs, or the ledger.
- Verified: `seed_in_output=False`, `seed_in_ledger=False`, `seed_in_script_source=False`, `leak_count=0` (EV-D2b-verify).

Sample (`--audit`, seed redacted):

```
seed: present (64-hex, length 64, value redacted)
local-chain-height: 912
preprod-chain-height: 2769178
preprod-latest-tx: 5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58
total-staged-deploy-fee-estimate: 60
```

---

## 5. Faucet

| Item | Value |
|---|---|
| URL | https://midnight-tmnight-preprod.nethermind.dev/ |
| Dose | 1000 tNIGHT / request, captcha-gated |
| Fund this address | `mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7` (unshielded only) |
| DUST | accrues from registered NIGHT; registration spends the generating UTXO |
| Seed store | `.env.preprod` (0600, gitignored) — never commit, never echo |
| Local faucet | genesis mint → `fresh-buyer-funding` tx above |

---

## 6. Files touched

| Path | Change |
|---|---|
| `SPEND-LEDGER.md` | **new** — spend table + fee policy + faucet |
| `scripts/spend-balance.mjs` | **new** — seed-safe balance / fee / chain-height reader |
| `RECEIPTS.md` | appended D2b spend cross-ref (local 3 txs + Preprod row) |
| `audit/discovery/IMPLEMENTATION-P2-D2b-spend.md` | **new** — this report |

---

## 7. Residual

- Preprod **observed** on-chain fee for `5ce74cb9…` is still not captured (RECIPTS predates D2b). Next Preprod spend (D2c) should record `calculateTransactionFee` estimate **and** settle the observed fee.
- `--wallet` mode requires a synced Preprod wallet (long first sync); `--audit` is the instant evidence path and is what this report ran.
- Local chain tip advances (855 → 912 during verification); heights in the ledger are **at tx time**, not current tip.
