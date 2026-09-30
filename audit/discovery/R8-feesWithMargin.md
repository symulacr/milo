# R8 — feesWithMargin WASM spin on proved call txs

## Symptom

`wallet.estimateTransactionFee` / `balanceUnboundTransaction` hang (event loop
blocked, ~300% CPU) on **proved call** transactions. **Deploy** txs balance in
~20 ms on the same path. Reproduced on local disposable `undeployed` network.

## Root cause (confirmed by static analysis of wallet-sdk-dust-wallet)

`computeBalancingRecipe` computes `initialFees` via `calculateFee(transaction)`:

```js
return (transaction.feesWithMargin(ledgerParams, this.costParams.feeBlocksMargin) + overhead);
```

`feesWithMargin` is WASM (`wasm.transaction_feesWithMargin`). On a **proved**
call tx (circuit proofs present) this spins. `dryRunFee` may erase proofs for
the merge, but the **initial** fee is priced on the proved object.

Cohort pin: `@midnight-ntwrk/ledger-v8@8.1.2` (Midnight cohort — U2 forbids
bumping in the main line).

## Mitigations

1. **Local-only fixed fee** in `local-happy.mjs` (`LOCAL_FEE = 2_000_000_000n`)
   — already in tree. **Must never support Preprod/Mainnet fee claims.**
2. **Recommended product fix** (not in tracked source; node_modules patch is
   disposable): price `transaction.eraseProofs().feesWithMargin(...)` in
   `calculateFee`, matching `dryRunFee`.
3. **Cohort upgrade** of `ledger-v8` / dust-wallet — **OWNER** (changes fee
   math / possible verifier interaction). See U2 COHORT-UPGRADE.md.

## Evidence

- Local happy path with fixed fee: `obs_d2a_local_happy_complete_1` (4/4
  SucceedEntirely). **Label: local-only fee path.**
- Real-fee Preprod happy path: **NOT DONE** (R8 open).

## Status

R8 **ROOT-CAUSED**. Product fix pending owner cohort decision or an in-tree
eraseProofs wrapper that is proven on Preprod. Fixed-fee path stays local-only.
