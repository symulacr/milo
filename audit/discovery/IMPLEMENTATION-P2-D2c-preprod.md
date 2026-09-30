# IMPLEMENTATION-P2-D2c-preprod.md

| Field | Value |
|---|---|
| Task | TODO **D2c** — Preprod happy path, funded wallet |
| Stage | demo |
| Date | 2026-09-30 |
| Repo | `/home/eya/milo/milo-main` |
| Evidence criterion | receipts rows (tx hashes + indexer read-back + ingest verdict) |
| Label | **SDK-connector / harness** |
| Gate | `MILO_PREPROD_ALLOW=disposable-owned-preprod` |
| Seed policy | `.env.preprod` only (0600); never printed, never committed |

---

## 1. Outcome (partial)

Preprod lane was brought up on a **funded** disposable wallet and the happy-path
sweep (`reserve → accept → submitDelivery → approve`, `MILO_SWEEP_ONLY=happy-path`)
was launched via `preprod-lane.mjs --sweep`. The run **did not land happy-path
transactions** because staged deploy failed closed on **DUST fee balancing**.

| Step | Status | Evidence |
|---|---|---|
| Allow gate + env load | DONE | `MILO_PREPROD_ALLOW=disposable-owned-preprod` added to `.env.preprod`; lane rejects without it |
| Funded wallet | DONE | NIGHT `35000000000` specks, 7 UTXOs, unshielded `mn_addr_preprod1y7kqu30…c2n4h7` |
| DUST seed (fast start) | DONE | `--seed-dust` roots verified, snapshot `wallet-state/dust.json`, 5.8s |
| Wallet-state verify | DONE | 16/16 PASS, `safeForFastPath`, UTXO crosscheck 7=7 |
| Fee estimates first | WIRED | `fee-estimate-first` emit on `submitTx` (see §2) |
| Happy-path tx hashes | **NOT DONE** | staged deploy: `Wallet.InsufficientFunds: could not balance dust` |
| Indexer read-back | DONE | §3 |
| Ingest verdict | DONE (deployment) / **MISSING** (chain) | §4 |
| Faucet research | DONE | §5 |

---

## 2. Fee estimates first (SPEND-LEDGER.md)

Order enforced: **estimate → record → prove → submit → finalize → ledger**.

Patched `packages/integration/src/preprod-lane.mjs` `walletProvider.submitTx` to call
`session.wallet.calculateTransactionFee(tx)` **before** `session.submitter.submit(tx)`
and emit `fee-estimate-first` with `feeEstimateSpecksWithMargin` (bigint specks, with
margin). This mirrors `local.mjs` `bootstrap-wallet-fee-estimate`.

Because the happy-path deploy never reached submit (DUST shortfall), **no new
Preprod fee estimate was recorded this run**. Existing ledger fee rows (local
staged-deploy 30+29+1=60 specks) stand unchanged. DUST readiness path
(`dust.mjs:balanceWithDustReadiness`) already estimates via
`calculateTransactionFee` + `estimateTransactionFee` before balancing.

---

## 3. Indexer read-back (2026-09-30T03:22:25Z)

Endpoint: `https://indexer.preprod.midnight.network/api/v4/graphql`

```graphql
query { contractAction(address: "b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586") {
  __typename address transaction { hash block { height } }
} }
query { block { height hash } }
```

| Fact | Value | Status |
|---|---|---|
| Contract | `b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586` | VERIFIED-ONCHAIN |
| Latest action | `ContractUpdate` | VERIFIED-ONCHAIN |
| Latest tx | `5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58` | VERIFIED-ONCHAIN |
| Block (state) | `2639638` | VERIFIED-ONCHAIN |
| Chain tip at read | `2770140` (`2692676df52d2fbb02a1c11466354c3314cff73d425e658c0908af0f23c85496`) | VERIFIED-ONCHAIN |

No new happy-path tx appeared (none submitted).

---

## 4. Ingest verdict

CLI: `bun scripts/ingest-observation.ts` (SDK-connector / harness).

### 4a. Deployment ingest — **VERDICT: recorded**

Document: `observationIngest:recordDeployment`, `observedAt` in **milliseconds**.

```json
{ "kind": "recorded", "observationId": "obs_d2c_preprod_1" }
```

Address `b95c8243…e74586`, `observationVersion: 2`, `source: chain-observer`,
`phase: DEPLOYED`, `revision: 0`, `maintenancePolicy: locked`, 14 entrypoints.
First attempt with second-resolution `observedAt` was rejected
(`stale deployment observation`); ms epoch is required.

