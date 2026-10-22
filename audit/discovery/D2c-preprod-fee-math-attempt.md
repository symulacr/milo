# D2c Preprod happy path — attempt with real fee estimation (Agent A)

Date: 2026-09-30T15:04Z
Branch: wt/R6-D2c
Evidence IDs: `obs_d2c_preprod_fee_math_1`, `obs_d2c_preprod_dust_blocker_1`, `obs_d2c_preprod_sweep_1`

## Verdict: **NOT LANDED** — DUST fee balancing fails closed

| Step | Status | Evidence |
|---|---|---|
| Allow gate `MILO_PREPROD_ALLOW=disposable-owned-preprod` | DONE | env loaded from `.env.preprod` (seed never printed) |
| flock `.locks/preprod-wallet.lock` | DONE | lock-acquired both runs |
| fee-math `installFeeMath` wired into `preprod-lane.mjs` | DONE | erase-proofs mode; Preprod refuses local-fixed |
| wallet-state restore | DONE | 16/16 PASS, `safeForFastPath=true` |
| Proof server `http://127.0.0.1:6300` | DONE | `{"status":"ok"}` |
| Fee path (no WASM spin) | DONE | `installFeeMath` reached dust balancing (previously spun) |
| Happy-path tx hashes | **NOT DONE** | `Wallet.InsufficientFunds: could not balance dust` |
| Indexer read-back of new calls | **NOT DONE** | no new call txs submitted |
| Night balance | VERIFIED | `35000000000` specks |
| DUST balance | **0 / insufficient** | blocker |

## Exact rejection output (`obs_d2c_preprod_dust_blocker_1`)

```
{"event":"staged-deploy-planned","network":"preprod","address":"9ce32a5ab48f000c6c48b6754327b6804b01e557d39e4987b8d499d61a71b375",
 "initialNames":["accept","approve","cancelReserved","decline","disputeBuyer","disputeMerchant","escalateUnreviewed"],
 "remainingNames":["expireBootstrap","expireDispute","expireReserved","expireUndelivered","reserve","resolve","submitDelivery"],
 "initialOperationCount":7,"finalOperationCount":14}
{"event":"staged-deploy-failed","address":null,"deployLanded":false,"deploy":null,"inserts":[],
 "name":"(FiberFailure) Wallet.InsufficientFunds",
 "message":"Insufficient Funds: could not balance dust",
 "receiptPath":".hoplite/artifacts/preprod/staged-deploy-happy-path.json","receiptPersisted":true}
{"event":"call-rejected","scenario":"happy-path","circuit":"deploy","actor":null,"negative":false,
 "errorNames":["StagedDeployError"],"message":"Staged deploy failed: Insufficient Funds: could not balance dust"}
{"event":"sweep-complete","summary":[{"scenario":"happy-path","deployed":false,
 "error":"Staged deploy failed: Insufficient Funds: could not balance dust"}],"negatives":[]}
```

## Command (exact)

```bash
flock .locks/preprod-wallet.lock \
  env $(grep -E '^MIDNIGHT_PREPROD_|^MILO_PREPROD_' .env.preprod | xargs) \
  MILO_SWEEP_ONLY=happy-path \
  MIDNIGHT_PREPROD_RUN_DIR=$PWD/.hoplite/artifacts/preprod \
  node packages/integration/src/preprod-lane.mjs --sweep
```

Exit code: **0** (sweep records failure in receipts; does not crash).  
Full log: `/tmp/milo-a/d2c-sweep2.txt`.

## fee-math wiring (product fix reached Preprod)

`packages/integration/src/preprod-lane.mjs` `loadWalletSdk()` now calls:

```js
const feeMath = installFeeMath({
  env: process.env,
  networkId: config.networkId,   // "preprod"
  Transaction: ledger.Transaction,
});
if (feeMath.mode !== "erase-proofs") {
  throw new Error("preprod forbids local-fixed fee math");
}
```

This is the R8 product-side fix: `feesWithMargin` is priced on `eraseProofs()`
copies. The previous WASM spin on proved call txs did **not** recur; the run
reached dust balancing and failed on **funds**, not on fee math.

## DUST status

| Item | Value |
|---|---|
| NIGHT (unshielded) | `35000000000` specks |
| DUST observed | `0` (insufficient for deploy fee) |
| UTXOs | 7 available, 0 pending, all `registeredForDustGeneration` |
| DUST address | `mn_dust_preprod1wwlf7gc680h3gqx8pr6rc4mu4eaz2kfn3fgfev9mrsncsw7ez0k5c2g8f5x` |
| Wallet-state | restored from milo-main snapshot, 16/16 PASS |
| Faucet | tNIGHT only (captcha); DUST accrues from registered NIGHT over time |

## Indexer read-back (unchanged Preprod contract)

| Fact | Value | Status |
|---|---|---|
| Network | Midnight Preprod | VERIFIED-ONCHAIN |
| Contract | `b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586` | VERIFIED-ONCHAIN |
| Latest action | `ContractUpdate` | VERIFIED-ONCHAIN |
| Latest tx | `5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58` | VERIFIED-ONCHAIN |
| Block (state) | `2639638` | VERIFIED-ONCHAIN |
| Chain tip at read | `2776549` | VERIFIED-ONCHAIN |
| New happy-path tx | **none** | NOT LANDED |

## NOT DONE (D2c remains unchecked)

1. **Happy-path tx hashes** — deploy cannot balance DUST fee. Exact error above.
2. **Indexer read-back of new calls** — nothing submitted.
3. **Real fee estimate recorded** — `fee-estimate-first` emit is wired in
   `preprod-lane.mjs` `submitTx`, but submit never ran.
4. **DUST top-up** — needs time-based accrual on the 7 registered UTXOs, or a
   DUST-bearing faucet (none known). NIGHT faucet does not mint DUST.

## Unblock options (owner / next agent)

1. Wait for DUST accrual on the 7 registered UTXOs, re-run `--sweep`.
2. Register additional NIGHT UTXOs (`--register-dust`) after a NIGHT faucet top-up.
3. Use a local disposable chain for call-tx fee proof (already done: `obs_d2a_local_happy_complete_1`).
4. Do **not** fake hashes or enable `MILO_ALLOW_FIXED_LOCAL_FEE` on Preprod.

## Files

- `packages/integration/src/fee-math.mjs` — product fix
- `packages/integration/src/preprod-lane.mjs` — `installFeeMath` wiring
- `.hoplite/artifacts/preprod/staged-deploy-happy-path.json` — failure receipt
- `/tmp/milo-a/d2c-sweep2.txt` — full command log (ephemeral)
