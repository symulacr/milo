# R8 minimal repro — feesWithMargin spin on proved call txs

Date: 2026-09-30T13:39:58.391Z
Mode: synthetic

## Version matrix

| Package | Version | Role |
|---|---|---|
| @midnight-ntwrk/ledger-v8 | 8.1.2 | WASM feesWithMargin / eraseProofs |
| @midnight-ntwrk/wallet-sdk | 1.2.0 | facade calculateTransactionFee / balanceUnboundTransaction |
| @midnight-ntwrk/wallet-sdk-dust-wallet | transitive | calculateFee, dryRunFee, computeBalancingRecipe |
| Midnight.js / testkit | 4.1.1 | local/preprod providers |
| compact-runtime | 0.16.0 | generated contract runtime |

## Steps

```json
[
  {
    "name": "synthetic-import",
    "at": "2026-09-30T13:39:58.658Z",
    "hasTransaction": true,
    "hasEraseProofs": true,
    "hasFeesWithMargin": true
  },
  {
    "name": "empty-tx-feesWithMargin",
    "at": "2026-09-30T13:39:58.665Z",
    "ok": false,
    "error": "arg.charCodeAt is not a function",
    "note": "synthetic proven-call construction not available without proof server; static root-cause stands"
  },
  {
    "name": "install-erase-proofs",
    "at": "2026-09-30T13:39:58.665Z",
    "mode": "erase-proofs"
  },
  {
    "name": "install-local-fixed",
    "at": "2026-09-30T13:39:58.665Z",
    "mode": "local-fixed",
    "fee": "2000000000"
  },
  {
    "name": "install-local-fixed-on-preprod",
    "at": "2026-09-30T13:39:58.665Z",
    "ok": true,
    "refused": true,
    "error": "MILO_ALLOW_FIXED_LOCAL_FEE is local-only; refusing networkId=preprod"
  }
]
```

## Verdict

Product fix installed: eraseProofs fee math + local-only fixed-fee flag refuses Preprod.

## Product fix

`packages/integration/src/fee-math.mjs` — `installFeeMath()` prices `feesWithMargin` on
`this.eraseProofs()` (matches dryRunFee). Local-only fixed fee requires
`MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only` and a local network id; refuses Preprod.