### 4b. Chain ingest — **VERDICT: blocked (function missing)**

Dry-run plan: `{"kind":"chain","fn":"orders:recordObservation","orderId":"order_d2c_probe"}`

Live: **failed** — Convex has no `orders:recordObservation`:

```
Could not find function for 'orders:recordObservation'.
Available: … observationIngest:recordDeployment …
```

`convex/orders.ts` is **absent** (referenced by `order-record-runtime.ts` and
`CHAIN_FN` in `scripts/ingest-observation.ts`, never implemented). Chain bind
verdicts (`bind | stale | contradictory | address-claimed`) cannot be written
until that module exists.

---

## 5. Faucet / DUST

| Item | Value |
|---|---|
| tNIGHT faucet | https://midnight-tmnight-preprod.nethermind.dev/ |
| Dose | 1000 tNIGHT / request, captcha-gated |
| Address to fund | `mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7` (unshielded only) |
| Refuses | shielded + DUST addresses |
| DUST source | accrues from registered NIGHT; 7 UTXOs already `registeredForDustGeneration` |
| Observed DUST | `0` after ~10 min poll (`dust-already-registered`, no accrual yet) |
| Seed | `.env.preprod` only — never printed |

Faucet URL reachable (Cloudflare 403 on bare HEAD is expected captcha gate).
DUST shortfall is the happy-path blocker: staged deploy needs DUST to balance
its fee; NIGHT alone is insufficient (`Insufficient Funds: could not balance dust`).

---

## 6. Wallet / sync (preprod-lane patterns)

| Item | Value |
|---|---|
| Mode | `--seed-dust` then snapshot restore |
| DUST seed | roots verified, cutoff event `1575327`, snapshot 7283 B, 5.8s |
| Shielded | 7 UTXO crosscheck PASS, applied `613961` |
| Unshielded | `availableCoins=7 pending=0`, applied `613961` |
| Dust snapshot | `wallet-state/dust.json` (0600) |
| Verification | 16/16 PASS, receipt `wallet-state-verification.json` |
| NIGHT balance | `35000000000` specks |
| DUST balance | `0` specks |
| Proof server | `http://127.0.0.1:6300` (loopback, required) |

Prior interrupted sync marker was reported (`previous-run-interrupted`, pid 1038193)
and the seed-dust path restarted cleanly.

---

## 7. Files touched

| Path | Change |
|---|---|
| `.env.preprod` | added `MILO_PREPROD_ALLOW=disposable-owned-preprod` (seed untouched) |
| `packages/integration/src/preprod-lane.mjs` | `submitTx` fee-estimate-first emit |
| `RECEIPTS.md` | D2c section |
| `SPEND-LEDGER.md` | D2c Preprod rows + DUST/faucet note |
| `audit/discovery/IMPLEMENTATION-P2-D2c-preprod.md` | this report |

Runtime artifacts (ignored): `.hoplite/artifacts/preprod/*`
(`transactions.jsonl`, `wallet-state/`, `staged-deploy-happy-path.json`).

---

## 8. NOT DONE

1. **Happy-path tx hashes** — `reserve` / `accept` / `submitDelivery` / `approve`
   never submitted. Staged deploy failed at fee balancing:
   `Wallet.InsufficientFunds: could not balance dust`
   (`call-rejected` scenario `happy-path` circuit `deploy`).
2. **Preprod fee estimates for happy-path txs** — `fee-estimate-first` is wired
   but no submit occurred, so no specks estimate landed in SPEND-LEDGER this run.
3. **DUST accrual** — 7 NIGHT UTXOs report `registeredForDustGeneration=true`
   but wallet DUST stayed `0` over ~10 minutes. Accrual rate may need longer
   wall time or a larger NIGHT stake; faucet is captcha-gated (manual).
4. **`orders:recordObservation`** — missing Convex module (`convex/orders.ts`).
   Chain ingest / bind-verdict path cannot run. Deployment ingest works.
5. **Full `--sweep` (14 circuits + negatives)** — not attempted; only
   `MILO_SWEEP_ONLY=happy-path` was targeted, and that failed at deploy.
6. **Observed on-chain fee** for `5ce74cb9…` still not captured (pre-D2b receipt).

### Next actions

- Wait for DUST accrual (or larger registered NIGHT), re-run
  `MILO_SWEEP_ONLY=happy-path` `--sweep`; capture `fee-estimate-first` rows
  then `call-finalized` txIds.
- Implement `convex/orders.ts` `recordObservation` and re-run chain ingest.
- Indexer read-back of the new happy-path txs and append SPEND-LEDGER rows.